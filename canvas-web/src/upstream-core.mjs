// 单一事实来源（SSOT）：画布底层「官方 Excalidraw master 更新自检」的端点与判定逻辑。
//
// 同时被三处复用，避免各写一份规则（违反项目 MCG-002/004）：
//   1. canvas-web/src/upstream-badge.tsx —— 浏览器端自检，画布 WebUI 顶部提醒
//   2. tools/check-upstream.mjs          —— 本地 / CI 命令行检查（npm run check:upstream）
//   3. canvas-web/src/upstream-core.test.mjs —— 纯逻辑单测（合成数据，不碰网络）
//
// 约定：本文件必须是纯逻辑（无网络、无 DOM），才能三边共享。网络请求由调用方完成，
// 结果以 raw 对象传入 assess()。

/** 上游仓库与 npm 端点 */
export const UPSTREAM_ENDPOINTS = {
  head: "https://api.github.com/repos/excalidraw/excalidraw/commits/master",
  compare: (baseSha) =>
    `https://api.github.com/repos/excalidraw/excalidraw/compare/${baseSha}...master`,
  npmTags: "https://registry.npmjs.org/-/package/@excalidraw/excalidraw/dist-tags",
  // npm registry 的 dist-tags 接口不带 CORS 头，浏览器直连必被拦（徽标因此永远到不了
  // build-available 态）——浏览器侧走画布服务器的同源代理（patch-server 注入端点），
  // CLI（tools/check-upstream.mjs）不受 CORS 限制，仍用 npmTags 直连。
  npmTagsProxy: "/api/upstream/npm-tags",
};

/** 检查节流周期（浏览器侧） */
export const CHECK_INTERVAL = 24 * 3600 * 1000;

/** 官方跟随 master 的 dist-tag；canary 版本形如 0.18.0-<sha7> */
export const CANARY_TAG = "next";
const CANARY_RE = /^0\.18\.0-([0-9a-f]{7})$/i;

/**
 * 从 npm dist-tags 中挑出「官方最新已发布构建」。
 *
 * 规则（与实现严格一致）：
 *   1. **显式优先 `next`** —— Excalidraw 的 `latest` 稳定版常年滞后（0.18.1 发布于 2026-04，
 *      远早于同期 master canary），真正跟随 master 的只有 `next`（0.18.0-<sha7>）；
 *   2. `next` 若非 canary 形式，则在其余标签中按 registry 返回顺序取第一个 canary 形式者；
 *   3. 都没有则回退 `latest`（sha 为 null，仅用于展示，不代表可升级）。
 *
 * @param {Record<string,string>} tags
 * @returns {{version: string, sha: string|null, tag: string}}
 */
export function pickLatestBuild(tags) {
  const t = tags || {};
  const ordered = t[CANARY_TAG] ? [[CANARY_TAG, t[CANARY_TAG]], ...Object.entries(t).filter(([k]) => k !== CANARY_TAG)] : Object.entries(t);
  const canary = ordered.find(([, v]) => CANARY_RE.test(String(v)));
  if (canary) {
    const sha = String(canary[1]).match(CANARY_RE)[1].toLowerCase();
    return { version: canary[1], sha, tag: canary[0] };
  }
  return { version: t.latest || "", sha: null, tag: "latest" };
}

/** 把 GitHub 的限流重置时间（epoch 秒 / 毫秒 / ISO 串）格式化成本地 HH:MM */
export function formatReset(resetAt) {
  if (!resetAt) return "";
  const num = typeof resetAt === "number" ? (resetAt < 1e12 ? resetAt * 1000 : resetAt) : Date.parse(String(resetAt));
  if (!num || Number.isNaN(num)) return "";
  const d = new Date(num);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 比对「构建基线」与「上游现状」，给出提醒状态与文案。
 *
 * @param {{commit:string,date:string,version?:string}} baseline 构建期注入的官方 master 快照点
 * @param {{master?:{sha:string,date:string},
 *          compare?:{total_commits:number,commits:{sha:string}[]},
 *          tags?:Record<string,string>,
 *          blocked?:{status?:number,resetAt?:number|string}}} fetched 原始接口数据；
 *        blocked 由调用方在收到 403/429 时传入（GitHub 未认证限流）
 * @returns {{state:'unknown'|'up-to-date'|'build-available'|'source-only'|'rate-limited',
 *            baseline:*, masterSha:string, masterDate:string, behindBy:number,
 *            build:ReturnType<typeof pickLatestBuild>, resetAt:number, resetLabel:string,
 *            title:{zh:string,en:string}, short:{zh:string,en:string}, command:string}}
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
  const blocked = fetched?.blocked;
  const resetLabel = formatReset(blocked?.resetAt);
  const resetAt = typeof blocked?.resetAt === "number"
    ? (blocked.resetAt < 1e12 ? blocked.resetAt * 1000 : blocked.resetAt)
    : (blocked?.resetAt ? Date.parse(String(blocked.resetAt)) || 0 : 0);

  const result = {
    baseline, masterSha, masterDate, behindBy, build, resetAt, resetLabel,
    state: "unknown", title: { zh: "", en: "" }, short: { zh: "", en: "" }, command: "",
  };

  if (!masterSha) {
    // 拿不到上游 HEAD：区分「被限流」与「真离线」——前者要给用户可见解释，后者保持静默
    if (blocked) {
      result.state = "rate-limited";
      result.short = { zh: "自检被限流", en: "self-check limited" };
      result.title = {
        zh: `GitHub API 暂时拒绝了自检请求（HTTP ${blocked.status ?? "?"}）。未认证接口的限额是每 IP 每小时 60 次，完成一次自检要 2 次请求。\n${resetLabel ? `配额约在 ${resetLabel} 重置，届时会自动重试。` : "稍后会自动重试。"}\n画布功能不受影响，只是暂时无法比对官方 master 的更新。`,
        en: `GitHub API temporarily refused the self-check (HTTP ${blocked.status ?? "?"}). The unauthenticated limit is 60 requests/hour per IP, and one check costs 2.\n${resetLabel ? `Quota resets around ${resetLabel}; it will retry automatically.` : "It will retry automatically later."}\nThe canvas itself is unaffected — only the upstream comparison is paused.`,
      };
    }
    return result;
  }

  const baseLabel = `${baseline.commit}${baseline.date ? ` (${baseline.date})` : ""}`;
  const headLabel = `${masterSha}${masterDate ? ` (${masterDate})` : ""}`;

  // 1) 已发布的新构建，且其 commit 位于当前基线之后（即真正可升级）
  if (build.sha && build.sha !== baseCommit && (aheadShas.has(build.sha) || masterSha === build.sha)) {
    result.state = "build-available";
    result.command = `npm install @excalidraw/excalidraw@${build.version} && npm run build:canvas`;
    result.short = { zh: `官方新构建 ${build.version}`, en: `new build ${build.version}` };
    result.title = {
      zh: `画布底层官方已有新构建：${baseline.version || baseLabel} → ${build.version}（master ${headLabel}）。\n点击本徽标即可自动更新（安装官方包 → 同步基线 → 重构建部署，约 1-3 分钟；服务端未就绪时回退为复制手动命令 ${result.command}）。\n完成后按提示刷新页面（PWA 客户端可能需刷新两次）。`,
      en: `A newer official canvas build is out: ${baseline.version || baseLabel} -> ${build.version} (master ${headLabel}).\nClick this badge to update automatically (install official package -> sync baseline -> rebuild & deploy, ~1-3 min; falls back to copying the manual command if the server endpoint is not ready).\nRefresh the page when prompted (PWA clients may need two refreshes).`,
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
