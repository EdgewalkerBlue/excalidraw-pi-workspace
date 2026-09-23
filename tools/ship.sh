#!/bin/sh
# ship.sh —— 发布流程自动化（项目约定，2026-09-23 用户指定）
#
#   1. 日常开发只在 DEV 分支进行；
#   2. 把 DEV 推到远端 origin/DEV；
#   3. 再把 DEV 合并进主分支 master（远端默认分支）；
#   4. **无论成功失败，最后都自动切回 DEV**（由 EXIT trap 保证）。
#
# 用法（Git Bash / sh）：
#   tools/ship.sh -m "feat: xxx"         # 提交当前改动 → 推 DEV → 合并 master → 切回 DEV
#   tools/ship.sh -m "xxx" --dry-run     # 只打印将要执行的命令
#   tools/ship.sh --no-commit            # 无新改动时只走 推送/合并/回切
#   tools/ship.sh -m "xxx" --include-all # 连 .pi/ 与 exp-*.json 一并提交（默认排除）
#
# 只用 shell 内建 + git，不依赖 grep/sed/awk 等外部命令。
set -u

WORK_BRANCH=DEV
MAIN_BRANCH=master
REMOTE=origin
# 上传卫生：这些路径永不入库（--include-all 可覆盖）
# .pi/ 本机数据；exp-*.json 临时导出；AGENTS.md/CLAUDE.md/CODEBUDDY.md 为 agent 本机指令，一律不上传
EXCLUDES=".pi exp-*.json AGENTS.md CLAUDE.md CODEBUDDY.md"

DRY=0
NOCOMMIT=0
INCLUDE_ALL=0
MSG=""

while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-commit) NOCOMMIT=1; shift ;;
    --include-all) INCLUDE_ALL=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" 2>/dev/null || printf '见脚本头部注释\n'; exit 0 ;;
    *) printf '未知参数：%s（-h 查看用法）\n' "$1"; exit 1 ;;
  esac
done

# 打印并执行；dry-run 下只打印。返回 git 的退出码。
run() {
  printf '  $ %s\n' "$*"
  if [ "$DRY" = 1 ]; then return 0; fi
  _o=$("$@" 2>&1); _rc=$?
  if [ -n "$_o" ]; then printf '%s\n' "$_o" | while IFS= read -r _l; do printf '    %s\n' "$_l"; done; fi
  return $_rc
}
# 允许失败（用于可选步骤）
try() { run "$@" || true; }

SWITCHED=0
finish() {
  _rc=$?
  if [ "$SWITCHED" = 1 ] && [ "$DRY" = 0 ]; then
    printf '\n[5/5] 切回 %s\n' "$WORK_BRANCH"
    if ! git checkout "$WORK_BRANCH" >/dev/null 2>&1; then
      printf '✗ 自动切回失败，请手动执行：git checkout %s\n' "$WORK_BRANCH"
      _rc=1
    fi
  fi
  _now=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  printf '\n=== 结束：当前分支 %s ===\n' "${_now:-?}"
  [ "$_rc" = 0 ] || printf '（有步骤失败，请看上面的输出）\n'
  exit "$_rc"
}
trap finish EXIT

# 推分支；若失败且像代理问题，改用直连重试一次（不动全局 git 配置）
# （本机常见情形：全局 git 配了 http.proxy 指向本地代理软件，而它没开；直连其实可用）
push_branch() {
  _b=$1
  if [ "$DRY" = 1 ]; then printf '  $ git push %s %s\n' "$REMOTE" "$_b"; return 0; fi
  _out=$(git push "$REMOTE" "$_b" 2>&1); _rc=$?
  if [ $_rc -eq 0 ]; then
    [ -n "$_out" ] && printf '    %s\n' "$_out"
    return 0
  fi
  printf '    %s\n' "$_out"
  case "$_out" in
    *proxy*|*"Failed to connect"*|*"Could not connect to server"*)
      printf '  ↻ 检测到代理连接失败 → 直连重试（仅本次命令覆盖，不改全局配置）\n'
      git -c http.proxy= -c https.proxy= push "$REMOTE" "$_b"
      ;;
    *) printf '✗ push %s 失败，且不像代理问题\n' "$_b"; return 1 ;;
  esac
}

printf '\n=== ship: %s → %s%s ===\n' "$WORK_BRANCH" "$MAIN_BRANCH" "$([ "$DRY" = 1 ] && printf ' [dry-run]' || printf '')"

# ── [0] 必须在开发分支上 ───────────────────────────────────────────────
_cur=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$_cur" != "$WORK_BRANCH" ]; then
  printf '✗ 当前在 %s，约定开发只在 %s。请先：git checkout %s\n' "${_cur:-?}" "$WORK_BRANCH" "$WORK_BRANCH"
  exit 1
fi

# ── [1] 暂存（排除上传卫生路径） ────────────────────────────────────────
printf '\n[1/5] 暂存改动\n'
run git add -A
if [ "$INCLUDE_ALL" = 1 ]; then
  printf '  ↳ --include-all：不排除任何路径\n'
else
  for _p in $EXCLUDES; do try git reset -q -- "$_p"; done
  printf '  ↳ 已排除上传卫生路径：%s\n' "$EXCLUDES"
fi

# ── [2] 提交 ──────────────────────────────────────────────────────────
printf '\n[2/5] 提交\n'
git diff --cached --quiet; _dirty=$?
if [ "$NOCOMMIT" = 1 ]; then
  printf '  ↳ --no-commit：跳过\n'
elif [ "$_dirty" = 0 ]; then
  printf '  ↳ 暂存区为空，无需提交\n'
elif [ -z "$MSG" ]; then
  printf '✗ 有改动待提交，但缺少提交信息。用法：tools/ship.sh -m "feat: xxx"\n'
  exit 1
else
  run git commit -m "$MSG"
fi

# ── [3] 推 DEV ────────────────────────────────────────────────────────
printf '\n[3/5] 推送 %s\n' "$WORK_BRANCH"
push_branch "$WORK_BRANCH" || exit 1

# ── [4] 合并到主分支并推送 ─────────────────────────────────────────────
printf '\n[4/5] 合并 %s → %s\n' "$WORK_BRANCH" "$MAIN_BRANCH"
SWITCHED=1
run git checkout "$MAIN_BRANCH" || exit 1
try git fetch "$REMOTE" "$MAIN_BRANCH"
try git merge --ff-only "$REMOTE/$MAIN_BRANCH"
_subject="${MSG:-同步 $WORK_BRANCH}"
run git merge "$WORK_BRANCH" --no-ff -m "Merge branch '$WORK_BRANCH' into $MAIN_BRANCH: $_subject" || exit 1
push_branch "$MAIN_BRANCH" || exit 1
