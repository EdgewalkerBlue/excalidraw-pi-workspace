// 画布协作同步客户端（对接 mcp-excalidraw-server sync-guard v6 协议）
//
// 上行：onChange 防抖 5s → POST /api/elements/sync（全量 + X-Client-Id）；
//       本端删除的元素（与上次成功 sync 的差集）立即显式 DELETE（墓碑，即时生效）。
// 下行：WS element_created/updated/deleted 单元素增量合并（不整场景替换，
//       防抖期内未上传的本地编辑不会被覆盖）；WS initial_elements 仅在
//       新连接时到达——与本地未同步元素合并后再应用。
export type CanvasElement = Record<string, any>;

const CID_KEY = "pi-canvas-client-id";
export function getClientId(): string {
  let cid: string | null = null;
  try { cid = localStorage.getItem(CID_KEY); } catch { /* ignore */ }
  if (!cid) {
    cid = "c-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
    try { localStorage.setItem(CID_KEY, cid); } catch { /* ignore */ }
  }
  return cid;
}

export async function fetchScene(): Promise<CanvasElement[]> {
  const r = await fetch("/api/elements", { cache: "no-store" });
  const j = await r.json();
  return Array.isArray(j) ? j : j.elements || [];
}

export class SyncClient {
  private lastSyncedIds: Set<string> | null = null;
  private timer: number | null = null;
  private pending: CanvasElement[] | null = null;
  private ws: WebSocket | null = null;
  private wsRetry = 0;
  private destroyed = false;

  constructor(
    private handlers: {
      onInitial: (elements: CanvasElement[]) => void;
      onCreated: (element: CanvasElement) => void;
      onUpdated: (element: CanvasElement) => void;
      onDeleted: (elementId: string) => void;
    },
    private debounceMs = 5000,
  ) {}

  start() {
    this.connectWs();
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }

  private connectWs() {
    if (this.destroyed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);
    this.ws = ws;
    ws.addEventListener("open", () => { this.wsRetry = 0; });
    ws.addEventListener("message", (ev) => {
      let d: any;
      try { d = JSON.parse(ev.data); } catch { return; }
      switch (d.type) {
        case "initial_elements":
          if (Array.isArray(d.elements)) this.handlers.onInitial(d.elements);
          break;
        case "element_created":
          if (d.element) this.handlers.onCreated(d.element);
          break;
        case "element_updated":
          if (d.element) this.handlers.onUpdated(d.element);
          break;
        case "element_deleted":
          if (d.elementId) this.handlers.onDeleted(d.elementId);
          break;
      }
    });
    ws.addEventListener("close", () => {
      if (this.destroyed) return;
      const delay = Math.min(15000, 1000 * Math.pow(2, this.wsRetry++));
      window.setTimeout(() => this.connectWs(), delay);
    });
  }

  /** 本地场景变化（onChange）——防抖全量上传 */
  scheduleSync(elements: CanvasElement[]) {
    this.pending = elements;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  /** 立即上传（如页面 unload 前） */
  async flush(): Promise<void> {
    if (!this.pending) return;
    const elements = this.pending;
    this.pending = null;
    if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
    const ids = new Set(elements.map((e) => e.id));
    // 删除墓碑：上次有、这次没有 → 本端刚删除的元素，显式 DELETE 即时生效
    if (this.lastSyncedIds) {
      for (const rid of this.lastSyncedIds) {
        if (!ids.has(rid)) {
          fetch(`/api/elements/${encodeURIComponent(rid)}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }
    try {
      const r = await fetch("/api/elements/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
        body: JSON.stringify({ elements, timestamp: new Date().toISOString() }),
      });
      if (r.ok) this.lastSyncedIds = ids;
    } catch { /* 网络失败：下次 onChange/心跳重试 */ }
  }
}
