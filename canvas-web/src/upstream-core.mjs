// 单一事实来源（SSOT）：画布底层「官方 Excalidraw master 更新自检」的端点与判定逻辑。
//
// 同时被两处复用，避免各写一份规则（违反项目 MCG-002/004）：
//   1. canvas-web/src/upstream-badge.tsx —— 浏览器端自检，画布 WebUI 顶部提醒
//   2. tools/check-upstream.mjs          —— 本地 / CI 命令行检查（npm run check:upstream）
//
// 约定：本文件必须是纯逻辑（无网络、无 DOM），才能两边共享。网络请求由调用方完成，
// 结果以 raw 对象传入 assess()。

/** 上游仓库与 npm 端点 */
export const UPSTREAM_ENDPOINTS = {
  head: "https://api.github.com/repos/excalidraw/excalidraw/commits/master",
  compare: (baseSha) =>
    `https://api.github.com/repos/excalidraw/excalidraw/compare/${baseSha}...master`,
  npmTags: "https://registry.npmjs.org/-/package/@excalidraw/excalidraw/dist-tags",
};

/** 检查节流周期（浏览器侧） */
export const CHECK_INTERVAL = 24 * 3600 * 1000;

const CANARY_RE = /^0\.18\.0-([0-9a-f]{7})$/i;

/**
 * 从 npm dist-tags 中挑出「官方最新已发布构建」。
 * 注意：Excalidraw 的 `latest` 稳定版常年滞后（0.18.1 发布于 2026-04，远早于同期 master canary），
 * 真正跟随 master 的是 `next`（0.18.0-<sha7>），因此优先取 next。
 * @param {Record<string,string>} tags
 * @returns {{version: string, sha: string|null, tag: string}}
 */
export function pickLatestBuild(tags) {
  const entries = Object.entries(tags || {});
  const canary = entries.find(([, v]) => CANARY_RE.test(String(v)));
  if (canary) {
    const sha = String(canary[1]).match(CANARY_RE)[1].toLowerCase();
    return { version: canary[1], sha, tag: canary[0] };
  }
  return { version: tags?.latest || "", sha: null, tag: "latest" };
}

/**
 * 比对「构建基线」与「上游现状」，给出提醒状态与文案。
 *
 * @param {{commit:string,date:string,version?:string}} baseline 构建期注入的官方 master 快照点
 * @param {{master?:{sha:string,date:string}, compare?:{total_commits:number,commits:{sha:string}[]}, tags?:Record<string,string>}} fetched 原始接口数据
 * @returns {{state:'unknown'|'up-to-date'|'build-available'|'source-only',
 *            baseline:*, masterSha:string, masterDate:string, behindBy:number,
 *            build:ReturnType<typeof pickLatestBuild>, title:{zh:string,en:string}, short:{zh:string,en:string},
 *            command:string}}
 */
export function assess(baseline, fetched = {}) {
  const baseCommit = String(baseline?.commit || "").toLowerCase();
  const masterSha = String(fetched?.master?.sha || "").slice(0, 7).toLowerCase();
  const masterDate = String(fetched?.master?.date || "").slice(0, 10);
  const commits = fetched?.compare?.commits || [];
  const behindBy =
    Number(fetched?.compare?.total_commits) || (commits.length ? commits.length : masterSha && masterSha !== baseCommit ? 1 : 0);
  const aheadShas = new Set(commits.map((c) => String(c.sha).slice(0, 7).toLowerCase()));
  const build = pickLatestBuild(fetched?.tags);

  const result = {
    baseline, masterSha, masterDate, behindBy, build,
    state: "unknown", title: { zh: "", en: "" }, short: { zh: "", en: "" }, command: "",
  };

  if (!masterSha) return result; // 离线 / 被限流：静默

  const baseLabel = `${baseline.commit}${baseline.date ? ` (${baseline.date})` : ""}`;
  const headLabel = `${masterSha}${masterDate ? ` (${masterDate})` : ""}`;

  // 1) 已发布的新构建，且其 commit 位于当前基线之后（即真正可升级）
  if (build.sha && build.sha !== baseCommit && (aheadShas.has(build.sha) || masterSha === build.sha)) {
    result.state = "build-available";
    result.command = `npm install @excalidraw/excalidraw@${build.version} && npm run build:canvas`;
    result.short = { zh: `官方新构建 ${build.version}`, en: `new build ${build.version}` };
    result.title = {
      zh: `画布底层官方已有新构建：${baseline.version || baseLabel} → ${build.version}（master ${headLabel}）。\n升级：${result.command}，然后重启画布服务（stop-canvas.bat → start-canvas.bat）。\n点击本徽标可复制升级命令。`,
      en: `A newer official canvas build is out: ${baseline.version || baseLabel} -> ${build.version} (master ${headLabel}).\nUpgrade: ${result.command}, then restart the canvas service.\nClick this badge to copy the upgrade command.`,
    };
    return result;
  }

  // 2) master 有更新但尚未发布 npm 构建：仅告知，等官方发包后再升级
  if (masterSha !== baseCommit && behindBy > 0) {
    result.state = "source-only";
    result.short = { zh: `源码领先 ${behindBy} 个提交`, en: `source ahead ${behindBy}` };
    result.title = {
      zh: `官方 master 已领先 ${behindBy} 个提交（${baseLabel} → ${headLabel}），但这些提交尚未发布 npm 构建（最新已发布为 ${build.version || "—"}）。\n自检每 24 小时一次，发包后本提示会自动变为可升级。`,
      en: `Upstream master is ${behindBy} commit(s) ahead (${baseLabel} -> ${headLabel}), but no npm build has been published for them yet (latest published: ${build.version || "—"}).\nChecked once per 24h; this badge turns into an actionable upgrade once the build ships.`,
    };
    return result;
  }

  // 3) 已是官方最新
  result.state = "up-to-date";
  result.short = { zh: "官方最新", en: "up to date" };
  result.title = {
    zh: `画布底层已是官方 master 最新：${baseline.version || ""} ${baseLabel}（上游 HEAD ${headLabel}）。\n每日自检一次，有新构建时这里会变黄。`,
    en: `Canvas base layer already tracks upstream master: ${baseline.version || ""} ${baseLabel} (upstream HEAD ${headLabel}).\nSelf-checked daily; this badge turns amber when an update ships.`,
  };
  return result;
}
