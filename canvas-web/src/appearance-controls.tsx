// 外观控件：主题三态按钮 + 画布底色选择器（8 色块 + 自定义色值）。
//
// 设计约束：
//   · 颜色一律用官方 CSS 变量（--island-bg-color / --text-primary-color / --color-border-outline
//     等）——官方在 .theme--dark 下会重定义这些变量，我们的控件因此自动跟随主题，
//     不需要自己维护两套配色。
//   · 底色写入走官方 API `updateScene({ appState: { viewBackgroundColor } })`
//     （与官方取色器 actionChangeViewBackgroundColor 完全相同的字段），不自造状态。
//   · 深色主题下官方会把画布颜色反色显示，色块用官方 applyDarkModeFilter 显示"实际观感"。
import { useEffect, useRef, useState } from "react";
import { applyDarkModeFilter } from "@excalidraw/excalidraw";
import {
  CANVAS_BG_SWATCHES,
  normalizeHex,
  type CanvasBgSwatch,
  type ThemeMode,
} from "./appearance.mjs";
import { toolbarButton } from "./toolbar-style";

const btnBase: React.CSSProperties = toolbarButton;

const MODE_LABEL: Record<ThemeMode, { zh: string; en: string }> = {
  light: { zh: "浅色", en: "light" },
  dark: { zh: "深色", en: "dark" },
  system: { zh: "跟随系统", en: "system" },
};

const MODE_GLYPH: Record<ThemeMode, string> = { light: "☀", dark: "🌙", system: "◐" };

/** 主题三态循环按钮：浅色 → 深色 → 跟随系统 */
export function ThemeToggle({
  mode,
  lang,
  onCycle,
}: {
  mode: ThemeMode;
  lang: "zh-CN" | "en";
  onCycle: () => void;
}) {
  const zh = lang === "zh-CN";
  const label = MODE_LABEL[mode];
  return (
    <button
      data-testid="theme-toggle"
      title={zh ? "切换主题：浅色 / 深色 / 跟随系统" : "Switch theme: light / dark / system"}
      onClick={onCycle}
      style={btnBase}>
      {MODE_GLYPH[mode]} {zh ? label.zh : label.en}
    </button>
  );
}

/** 画布底色：8 个色块（含纯黑）+ 自定义色值输入 */
export function BackgroundPicker({
  color,
  dark,
  lang,
  onPick,
}: {
  color: string;
  dark: boolean;
  lang: "zh-CN" | "en";
  onPick: (hex: string) => void;
}) {
  const zh = lang === "zh-CN";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const shown = (hex: string) => {
    try {
      return applyDarkModeFilter(hex, dark);
    } catch {
      return hex;
    }
  };

  const submitCustom = () => {
    const hex = normalizeHex(draft);
    if (!hex) return;
    onPick(hex);
    setDraft("");
    setOpen(false);
  };

  // 色块画的是**所选色值本身**（深色主题下反色会把 7 个浅色压成几乎相同的近黑，无法分辨）；
  // 深色主题下再在右下角点一个"实际观感"小点，兼顾可辨识与所见即所得。
  const swatch = (s: CanvasBgSwatch) => {
    const effective = shown(s.hex);
    const selected = normalizeHex(color) === s.hex;
    return (
      <button
        key={s.hex}
        data-testid={`bg-swatch-${s.hex.slice(1)}`}
        title={
          dark
            ? `${zh ? s.zh : s.en} ${s.hex} → ${zh ? "深色主题下画布显示为" : "renders as"} ${effective}`
            : `${zh ? s.zh : s.en} ${s.hex}`
        }
        onClick={() => { onPick(s.hex); setOpen(false); }}
        style={{
          position: "relative", width: 30, height: 30, borderRadius: 6, cursor: "pointer",
          background: s.hex, padding: 0,
          border: selected
            ? "2px solid var(--color-primary, #1971c2)"
            : "1px solid var(--color-border-outline, #ced4da)",
        }}>
        {dark && (
          <span
            aria-hidden
            style={{
              position: "absolute", right: 2, bottom: 2, width: 9, height: 9, borderRadius: "50%",
              background: effective, border: "1px solid rgba(128,128,128,.6)", display: "block",
            }}
          />
        )}
      </button>
    );
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        data-testid="bg-picker-toggle"
        title={zh
          ? `画布背景色（当前 ${color}）— 导出图片会使用该颜色，不再强制白底`
          : `Canvas background (now ${color}) — exports use this color instead of a forced white`}
        onClick={() => setOpen((v) => !v)}
        style={{ ...btnBase, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 14, height: 14, borderRadius: 3, background: shown(color),
          border: "1px solid var(--color-border-outline, #adb5bd)", display: "inline-block",
        }} />
        {zh ? "背景" : "BG"}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 10,
            padding: 10, borderRadius: 8, width: 196,
            background: "var(--island-bg-color, #fff)",
            border: "1px solid var(--color-border-outline, #ced4da)",
            boxShadow: "0 4px 16px rgba(0,0,0,.18)",
          }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {CANVAS_BG_SWATCHES.map(swatch)}
          </div>

          <div style={{ marginTop: 10, borderTop: "1px solid var(--color-border-outline, #dee2e6)", paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-primary-color, #495057)", marginBottom: 6 }}>
              {zh ? "自定义色值" : "Custom color"}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                data-testid="bg-custom-input"
                value={draft}
                placeholder="#rrggbb"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
                style={{
                  flex: 1, minWidth: 0, fontSize: 12, padding: "5px 6px", borderRadius: 6,
                  border: "1px solid var(--color-border-outline, #ced4da)",
                  background: "var(--color-surface-lowest, #fff)",
                  color: "var(--text-primary-color, #343a40)", fontFamily: "inherit",
                }}
              />
              <button
                data-testid="bg-custom-apply"
                onClick={submitCustom}
                disabled={!normalizeHex(draft)}
                style={{
                  ...btnBase, opacity: normalizeHex(draft) ? 1 : 0.5,
                  cursor: normalizeHex(draft) ? "pointer" : "not-allowed",
                }}>
                {zh ? "应用" : "Apply"}
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-primary-color, #868e96)", opacity: 0.75 }}>
              {dark
                ? (zh ? "色块为所选色值；右下角小点是深色主题下画布的显示效果" : "Swatch = chosen colour; corner dot = how dark theme renders it")
                : (zh ? "导出图片使用该底色" : "Exports use this background")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
