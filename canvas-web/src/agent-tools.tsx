// Agent 协作工具条（二开功能，替代旧 DOM 注入脚本 send-to-agent.js）
// 协议与 tools/agent-notify.mjs（:5010）对齐：notify/approve/reject/task-set/snapshot/health
import { useCallback, useEffect, useRef, useState } from "react";

const NOTIFY_BASE = `//${location.hostname}:5010`;
const BLUE = "#1971c2", GREEN = "#2f9e44", YELLOW = "#f08c00", RED = "#e03131";

type Health = { pending?: boolean; approved?: boolean } | null;

async function notify(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${NOTIFY_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} http ${r.status}`);
  return r.json();
}

async function elementCount(): Promise<number> {
  try {
    const r = await fetch("/api/elements", { cache: "no-store" });
    const j = await r.json();
    const arr = Array.isArray(j) ? j : j.elements || [];
    return arr.length;
  } catch { return -1; }
}

const btn = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
  backgroundColor: bg, color: "#fff", border: "none", borderRadius: 4,
  padding: "6px 12px", marginLeft: 6, cursor: "pointer", fontSize: 14,
  fontFamily: "inherit", ...extra,
});

export default function AgentTools({ lang }: { lang: "zh-CN" | "en" }) {
  const t = (zh: string, en: string) => (lang === "zh-CN" ? zh : en);
  const [sendState, setSendState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [approveState, setApproveState] = useState<"hidden" | "idle" | "busy" | "done" | "error">("hidden");
  const [rejectState, setRejectState] = useState<"hidden" | "idle" | "busy" | "error">("hidden");
  const [tasksetState, setTasksetState] = useState<{ s: "idle" | "busy" | "ok" | "err"; msg?: string }>({ s: "idle" });
  const timerRef = useRef<number | null>(null);

  const pollHealth = useCallback(async () => {
    try {
      const r = await fetch(`${NOTIFY_BASE}/health`);
      const h: Health = await r.json();
      if (h?.approved) {
        setApproveState("done");
        setRejectState("idle");
      } else if (h?.pending) {
        setApproveState((s) => (s === "done" ? s : "idle"));
        setRejectState("idle");
      } else {
        setApproveState("hidden");
        setRejectState("hidden");
      }
    } catch { /* 服务不可达：保持现状 */ }
  }, []);

  useEffect(() => {
    const iv = window.setInterval(() => { void pollHealth(); }, 3000);
    void pollHealth();
    return () => window.clearInterval(iv);
  }, [pollHealth]);

  const sendToAgent = async () => {
    setSendState("busy");
    try {
      const n = await elementCount();
      await notify("/notify", { source: "webui", elements: n, sent_at: new Date().toISOString() });
      notify("/snapshot", { source: "webui" }).catch(() => {});
      setSendState("sent");
      setApproveState("idle"); setRejectState("idle");
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setSendState("idle"), 1000);
    } catch { setSendState("error"); window.setTimeout(() => setSendState("idle"), 2500); }
  };

  const approve = async () => {
    setApproveState("busy");
    try {
      const n = await elementCount();
      await notify("/approve", { source: "webui", elements: n, approved_at: new Date().toISOString() });
      setApproveState("done");
    } catch { setApproveState("error"); window.setTimeout(() => { void pollHealth(); }, 2000); }
  };

  const reject = async () => {
    setRejectState("busy");
    try {
      const n = await elementCount();
      await notify("/reject", { source: "webui", elements: n, rejected_at: new Date().toISOString() });
      setRejectState("hidden");
      setApproveState("hidden");
    } catch { setRejectState("error"); window.setTimeout(() => { setRejectState("idle"); }, 2000); }
  };

  const sendTaskSet = async () => {
    setTasksetState({ s: "busy" });
    try {
      const data = await notify("/task-set", {});
      const ps: any[] = data.projects || [];
      const added = ps.reduce((s, p) => s + (p.added || 0), 0);
      const errs = ps.filter((p) => p.error);
      if (errs.length && added === 0) throw new Error(errs.map((p) => `${p.frame}: ${p.error}`).join("; "));
      setTasksetState({ s: "ok", msg: added > 0 ? t(`✓ 已写入 ${added} 项`, `✓ Written ${added}`) : t("✓ 无新增任务", "✓ No new tasks") });
    } catch (e: any) {
      setTasksetState({ s: "err", msg: e?.message || "err" });
    }
    window.setTimeout(() => setTasksetState({ s: "idle" }), 2500);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
      <button style={btn(sendState === "sent" ? GREEN : sendState === "error" ? RED : BLUE)}
        disabled={sendState === "busy"}
        onClick={() => { void sendToAgent(); }}
        title={t("把画布变更通知给 Agent", "Notify agent about canvas changes")}>
        {sendState === "busy" ? t("发送中…", "Sending...")
          : sendState === "sent" ? t("已发送", "Sent ✓")
          : sendState === "error" ? t("通知失败", "Notify failed")
          : t("发送给 Agent", "Send to Agent")}
      </button>

      <button style={btn(YELLOW, { display: approveState === "hidden" ? "none" : undefined })}
        disabled={approveState === "done" || approveState === "busy"}
        onClick={() => { void approve(); }}
        title={t("请严肃审查画布内容，再点击执行", "Review the canvas carefully before executing")}>
        {approveState === "done" ? t("✓ 已批准", "✓ Approved")
          : approveState === "busy" ? t("批准中…", "Approving...")
          : t("批准", "Approve")}
      </button>

      <button style={btn(RED, { display: rejectState === "hidden" ? "none" : undefined })}
        disabled={rejectState === "busy"}
        onClick={() => { void reject(); }}>
        {rejectState === "busy" ? t("回退中…", "Reverting...") : t("拒绝", "Reject")}
      </button>

      <button style={btn(tasksetState.s === "ok" ? GREEN : tasksetState.s === "err" ? RED : "#7048e8")}
        disabled={tasksetState.s === "busy"}
        onClick={() => { void sendTaskSet(); }}
        title={t("把画布各项目框内容写入对应项目任务集", "Write canvas frames into project task sets")}>
        {tasksetState.s === "busy" ? t("写入中…", "Writing...")
          : tasksetState.s === "ok" ? (tasksetState.msg || "✓")
          : tasksetState.s === "err" ? (tasksetState.msg || "✗")
          : t("发送到任务集", "Send to Task Set")}
      </button>
    </div>
  );
}
