import { useCallback, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  serializeAsJSON,
  loadFromBlob,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  BinaryFiles,
  AppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

type OnChangeArgs = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;

const AUTOSAVE_KEY = "excalidraw:workspace:autosave";
const DEFAULT_FILE_NAME = "main.excalidraw";

export default function App() {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI | null>(null);
  const [fileName, setFileName] = useState(DEFAULT_FILE_NAME);
  const [saveState, setSaveState] = useState<"saved" | "unsaved">("saved");
  const [loadedAt, setLoadedAt] = useState(0);
  const autoSaveTimer = useRef<number | null>(null);

  // 初始数据：从 localStorage 恢复（reopen 能力）
  const initialData = useMemo(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setLoadedAt(Date.now());
        return {
          elements: data.elements ?? [],
          appState: data.appState ?? undefined,
          files: data.files ?? undefined,
        };
      }
    } catch (e) {
      console.warn("恢复自动保存失败", e);
    }
    return undefined;
  }, []);

  const handleChange = useCallback(
    (
      elements: OnChangeArgs[0],
      appState: OnChangeArgs[1],
      files: OnChangeArgs[2]
    ) => {
      setSaveState("unsaved");
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = window.setTimeout(() => {
        try {
          const json = serializeAsJSON(elements, appState, files, "local");
          localStorage.setItem(AUTOSAVE_KEY, json);
          setSaveState("saved");
        } catch (e) {
          console.error("自动保存失败", e);
        }
      }, 500);
    },
    []
  );

  // 保存为 .excalidraw 文件（下载）
  const handleSaveToFile = useCallback(() => {
    const api = excalidrawAPI.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const json = serializeAsJSON(elements, appState, files, "local");
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSaveState("saved");
  }, [fileName]);

  // 打开 .excalidraw 文件
  const handleOpenFile = useCallback(async (file: File) => {
    const api = excalidrawAPI.current;
    if (!api) return;
    const blob = new Blob([await file.arrayBuffer()], {
      type: "application/json",
    });
    const restored = await loadFromBlob(
      blob,
      api.getAppState(),
      api.getSceneElements()
    );
    api.updateScene({
      elements: restored.elements,
      appState: restored.appState,
    });
    if (restored.files && Object.keys(restored.files).length > 0) {
      api.addFiles(Object.values(restored.files));
    }
    setFileName(
      file.name.toLowerCase().endsWith(".excalidraw")
        ? file.name
        : `${file.name}.excalidraw`
    );
    setSaveState("unsaved");
  }, []);

  // 新建空白画布
  const handleNew = useCallback(() => {
    const api = excalidrawAPI.current;
    if (!api) return;
    const appState = api.getAppState();
    api.updateScene({
      elements: [],
      appState: { ...appState, viewBackgroundColor: "#ffffff" },
    });
    localStorage.removeItem(AUTOSAVE_KEY);
    setSaveState("unsaved");
  }, []);

  return (
    <div className="app-root">
      <div className="toolbar">
        <span className="app-title">Excalidraw 工作区</span>
        <span className="file-name">{fileName}</span>
        <button onClick={handleNew}>新建</button>
        <label className="file-btn">
          <button
            onClick={(e) => {
              e.preventDefault();
              const input = document.getElementById(
                "excalidraw-file-input"
              ) as HTMLInputElement;
              input?.click();
            }}
          >
            打开 .excalidraw
          </button>
          <input
            id="excalidraw-file-input"
            type="file"
            accept=".excalidraw,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleOpenFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <button onClick={handleSaveToFile}>保存文件</button>
        <span className={`status ${saveState}`}>
          {saveState === "saved" ? "✓ 已自动保存" : "… 修改中"}
        </span>
      </div>
      <div className="canvas-wrap">
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawAPI.current = api;
          }}
          initialData={initialData}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
            },
            tools: {
              image: true,
            },
          }}
        />
      </div>
      <div className="hint-bar">
        协作画布 http://192.168.0.1:5001（Canvas Server）｜本工作区 :5002 ｜ 双指缩放平移、手写笔绘图均支持
      </div>
    </div>
  );
}
