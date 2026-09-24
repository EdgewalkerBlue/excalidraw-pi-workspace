// 「保存到…」对话框 —— 本地 / WebDAV / 网盘直连（Dropbox · Google Drive · OneDrive）/ 其他网盘快捷入口。
//
// 设计约束：
//   · 官方那个"保存到…"对话框的卡片是**硬编码**的（只有 exportOpts.saveFileToDisk 与
//     onExportToBackend 两个开关，无扩展点），所以这里自建入口；本地保存仍复用官方
//     `serializeAsJSON`，不自己造序列化格式。
//   · 元数据（provider 标签、控制台地址、其他网盘清单）**由本机中转服务返回**（GET /config），
//     前端不复制一份规格，避免平行实现。
//   · 所有网络请求（WebDAV PUT、OAuth 换 token、网盘上传）都交给中转服务，
//     浏览器侧不做跨域直连，凭据也只留在本机。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { toolbarButton, toolbarRow } from "./toolbar-style";

const BRIDGE_KEY = "excalidraw-canvas-save-bridge";
const DEFAULT_BRIDGE = "http://127.0.0.1:5011";

type BridgeConfig = {
  webdav: { url: string; username: string; hasPassword: boolean; directory: string };
  providers: Record<string, { clientId: string }>;
  connected: Record<string, boolean>;
  manualTargets: { id: string; label: { zh: string; en: string }; url: string }[];
};

const btn: React.CSSProperties = toolbarButton;
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", fontSize: 12, padding: "5px 8px", borderRadius: 6,
  border: "1px solid var(--color-border-outline, #ced4da)", fontFamily: "inherit",
  background: "var(--color-surface-lowest, #fff)", color: "var(--text-primary-color, #343a40)",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, margin: "0 0 6px",
  color: "var(--text-primary-color, #343a40)", opacity: 0.85,
};
const hint: React.CSSProperties = { fontSize: 11, color: "var(--text-primary-color, #868e96)", opacity: 0.7 };
const row: React.CSSProperties = { ...toolbarRow };

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function SaveTargets({ lang, getApi }: {
  lang: "zh-CN" | "en";
  getApi: () => ExcalidrawImperativeAPI | null;
}) {
  const zh = lang === "zh-CN";
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = useState(false);
  const [bridgeBase, setBridgeBase] = useState(() => {
    try { return localStorage.getItem(BRIDGE_KEY) || DEFAULT_BRIDGE; } catch { return DEFAULT_BRIDGE; }
  });
  const [health, setHealth] = useState<null | { ok: boolean; providers: Record<string, any> }>(null);
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [wd, setWd] = useState({ url: "", username: "", password: "", directory: "" });
  const winRef = useRef<Window | null>(null);

  const say = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000); };

  const apiUrl = useCallback((p: string) => `${bridgeBase.replace(/\/+$/, "")}${p}`, [bridgeBase]);

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/config"), { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const c = (await r.json()) as BridgeConfig;
      setConfig(c);
      setWd((prev) => ({ ...prev, url: c.webdav.url || prev.url, username: c.webdav.username || prev.username }));
      setHealth({ ok: true, providers: {} });
    } catch {
      setConfig(null);
      setHealth({ ok: false, providers: {} });
    }
  }, [apiUrl]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  // OAuth 回调页会 postMessage 回来 → 授权完成后立刻刷新状态
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "save-bridge-oauth") {
        void loadConfig();
        say(e.data.ok ? "ok" : "err", e.data.ok ? t("授权完成", "Authorised") : t("授权失败", "Authorisation failed"));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [loadConfig]);

  const serialize = useCallback((): { filename: string; content: string } | null => {
    const api = getApi();
    if (!api) return null;
    const appState = api.getAppState() as any;
    const name = String(appState?.name || "Untitled");
    const content = serializeAsJSON(api.getSceneElementsIncludingDeleted() as any, appState, api.getFiles() as any, "local");
    const filename = name.endsWith(".excalidraw") ? name : `${name}.excalidraw`;
    return { filename, content };
  }, [getApi]);

  const withBusy = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag);
    try { await fn(); } catch (e: any) { say("err", String(e?.message || e)); } finally { setBusy(""); }
  };

  const saveLocal = () => withBusy("local", async () => {
    const d = serialize();
    if (!d) throw new Error(t("画布尚未就绪", "Canvas not ready"));
    download(d.filename, d.content);
    say("ok", t(`已保存 ${d.filename}`, `Saved ${d.filename}`));
  });

  const saveConfig = () => withBusy("cfg", async () => {
    const r = await fetch(apiUrl("/config"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webdav: { url: wd.url, username: wd.username, password: wd.password, directory: wd.directory },
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setWd((p) => ({ ...p, password: "" }));
    await loadConfig();
    say("ok", t("WebDAV 配置已保存", "WebDAV settings saved"));
  });

  const testWebdav = () => withBusy("wdtest", async () => {
    const r = await fetch(apiUrl("/webdav/test"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: wd.url, username: wd.username, password: wd.password || undefined }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    say("ok", t("WebDAV 连接正常", "WebDAV connection OK"));
  });

  const saveWebdav = () => withBusy("wd", async () => {
    const d = serialize();
    if (!d) throw new Error(t("画布尚未就绪", "Canvas not ready"));
    const r = await fetch(apiUrl("/webdav/upload"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    say("ok", t(`已上传到 ${j.savedTo}`, `Uploaded to ${j.savedTo}`));
  });

  const authorize = (provider: string) => withBusy(`auth-${provider}`, async () => {
    const r = await fetch(apiUrl(`/oauth/start?provider=${provider}&redirectBase=${encodeURIComponent(bridgeBase)}`));
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    winRef.current = window.open(j.url, "save-bridge-oauth", "width=620,height=720");
    if (!winRef.current) throw new Error(t("浏览器拦截了弹窗，请允许后重试", "Popup blocked — please allow popups"));
  });

  const saveProvider = (provider: string) => withBusy(provider, async () => {
    const d = serialize();
    if (!d) throw new Error(t("画布尚未就绪", "Canvas not ready"));
    const r = await fetch(apiUrl(`/upload?provider=${provider}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    say("ok", t(`已保存到 ${j.savedTo || provider}`, `Saved to ${j.savedTo || provider}`));
  });

  const disconnect = (provider: string) => withBusy(`off-${provider}`, async () => {
    await fetch(apiUrl("/oauth/disconnect"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    await loadConfig();
    say("ok", t("已断开并删除本机保存的凭据", "Disconnected, local credentials removed"));
  });

  const manual = (url: string, label: string) => withBusy("manual", async () => {
    const d = serialize();
    if (!d) throw new Error(t("画布尚未就绪", "Canvas not ready"));
    download(d.filename, d.content);
    window.open(url, "_blank", "noopener");
    say("ok", t(`已导出 ${d.filename}，并打开${label}，把文件拖进去即可`, `Exported ${d.filename} and opened ${label} — drop the file in`));
  });

  const providerRows = useMemo(() => Object.entries(config?.providers || {}), [config]);
  const connected = config?.connected || {};

  return (
    <>
      <button
        data-testid="save-targets-toggle"
        title={t("保存到：本地 / WebDAV / 网盘", "Save to: local / WebDAV / cloud drive")}
        onClick={() => { setOpen(true); void loadConfig(); }}
        style={btn}>
        {t("保存到…", "Save to…")}
      </button>

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.45)" }}
             onClick={() => setOpen(false)}>
          <div
            data-testid="save-targets-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", top: "8vh", left: "50%", transform: "translateX(-50%)",
              width: "min(560px, 94vw)", maxHeight: "80vh", overflow: "auto",
              padding: 16, borderRadius: 12,
              background: "var(--island-bg-color, #fff)", color: "var(--text-primary-color, #343a40)",
              border: "1px solid var(--color-border-outline, #ced4da)",
              boxShadow: "0 12px 40px rgba(0,0,0,.35)",
            }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500, flex: 1 }}>{t("保存到…", "Save to…")}</h3>
              <button style={btn} onClick={() => setOpen(false)}>{t("关闭", "Close")}</button>
            </div>

            {msg && (
              <div style={{
                marginBottom: 10, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                background: msg.kind === "ok" ? "rgba(105,219,124,.14)" : "rgba(255,135,135,.14)",
                color: msg.kind === "ok" ? "#2f9e44" : "#c92a2a",
              }}>{msg.text}</div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={sectionTitle}>{t("本机中转服务", "Local bridge")}</div>
              <div style={row}>
                <input style={{ ...input, width: 240 }} value={bridgeBase}
                       onChange={(e) => setBridgeBase(e.target.value)}
                       onBlur={() => { try { localStorage.setItem(BRIDGE_KEY, bridgeBase); } catch { /* ignore */ } }} />
                <button style={btn} onClick={() => void loadConfig()}>{t("重连", "Reconnect")}</button>
              </div>
              <div style={{ ...hint, marginTop: 4 }}>
                {health?.ok
                  ? t("已连接。", "Connected.")
                  : t("未连接：请先运行 node tools/save-bridge.mjs（移动端需把地址换成主机的局域网 IP）",
                      "Not reachable: run node tools/save-bridge.mjs (on other devices use the host's LAN IP)")}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--color-border-outline, #dee2e6)", paddingTop: 12, marginBottom: 12 }}>
              <div style={sectionTitle}>{t("本地文件", "Local file")}</div>
              <button style={btn} disabled={!!busy} onClick={() => void saveLocal()}>
                {t("保存为 .excalidraw 文件", "Save .excalidraw file")}
              </button>
            </div>

            <div style={{ borderTop: "1px solid var(--color-border-outline, #dee2e6)", paddingTop: 12, marginBottom: 12 }}>
              <div style={sectionTitle}>{t("WebDAV（坚果云 / Nextcloud / 群晖 …）", "WebDAV (Jianguoyun / Nextcloud / Synology …)")}</div>
              <div style={{ display: "grid", gap: 6 }}>
                <input style={input} placeholder="https://dav.jianguoyun.com/dav/" value={wd.url}
                       onChange={(e) => setWd({ ...wd, url: e.target.value })} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <input style={input} placeholder={t("用户名/邮箱", "username")} value={wd.username}
                         onChange={(e) => setWd({ ...wd, username: e.target.value })} />
                  <input style={input} type="password"
                         placeholder={config?.webdav.hasPassword ? t("应用密码（已保存，留空不改）", "app password (saved)") : t("应用密码", "app password")}
                         value={wd.password} onChange={(e) => setWd({ ...wd, password: e.target.value })} />
                </div>
                <input style={input} placeholder={t("子目录（可选）", "subdirectory (optional)")} value={wd.directory}
                       onChange={(e) => setWd({ ...wd, directory: e.target.value })} />
              </div>
              <div style={{ ...row, marginTop: 8 }}>
                <button style={btn} disabled={!!busy} onClick={() => void saveConfig()}>{t("保存配置", "Save settings")}</button>
                <button style={btn} disabled={!!busy} onClick={() => void testWebdav()}>{t("测试连接", "Test")}</button>
                <button style={btn} disabled={!!busy} onClick={() => void saveWebdav()}>{t("保存到 WebDAV", "Save to WebDAV")}</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--color-border-outline, #dee2e6)", paddingTop: 12, marginBottom: 12 }}>
              <div style={sectionTitle}>{t("网盘直连（需各自注册应用拿 client_id）", "Cloud drives (each needs its own client_id)")}</div>
              {!config && <div style={hint}>{t("中转服务未连接，无法读取配置。", "Bridge not connected.")}</div>}
              {providerRows.map(([id, p]) => {
                const isOn = !!connected[id];
                return (
                  <div key={id} style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                    <div style={{ ...row, justifyContent: "space-between" }}>
                      <strong style={{ fontSize: 12 }}>{id === "gdrive" ? t("Google 云端硬盘", "Google Drive") : id === "dropbox" ? "Dropbox" : "OneDrive"}</strong>
                      <span style={{ ...hint, color: isOn ? "#2f9e44" : undefined }}>
                        {isOn ? t("已连接", "connected") : t("未授权", "not authorised")}
                      </span>
                    </div>
                    <div style={row}>
                      <input style={{ ...input, flex: 1, minWidth: 160 }} placeholder="client_id"
                             value={p.clientId}
                             onChange={(e) => setConfig((c) => c ? { ...c, providers: { ...c.providers, [id]: { clientId: e.target.value } } } : c)} />
                      <button style={btn} disabled={!!busy} onClick={() => withBusy(`cfg-${id}`, async () => {
                        await fetch(apiUrl("/config"), {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ providers: { [id]: { clientId: p.clientId } } }),
                        });
                        await loadConfig();
                        say("ok", t("client_id 已保存", "client_id saved"));
                      })}>{t("保存", "Save")}</button>
                      {isOn ? (
                        <>
                          <button style={btn} disabled={!!busy} onClick={() => void saveProvider(id)}>{t("保存到此处", "Save here")}</button>
                          <button style={btn} disabled={!!busy} onClick={() => void disconnect(id)}>{t("断开", "Disconnect")}</button>
                        </>
                      ) : (
                        <button style={btn} disabled={!!busy || !p.clientId} onClick={() => void authorize(id)}>{t("授权", "Authorise")}</button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={hint}>{t("注册后把回调地址填成上面的中转服务地址 + /oauth/callback。", "Register the callback as <bridge>/oauth/callback.")}</div>
            </div>

            <div style={{ borderTop: "1px solid var(--color-border-outline, #dee2e6)", paddingTop: 12 }}>
              <div style={sectionTitle}>{t("其他网盘（导出文件并打开上传页）", "Other drives (export + open upload page)")}</div>
              <div style={row}>
                {(config?.manualTargets || []).map((m) => (
                  <button key={m.id} style={btn} disabled={!!busy}
                          onClick={() => void manual(m.url, zh ? m.label.zh : m.label.en)}>
                    {zh ? m.label.zh : m.label.en}
                  </button>
                ))}
              </div>
            </div>

            {busy && <div style={{ ...hint, marginTop: 8 }}>{t("处理中…", "Working…")}</div>}
          </div>
        </div>
      )}
    </>
  );
}
