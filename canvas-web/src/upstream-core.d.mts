// 为 upstream-core.mjs 提供类型声明（canvas-web 自 2026-09-23 起纳入 tsc 检查范围）。
// 文件内容须与 canvas-web/src/upstream-core.mjs 的实现签名保持一致，改实现记得同步这里。
export type UpstreamTags = Record<string, string>;

export type UpstreamBuild = {
  version: string;
  sha: string | null;
  tag: string;
};

export type UpstreamBaseline = {
  commit: string;
  date: string;
  version?: string;
};

/** caller 收到 403/429 时传入，用于区分「被限流」与「真离线」 */
export type UpstreamBlocked = {
  status?: number;
  resetAt?: number | string;
};

export type UpstreamFetched = {
  master?: { sha: string; date: string };
  compare?: { total_commits: number; commits: { sha: string }[] };
  tags?: UpstreamTags;
  blocked?: UpstreamBlocked;
};

export type UpstreamState =
  | "unknown"
  | "up-to-date"
  | "build-available"
  | "source-only"
  | "rate-limited";

export type UpstreamAssessment = {
  baseline: UpstreamBaseline;
  masterSha: string;
  masterDate: string;
  behindBy: number;
  build: UpstreamBuild;
  state: UpstreamState;
  /** 限流重置时刻（epoch ms）；0 表示未知 */
  resetAt: number;
  /** 限流重置时刻的本地 HH:MM；空串表示未知 */
  resetLabel: string;
  title: { zh: string; en: string };
  short: { zh: string; en: string };
  command: string;
};

export const UPSTREAM_ENDPOINTS: {
  head: string;
  compare: (baseSha: string) => string;
  npmTags: string;
};

export const CHECK_INTERVAL: number;

export const CANARY_TAG: string;

export function pickLatestBuild(tags: UpstreamTags): UpstreamBuild;

export function formatReset(resetAt: number | string | undefined): string;

export function assess(
  baseline: UpstreamBaseline,
  fetched?: UpstreamFetched,
): UpstreamAssessment;
