// 为 appearance.mjs 提供类型声明（与 upstream-core.d.mts 同一模式）。
// 改实现记得同步这里，否则 tsc 不会发现类型漂移。
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODES: ThemeMode[];
export const THEME_KEY: string;
export const BG_KEY: string;

export function nextThemeMode(mode: ThemeMode): ThemeMode;
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme;
export function isDarkTheme(theme: ResolvedTheme): boolean;
export function parseThemeMode(raw: unknown): ThemeMode;

export type CanvasBgSwatch = { hex: string; zh: string; en: string };
export const CANVAS_BG_SWATCHES: CanvasBgSwatch[];

export function normalizeHex(input: unknown): string | null;
