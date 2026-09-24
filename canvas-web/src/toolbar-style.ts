// 画布顶部二开控件的统一样式（单一事实来源）。
//
// 起因：工具条上原本各控件各写一套（padding 有 6/12、6/10、4/8 三套，字号 14/13/12 两种，
// 且没有 nowrap —— 在 flex 压缩下「跟随系统」「发送给 Agent」会折成两行），导致高度参差不齐。
//
// 约定：
//   · 所有控件统一 30px 高、单行不换行（whiteSpace nowrap + flexShrink 0）；
//   · 间距由容器的 gap 统一提供，控件自己不再写 marginLeft；
//   · 配色用官方 CSS 变量，自动跟随深色主题。
import type React from "react";

/** 控件统一高度（px） */
export const TOOLBAR_HEIGHT = 30;

/** 工具条容器：横向排列、统一间距，空间不足时整行换行而不是压扁控件 */
export const toolbarRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
};

/** 中性控件（浅底描边），与官方菜单项视觉一致 */
export const toolbarButton: React.CSSProperties = {
  height: TOOLBAR_HEIGHT,
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "0 10px",
  borderRadius: 6,
  fontSize: 13,
  lineHeight: 1,
  whiteSpace: "nowrap",
  flexShrink: 0,
  fontFamily: "inherit",
  cursor: "pointer",
  border: "1px solid var(--color-border-outline, #ced4da)",
  background: "var(--island-bg-color, #fff)",
  color: "var(--text-primary-color, #343a40)",
};

/** 彩色主按钮（Agent 工具条用），只覆盖配色，尺寸仍走 toolbarButton */
export const toolbarButtonColored = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
  ...toolbarButton,
  background: bg,
  color: "#fff",
  border: "none",
  ...extra,
});

/** 徽标类（只读提示，非按钮） */
export const toolbarBadge = (extra?: React.CSSProperties): React.CSSProperties => ({
  ...toolbarButton,
  cursor: "default",
  ...extra,
});
