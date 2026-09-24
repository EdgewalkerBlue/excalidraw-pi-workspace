// 在官方汉堡菜单的「Excalidraw links」区域里，紧跟官方 GitHub 之后插入一条**二开仓库**链接。
//
// 为什么是 DOM 注入：官方 `Socials` 组件里三个链接（GitHub / X / Discord）是写死的 JSX，
// `ExcalidrawProps` 的扩展点只有 renderTopLeftUI / renderTopRightUI / renderCustomStats /
// renderEmbeddable / renderCustomUI —— **没有任何菜单扩展点**（已核对 0.18.0-c0ad61c 源码）。
//
// 注入细节（克隆官方节点、幂等、悬停补类）都在纯模块 menu-link-inject.mjs 里，便于离线单测。
// 注意模块名故意与组件不同名：Vite 的扩展名解析里 .mjs 优先于 .tsx，
// 若把纯逻辑也叫 extra-menu-links.mjs，`import X from "./extra-menu-links"` 会错误地解析到纯逻辑。
// 本文件只负责：挂载时机、语言变化、以及用 MutationObserver 兜住 React 重渲染
//（菜单每次打开都会重建 DOM，注入项必须能自愈）。
import { useEffect } from "react";
import { injectForkLink, forkLabel } from "./menu-link-inject.mjs";

export default function ExtraMenuLinks({ lang }: { lang: "zh-CN" | "en" }) {
  useEffect(() => {
    const url = typeof __FORK_REPO_URL__ === "string" ? __FORK_REPO_URL__ : "";
    const label = forkLabel(lang);
    const tryInject = () => {
      try {
        injectForkLink(document, { url, label });
      } catch { /* 菜单结构变化时静默失败，不影响画布 */ }
    };

    tryInject();
    const mo = new MutationObserver(tryInject);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [lang]);

  return null; // 只做注入，不渲染任何东西
}
