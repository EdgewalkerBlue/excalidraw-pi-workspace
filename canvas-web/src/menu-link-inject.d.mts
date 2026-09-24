// 为 extra-menu-links.mjs 提供类型声明（与 upstream-core / appearance 同一模式）。
export const OFFICIAL_GITHUB: string;
export const FORK_ATTR: string;
export const FORK_SELECTOR: string;

export function forkLabel(lang: "zh-CN" | "en"): string;

export function injectForkLink(
  root: ParentNode,
  opts: { url: string; label: string },
): "injected" | "exists" | "no-anchor";
