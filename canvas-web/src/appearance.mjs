// 外观（主题模式 + 画布底色）的纯逻辑与常量 —— 单一事实来源。
//
// 为什么是 .mjs 而不是 .ts：本文件被 canvas-web/src/appearance-controls.tsx（浏览器）
// 与 appearance.test.mjs（node --test）共用，且**不能**在导入期碰 `@excalidraw/*`
// （那些是浏览器包，在 Node 里加载会失败）。类型声明见同目录 appearance.d.mts。
//
// 官方事实（0.18.0-c0ad61c，已核对源码，见 UPSTREAM-DIFF.md）：
//   · theme 只有 "light" | "dark"（官方 `THEME` 常量），`onThemeChange` 另给 "system" 语义；
//   · 传了 theme 即声明「主题由宿主控制」，官方菜单里的主题切换项不会出现；
//   · 深色主题下官方把画布颜色反色显示，官方取色器用 `applyDarkModeFilter(color, isDark)`
//     显示「实际观感」—— 我们在 UI 层复用同一函数，保证所见即所得。

export const THEME_MODES = ["light", "dark", "system"];

/** localStorage 键 */
export const THEME_KEY = "excalidraw-canvas-theme-mode";
export const BG_KEY = "excalidraw-canvas-bg";

/** 浅色 → 深色 → 跟随系统 → 浅色 */
export function nextThemeMode(mode) {
  const i = THEME_MODES.indexOf(mode);
  return THEME_MODES[(i + 1) % THEME_MODES.length];
}

/** 把主题模式解析成官方只认的两档 */
export function resolveTheme(mode, systemDark) {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** 与官方 `THEME.DARK` 等价（此处内联，避免导入期依赖浏览器包） */
export function isDarkTheme(theme) {
  return theme === "dark";
}

/** 把外部传入的字符串收敛成合法模式，非法则回退 "system"（防旧数据把界面锁死） */
export function parseThemeMode(raw) {
  return typeof raw === "string" && THEME_MODES.includes(raw) ? raw : "system";
}

/**
 * 画布底色色块：**7 种浅色 + 末位纯黑**（共 8 个）。
 *
 * 色值全部取自官方 `COLOR_PALETTE`（避免自造颜色）：
 *   · 前 5 个与官方 `DEFAULT_CANVAS_BACKGROUND_PICKS` 同源
 *     （官方只提供这 5 个浅色候选：#ffffff / gray[0] / #f5faff / #fffce8 / #fdf8f6）；
 *   · 第 6、7 个补官方 green[0] 与 violet[0]，凑满 7 种浅色；
 *   · 第 8 个是纯黑（官方 `COLOR_PALETTE.black` 实为 `#1e1e1e`，此处按需求用纯黑收尾）。
 *
 * 注意：深色主题下官方会对画布底色调用 `applyDarkModeFilter`（见 Renderer 的 bootstrapCanvas），
 * 因此色块预览也做同样处理 —— 点之前看到的颜色就是画布上会出现的颜色。
 */
export const CANVAS_BG_SWATCHES = [
  { hex: "#ffffff", zh: "白", en: "white" },
  { hex: "#f8f9fa", zh: "浅灰", en: "light gray" },
  { hex: "#f5faff", zh: "浅蓝", en: "light blue" },
  { hex: "#fffce8", zh: "浅黄", en: "light yellow" },
  { hex: "#fdf8f6", zh: "浅粉", en: "light pink" },
  { hex: "#ebfbee", zh: "浅绿", en: "light green" },
  { hex: "#f3f0ff", zh: "浅紫", en: "light violet" },
  { hex: "#000000", zh: "黑", en: "black" },
];

/** 只接受 #rgb / #rrggbb（# 可省），统一回小写 #rrggbb；非法返回 null */
export function normalizeHex(input) {
  const s = `#${String(input ?? "").trim().replace(/^#+/, "")}`;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const [r, g, b] = s.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}
