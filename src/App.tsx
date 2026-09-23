// :5002 单画布工作区 —— 纯官方壳（2026-09-23 收拢）
//
// 原则：除「官方未提供的能力」外一律走官方实现。本轮移除的自研代码：
//   ✂ 打开 .excalidraw 文件   → 官方 canvasActions.loadScene（File 菜单 Open）
//   ✂ 保存为文件             → 官方 export.saveFileToDisk（File 菜单 Save as / Export）
//   ✂ 清空画布 / 新建        → 官方 clearCanvas（File 菜单 Reset the canvas）
//   ✂ 手写 localStorage 自动保存 → 官方 npm 包不提供场景持久化
//     （证据：@excalidraw/common 的 EDITOR_LS_KEYS 只有 oai-api-key / mermaid /
//      publish-library 三项，不含场景数据），因此不属于「重复官方能力」而被移除。
//
// 保留下来的非官方代码只有两点，都是明确的功能补充而非重复：
//   1. 官方 lang prop 的语言切换按钮（挂在官方 renderTopRightUI 插槽）
//   2. 未保存改动时的浏览器离开提醒（替代被移除的自动保存，兜底防丢失）
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const LANG_KEY = "excalidraw-canvas-lang";

export default function App() {
  const dirtyRef = useRef(false);
  const [lang, setLang] = useState<"zh-CN" | "en">(() => {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (v === "zh-CN" || v === "en") return v;
    } catch { /* ignore */ }
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  });

  const setLanguage = useCallback((l: "zh-CN" | "en") => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  }, []);

  // 纯官方壳不带自动保存 → 有改动未导出时交给浏览器提示，避免刷新即丢
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const handleApi = useCallback((api: ExcalidrawImperativeAPI | null) => {
    if (api) dirtyRef.current = false;
  }, []);

  const handleChange = useCallback(() => { dirtyRef.current = true; }, []);

  return (
    <div className="app-root">
      <div className="canvas-wrap">
        <Excalidraw
          onExcalidrawAPI={handleApi}
          onChange={handleChange}
          // 官方 prop 是 langCode（Language["code"]，如 "en" / "zh-CN"）——没有 lang 这个 prop
          langCode={lang}
          theme="light"
          name="Excalidraw-Workspace-Single"
          UIOptions={{
            canvasActions: {
              loadScene: true,                    // 官方：打开 .excalidraw
              export: { saveFileToDisk: true },   // 官方：另存为 / 导出
              saveAsImage: true,
              clearCanvas: true,                  // 官方：清空画布
            },
          }}
          renderTopRightUI={() => (
            <button
              className="lang-toggle"
              title={lang === "zh-CN" ? "Switch to English" : "切换为中文"}
              onClick={() => setLanguage(lang === "zh-CN" ? "en" : "zh-CN")}>
              {lang === "zh-CN" ? "EN" : "中"}
            </button>
          )}
        />
      </div>
    </div>
  );
}
