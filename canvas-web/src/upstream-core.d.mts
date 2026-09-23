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

export type UpstreamFetched = {
  master?: { sha: string; date: string };
  compare?: { total_commits: number; commits: { sha: string }[] };
  tags?: UpstreamTags;
};

export type UpstreamState = "unknown" | "up-to-date" | "build-available" | "source-only";

export type UpstreamAssessment = {
  baseline: UpstreamBaseline;
  masterSha: string;
  masterDate: string;
  behindBy: number;
  build: UpstreamBuild;
  state: UpstreamState;
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

export function pickLatestBuild(tags: UpstreamTags): UpstreamBuild;

export function assess(
  baseline: UpstreamBaseline,
  fetched?: UpstreamFetched,
): UpstreamAssessment;
