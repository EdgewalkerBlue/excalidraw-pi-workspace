// 「在官方菜单里追加二开仓库链接」的纯逻辑（可离线单测）。
//
// 为什么是 .mjs：要被 extra-menu-links.tsx（浏览器）与 extra-menu-links.test.mjs（node --test）共用，
// 且不能引入 React。类型声明见 extra-menu-links.d.mts。
//
// 背景：官方 Socials 组件里三个链接（GitHub / X / Discord）是写死的 JSX，
// ExcalidrawProps 没有任何菜单扩展点（只有 renderTopLeftUI / renderTopRightUI /
// renderCustomStats / renderEmbeddable / renderCustomUI），所以只能在 DOM 上追加。
//
// 注入策略（尽量不依赖官方内部类名）：
//   以官方 GitHub 那条为锚点 → **深拷贝它**（样式/结构/图标天然一致）→ 只改 href 与文本。

/** 官方锚点链接 */
export const OFFICIAL_GITHUB = 'a[href="https://github.com/excalidraw/excalidraw"]';

/** 幂等标记：注入后打在自己身上 */
export const FORK_ATTR = "pi-fork-link";

/** 幂等选择器 */
export const FORK_SELECTOR = `a[${FORK_ATTR}]`;

/** 菜单项文案（跟随界面语言） */
export function forkLabel(lang) {
  return lang === "zh-CN" ? "二开版 GitHub" : "Fork GitHub";
}

/**
 * 在 root 内注入二开链接。
 * @param {ParentNode|any} root  文档或菜单容器
 * @param {{url: string, label: string}} opts
 * @returns {"injected"|"exists"|"no-anchor"}
 */
export function injectForkLink(root, { url, label }) {
  if (!root || !url) return "no-anchor";
  if (root.querySelector(FORK_SELECTOR)) return "exists";
  const official = root.querySelector(OFFICIAL_GITHUB);
  if (!official) return "no-anchor";

  const link = official.cloneNode(true);
  link.setAttribute(FORK_ATTR, "1");
  link.setAttribute("href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.setAttribute("aria-label", label);
  link.setAttribute("title", url);
  if (typeof link.removeAttribute === "function") link.removeAttribute("data-testid");

  // 文本替换：找最深的、内容恰为官方文案的节点（不同版本可能多包一层 span）
  const nodes = Array.from(link.querySelectorAll("*")).reverse();
  const holder = nodes.find((el) => String(el.textContent || "").trim() === "GitHub");
  if (holder) holder.textContent = label;
  else if (typeof link.append === "function" && typeof document !== "undefined") {
    link.append(document.createTextNode(label));
  }

  // 菜单若处于 manual-hover 模式，高亮是类驱动的 → 补上，避免悬停无反馈
  if (link.addEventListener) {
    link.addEventListener("mouseenter", () => link.classList.add("dropdown-menu-item--hovered"));
    link.addEventListener("mouseleave", () => link.classList.remove("dropdown-menu-item--hovered"));
  }

  official.insertAdjacentElement("afterend", link);
  return "injected";
}
