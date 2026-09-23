// :5001 画布主组件 —— 官方 @excalidraw/excalidraw（master 底层）+ 协作 sync + 二开工具条
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { SyncClient, fetchScene, getClientId, type CanvasElement } from "./sync";
import AgentTools from "./agent-tools";
import UpstreamBadge from "./upstream-badge";

const LANG_KEY = "excalidraw-canvas-lang";

export default function CanvasApp() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const syncRef = useRef<SyncClient | null>(null);
  const lastSyncTimeRef = useRef<number>(0); // 上次成功上行的时间（判定"本地未同步编辑"）
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

  // 本端是否拥有未上传的编辑：元素 updated 晚于上次上行时间，或不在已同步集合
  const dirtyIdsRef = useRef<Set<string>>(new Set());

  const applyInitial = useCallback((incoming: CanvasElement[]) => {
    const api = apiRef.current;
    if (!api) return;
    // 与本地未同步编辑合并：incoming 全量 + 本地 dirty 元素按 id 覆盖（本地新编辑胜）
    const dirty = dirtyIdsRef.current;
    if (dirty.size === 0) {
      api.updateScene({ elements: incoming as any });
      return;
    }
    const local = api.getSceneElementsIncludingDeleted();
    const localDirty = local.filter((e: any) => dirty.has(e.id));
    const byId = new Map(incoming.map((e) => [e.id, e]));
    for (const e of localDirty) byId.set(e.id, e as CanvasElement);
    api.updateScene({ elements: Array.from(byId.values()) as any });
  }, []);

  const applyElementUpsert = useCallback((element: CanvasElement) => {
    const api = apiRef.current;
    if (!api) return;
    // 若这正是本地未同步的编辑回声，跳过（避免用旧值覆盖本地）
    if (dirtyIdsRef.current.has(element.id)) return;
    const local = api.getSceneElementsIncludingDeleted();
    const idx = local.findIndex((e: any) => e.id === element.id);
    if (idx >= 0 && (Number(local[idx].version) || 0) >= (Number(element.version) || 0)) {
      // 官方 LWW：本地版本不旧则不覆盖（version 平局时保持本地，避免回声抖动）
      if ((Number(local[idx].version) || 0) > (Number(element.version) || 0)) return;
      if ((Number(local[idx].version) || 0) === (Number(element.version) || 0) &&
          (local[idx] as any).versionNonce === element.versionNonce) return;
    }
    const next = local.slice();
    if (idx >= 0) next[idx] = element as any; else next.push(element as any);
    api.updateScene({ elements: next as any });
  }, []);

  const applyElementDelete = useCallback((elementId: string) => {
    const api = apiRef.current;
    if (!api) return;
    const local = api.getSceneElementsIncludingDeleted();
    if (!local.some((e: any) => e.id === elementId)) return;
    api.updateScene({ elements: local.filter((e: any) => e.id !== elementId) as any });
  }, []);

  useEffect(() => {
    let mounted = true;
    const sync = new SyncClient({
      onInitial: applyInitial,
      onCreated: applyElementUpsert,
      onUpdated: applyElementUpsert,
      onDeleted: applyElementDelete,
    });
    syncRef.current = sync;

    void (async () => {
      try {
        const els = await fetchScene();
        if (mounted && apiRef.current) apiRef.current.updateScene({ elements: els as any });
      } catch { /* server 不可达时等 WS */ }
    })();

    sync.start();
    const beforeUnload = () => { void sync.flush(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted = false;
      window.removeEventListener("beforeunload", beforeUnload);
      sync.destroy();
    };
  }, [applyInitial, applyElementUpsert, applyElementDelete]);

  const handleChange = useCallback((elements: readonly any[]) => {
    const sync = syncRef.current;
    if (!sync) return;
    // 记录本地 dirty（onChange 的元素 = 本地编辑）
    const dirty = dirtyIdsRef.current;
    if (dirty.size > 500) dirty.clear(); // 防御性上限
    for (const e of elements) dirty.add(e.id);
    sync.scheduleSync([...elements]);
  }, []);

  // 官方在 mount 后回调 api、unmount 时传 null —— 类型按官方签名放宽为可空
  const handleApi = useCallback((api: ExcalidrawImperativeAPI | null) => {
    apiRef.current = api;
  }, []);

  // 上行成功后清 dirty（由 SyncClient 状态驱动——简化：flush 后延迟清理）
  useEffect(() => {
    const iv = window.setInterval(() => {
      const sync = syncRef.current as any;
      if (sync && !sync.pending) {
        // 无待上传内容时收缩 dirty 集合（保守：只清已从场景消失的）
        const api = apiRef.current;
        if (api) {
          const live = new Set(api.getSceneElementsIncludingDeleted().map((e: any) => e.id));
          for (const id of Array.from(dirtyIdsRef.current)) {
            if (!live.has(id)) dirtyIdsRef.current.delete(id);
          }
        }
      }
    }, 5000);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div style={{ height: "100%" }}>
      <Excalidraw
        // 官方 prop 名是 onExcalidrawAPI（运行时只调用 props.onExcalidrawAPI?.(api)）；
        // 曾误写成 excalidrawAPI —— 那是 ExcalidrawMountPayload 的字段名，不是组件 prop，
        // 会导致 apiRef 始终为 null，初始加载与全部 WS 增量被静默丢弃（画布空白）。
        onExcalidrawAPI={handleApi}
        onChange={(elements) => { handleChange(elements); }}
        // 官方 prop 是 langCode（Language["code"] 类型，如 "en" / "zh-CN"）；
        // 没有 lang 这个 prop，写 lang 会被直接忽略（语言切换静默失效）。
        langCode={lang}
        theme="light"
        name="Excalidraw-Workspace-Canvas"
        UIOptions={{
          canvasActions: {
            loadScene: true,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
            saveAsImage: true,
            clearCanvas: true,
            // 注：原先还写了 logState / changeCanvasBackground —— 官方 UIOptions.canvasActions
            // 在 0.18 只允许 changeViewBackgroundColor / clearCanvas / export / loadScene /
            // saveToActiveFile / toggleTheme / saveAsImage 这几项，其余会被忽略。
            // 类型检查扩展到 canvas-web 后按官方签名清理掉了无效配置。
          },
        }}
        renderTopRightUI={() => (
          <div style={{ display: "flex", alignItems: "center" }}>
            <AgentTools lang={lang} />
            <UpstreamBadge lang={lang} />
            <button
              title="中文 / English"
              onClick={() => setLanguage(lang === "zh-CN" ? "en" : "zh-CN")}
              style={{
                marginLeft: 6, border: "none", borderRadius: 4, padding: "6px 10px",
                cursor: "pointer", fontSize: 14, backgroundColor: "#e9ecef", fontFamily: "inherit",
              }}>
              {lang === "zh-CN" ? "EN" : "中"}
            </button>
          </div>
        )}
      />
    </div>
  );
}
