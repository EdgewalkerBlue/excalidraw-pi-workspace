// 画布协作同步客户端（对接 mcp-excalidraw-server sync-guard v7 协议）
//
// 上行：onChange 防抖 5s → POST /api/elements/sync（全量 + X-Client-Id）；
//       本端删除的元素（与上次成功 sync 的差集）立即显式 DELETE（墓碑，即时生效）。
// 下行：WS element_created/updated/deleted 单元素增量合并（不整场景替换，
//       防抖期内未上传的本地编辑不会被覆盖）；WS initial_elements 仅在
//       新连接时到达——与本地未同步元素合并后再应用。
// 闸门（T-20260923-006 待做 A，防「异常缩水场景覆盖/删除服务端完整场景」）：
//   1) 首连闸门：未拿到初始场景（HTTP fetchScene 或 WS initial_elements 任一）前不上行；
//   2) 缩水闸门：本端场景远小于上次成功上行（isShrunkVsLastSync）时跳过上行与墓碑，
//      保留 pending 等场景回填；服务端 v7 闸门（409）为权威兜底，收到后 30s 重试。
export type CanvasElement = Record<string, any>;

const CID_KEY = "pi-canvas-client-id";

/** 缩水判定：上次成功上行基数较大（>10）而本次不足其一半。合法大批删除不误伤：
 *  Excalidraw 删除元素在 onChange 全量数组中保留 isDeleted 槽位，数量不会缩水。 */
export function isShrunkVsLastSync(lastCount: number, nextCount: number): boolean {
  return lastCount > 10 && nextCount * 2 < lastCount;
}

export type SyncRejectInfo = {
  kind: "shrunk-local" | "shrunk-server";
  localCount?: number;
  serverCount?: number;
  message?: string;
};

/** GET/POST /api/appearance 与 WS appearance_updated 的外观载荷（T-20260924-001） */
export type AppearanceSync = {
  theme?: string;
  viewBackgroundColor?: string;
  updatedAt?: number;
};

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
  private initialReceived = false; // 首连闸门：拿到初始场景前禁止上行
  private rejectStreak = 0; // 连续被闸门拒绝的次数（成功上行后清零并通知恢复）

  constructor(
    private handlers: {
      onInitial: (elements: CanvasElement[]) => void;
      onCreated: (element: CanvasElement) => void;
      onUpdated: (element: CanvasElement) => void;
      onDeleted: (elementId: string) => void;
      onRejected?: (info: SyncRejectInfo) => void;
      onRecovered?: () => void;
      onAppearance?: (appearance: AppearanceSync) => void;
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
          if (Array.isArray(d.elements)) {
            this.markSceneLoaded();
            this.handlers.onInitial(d.elements);
            if (this.pending) this.scheduleSync(this.pending); // 闸门已释放，续传积压
          }
          break;
        case "element_created":
          if (d.element) this.handlers.onCreated(d.element);
          break;
        case "element_updated":
          if (d.element) this.handlers.onUpdated(d.element);
          break;
        case "element_deleted":
          if (d.elementId) {
            // 服务端已删：从上行基数剔除，避免下次 flush 的缩水判定误伤
            this.lastSyncedIds?.delete(d.elementId);
            this.handlers.onDeleted(d.elementId);
          }
          break;
        case "appearance_updated":
          if (d.appearance) this.handlers.onAppearance?.(d.appearance);
          break;
      }
    });
    ws.addEventListener("close", () => {
      if (this.destroyed) return;
      const delay = Math.min(15000, 1000 * Math.pow(2, this.wsRetry++));
      window.setTimeout(() => this.connectWs(), delay);
    });
  }

  /** HTTP 首载场景成功后调用——与 WS initial_elements 任一到达即视为已拿到初始场景 */
  markSceneLoaded() {
    if (this.initialReceived) return;
    this.initialReceived = true;
    if (this.pending) this.scheduleSync(this.pending); // 闸门释放，续传积压
  }

  /** 本地场景变化（onChange）——防抖全量上传 */
  scheduleSync(elements: CanvasElement[]) {
    this.pending = elements;
    if (!this.initialReceived) return; // 首连闸门：未拿初始场景前不上行（积压待释放）
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  /** 立即上传（如页面 unload 前） */
  async flush(): Promise<void> {
    if (!this.pending) return;
    const elements = this.pending;
    const ids = new Set(elements.map((e) => e.id));
    // 缩水闸门（客户端预检）：场景远小于上次成功上行 → 不上行也不发墓碑。
    // 防旧 bundle 缺陷/异常重置的缩水场景借墓碑直删服务端（墓碑端点无 guard）。
    // 保留 pending，等 WS initial/刷新回填场景后自动恢复。
    if (this.lastSyncedIds && isShrunkVsLastSync(this.lastSyncedIds.size, ids.size)) {
      console.warn(`[sync] 本端场景 ${ids.size} 远小于上次上行 ${this.lastSyncedIds.size}，跳过上行与墓碑删除（等场景回填）`);
      this.rejectStreak++;
      this.handlers.onRejected?.({ kind: "shrunk-local", localCount: ids.size, serverCount: this.lastSyncedIds.size });
      return;
    }
    this.pending = null;
    if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
    const last = this.lastSyncedIds;
    // 删除墓碑：上次有、这次没有 → 本端刚删除的元素，显式 DELETE 即时生效
    if (last) {
      for (const rid of last) {
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
        // keepalive：beforeunload flush 依赖本请求在页面导航后仍能发出
        //（否则防抖 5s 内刷新的最后一批编辑——典型如刚画的 frame——会被浏览器掐断丢失；
        // 规格上限 64KB，超大场景兜底仍有防抖与下次上行）。
        keepalive: true,
      });
      if (r.status === 409) {
        // 服务端缩水闸门（v7）拒绝：保留待传，30s 后重试；场景回填后自动通过
        this.pending = elements;
        this.rejectStreak++;
        let info: SyncRejectInfo = { kind: "shrunk-server" };
        try {
          const j = await r.json();
          info = { kind: "shrunk-server", serverCount: j?.beforeCount, localCount: ids.size, message: j?.message };
        } catch { /* 响应体解析失败不影响拒绝处理 */ }
        this.handlers.onRejected?.(info);
        this.timer = window.setTimeout(() => { void this.flush(); }, 30000);
        return;
      }
      if (r.ok) {
        this.lastSyncedIds = ids;
        if (this.rejectStreak > 0) {
          this.rejectStreak = 0;
          this.handlers.onRecovered?.();
        }
      }
    } catch { /* 网络失败：下次 onChange/心跳重试 */ }
  }
}
