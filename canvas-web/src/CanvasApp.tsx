// :5001 画布主组件 —— 官方 @excalidraw/excalidraw（master 底层）+ 协作 sync + 二开工具条
import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { SyncClient, fetchScene, getClientId, type CanvasElement } from "./sync";
import AgentTools from "./agent-tools";
import UpstreamBadge from "./upstream-badge";
import SaveTargets from "./save-targets";
import ExtraMenuLinks from "./extra-menu-links";
import { BackgroundPicker, ThemeToggle } from "./appearance-controls";
import { toolbarButton, toolbarRow } from "./toolbar-style";
import {
  BG_KEY, THEME_KEY, isDarkTheme, nextThemeMode, normalizeHex, parseThemeMode, resolveTheme,
  type ResolvedTheme, type ThemeMode,
} from "./appearance.mjs";

const LANG_KEY = "excalidraw-canvas-lang";

/** 系统是否处于深色（用于 theme="system"） */
function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

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

  // 主题三态 + 系统深色跟随（官方 theme 只认 light/dark，system 由我们解析）
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try { return parseThemeMode(localStorage.getItem(THEME_KEY)); } catch { return "system"; }
  });
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const theme: ResolvedTheme = resolveTheme(themeMode, systemDark);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { /* ignore */ }
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // 画布底色：null = 沿用官方默认（绝不主动写白色，避免"导出默认白底"）
  const [bg, setBg] = useState<string | null>(() => {
    try { return normalizeHex(localStorage.getItem(BG_KEY)); } catch { return null; }
  });
  const bgRef = useRef<string | null>(bg);
  bgRef.current = bg;

  const cycleTheme = useCallback(() => {
    setThemeMode((m) => {
      const next = nextThemeMode(m);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const pickBackground = useCallback((hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setBg(n);
    try { localStorage.setItem(BG_KEY, n); } catch { /* ignore */ }
    // 走官方字段：与官方取色器 actionChangeViewBackgroundColor 写的是同一个 appState
    apiRef.current?.updateScene({ appState: { viewBackgroundColor: n } as any });
  }, []);

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
    if (!api) return;
    // 恢复上次选定的画布底色（仅在用户确实选过时写入；否则保持官方默认）
    const stored = bgRef.current;
    if (stored) {
      const cur = normalizeHex((api.getAppState() as any)?.viewBackgroundColor);
      if (cur !== stored) api.updateScene({ appState: { viewBackgroundColor: stored } as any });
    }
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
      {/* 官方菜单没有扩展点：在「Excalidraw links」里追加二开仓库链接（细节见组件注释） */}
      <ExtraMenuLinks lang={lang} />
      <Excalidraw
        // 官方 prop 名是 onExcalidrawAPI（运行时只调用 props.onExcalidrawAPI?.(api)）；
        // 曾误写成 excalidrawAPI —— 那是 ExcalidrawMountPayload 的字段名，不是组件 prop，
        // 会导致 apiRef 始终为 null，初始加载与全部 WS 增量被静默丢弃（画布空白）。
        onExcalidrawAPI={handleApi}
        onChange={(elements) => { handleChange(elements); }}
        // 官方 prop 是 langCode（Language["code"] 类型，如 "en" / "zh-CN"）；
        // 没有 lang 这个 prop，写 lang 会被直接忽略（语言切换静默失效）。
        langCode={lang}
        // 官方主题：传了就声明"主题由宿主控制"（官方菜单里的切换项不出现），
        // 因此这里接我们的三态按钮（浅色/深色/跟随系统）。
        // 注意：官方会同步 exportWithDarkMode = (theme === DARK)，
        // 所以深色主题下导出图片自动跟随深色，不需要（也不应该）额外写白底。
        theme={theme}
        name="Excalidraw-Workspace-Canvas"
        UIOptions={{
          canvasActions: {
            loadScene: true,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
            saveAsImage: true,
            clearCanvas: true,
            // 保留官方自带的画布底色取色器（我们的色块是它的快捷入口，两者写同一字段）
            changeViewBackgroundColor: true,
            // 注：原先还写了 logState / changeCanvasBackground —— 官方 UIOptions.canvasActions
            // 在 0.18 只允许 changeViewBackgroundColor / clearCanvas / export / loadScene /
            // saveToActiveFile / toggleTheme / saveAsImage 这几项，其余会被忽略。
            // 类型检查扩展到 canvas-web 后按官方签名清理掉了无效配置。
          },
        }}
        renderTopRightUI={() => (
          <div style={toolbarRow}>
            <AgentTools lang={lang} />
            <SaveTargets lang={lang} getApi={() => apiRef.current} />
            <UpstreamBadge lang={lang} />
            <ThemeToggle mode={themeMode} lang={lang} onCycle={cycleTheme} />
            <BackgroundPicker
              color={bg ?? "#ffffff"}
              dark={isDarkTheme(theme)}
              lang={lang}
              onPick={pickBackground}
            />
            <button
              title="中文 / English"
              onClick={() => setLanguage(lang === "zh-CN" ? "en" : "zh-CN")}
              style={toolbarButton}>
              {lang === "zh-CN" ? "EN" : "中"}
            </button>
          </div>
        )}
      />
    </div>
  );
}
