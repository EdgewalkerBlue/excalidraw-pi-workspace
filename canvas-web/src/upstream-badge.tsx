// 画布 WebUI 的「官方底层更新自检」提醒。
// 判定规则复用 upstream-core.mjs（与 tools/check-upstream.mjs 同一份 SSOT，避免平行实现）。
//
// 行为约定：
//   · 每 24h 检查一次（localStorage 节流），结果缓存，跨刷新立即可见；
//   · 只有**拿到有效结果**才写 24h 时间戳 —— 离线/限流不会白等一整天；
//   · GitHub 未认证接口限流（403/429）时，徽标**可见地**显示「自检被限流 + 预计重试时间」，
//     并在配额重置前不再发请求（避免无意义地继续消耗）；真离线则保持静默；
//   · 「官方新构建」状态下点击徽标 = 一键自动更新：POST /api/upstream/apply-update
//     （服务端 patch 注入，安装官方包→同步基线→安全重构建），每 2s 轮询进度；
//     服务端端点缺失（旧 server 未重启）时回退为复制手动升级命令；更新成功后清掉
//     本地缓存结果，刷新页面即重新自检（否则 24h 节流会让旧结论多挂一天）。
import { useCallback, useEffect, useState } from "react";
import { CHECK_INTERVAL, UPSTREAM_ENDPOINTS, assess } from "./upstream-core.mjs";
import { toolbarBadge } from "./toolbar-style";

const CHECK_KEY = "pi-canvas-upstream-check";
const RESULT_KEY = "pi-canvas-upstream-result";
const RETRY_KEY = "pi-canvas-upstream-retry"; // 限流窗口：在此之前不发请求

type Assessed = ReturnType<typeof assess>;

/** GET /api/upstream/update-status 的返回（服务端 patch 注入端点） */
type UpdStatus = {
  success: boolean;
  running: boolean;
  phase: string;
  ok: boolean | null;
  version: string;
  error: string;
  log: string[];
};

const jsonHeaders = { Accept: "application/json" };

/** 带 HTTP 状态的错误，便于把 403/429 单独识别为「限流」而非「离线」 */
class HttpError extends Error {
  status: number;
  resetAt?: number;
  constructor(url: string, status: number, resetAt?: number) {
    super(`${url} -> ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.resetAt = resetAt;
  }
}

async function fetchJson(url: string, headers?: Record<string, string>) {
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json", ...headers } });
  if (!r.ok) {
    // GitHub 用 x-ratelimit-reset 给出配额重置时刻（epoch 秒）
    const raw = r.headers.get("x-ratelimit-reset");
    const reset = raw ? Number(raw) : NaN;
    throw new HttpError(url, r.status, Number.isFinite(reset) ? reset : undefined);
  }
  return r.json();
}

async function probe(): Promise<Assessed> {
  let blocked: { status: number; resetAt?: number } | undefined;
  let head: any = null;
  try {
    head = await fetchJson(UPSTREAM_ENDPOINTS.head);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 429)) {
      blocked = { status: e.status, resetAt: e.resetAt };
    } else {
      throw e; // 真离线 / 其它网络错误：交给调用方静默
    }
  }
  const master = { sha: String(head?.sha || ""), date: String(head?.commit?.committer?.date || "") };
  const base = String(__CANVAS_BASELINE__.commit);
  const [compare, tags] = await Promise.all([
    head ? fetchJson(UPSTREAM_ENDPOINTS.compare(base)).catch(() => null) : Promise.resolve(null),
    // npm registry 无 CORS 头：走画布服务器同源代理（旧 server 未注入该端点时退化为无构建信息）
    fetchJson(UPSTREAM_ENDPOINTS.npmTagsProxy, jsonHeaders).catch(() => null),
  ]);
  return assess(__CANVAS_BASELINE__, {
    master,
    compare: compare ? { total_commits: compare.total_commits, commits: compare.commits || [] } : undefined,
    tags: tags || undefined,
    blocked,
  });
}

/** 更新成功后清掉自检缓存：否则 24h 节流会让「有新构建」的旧结论在刷新后继续挂一天 */
function clearCachedResult() {
  try {
    localStorage.removeItem(RESULT_KEY);
    localStorage.removeItem(CHECK_KEY);
    localStorage.removeItem(RETRY_KEY);
  } catch { /* ignore */ }
}

const UPD_PHASE_LABELS: Record<string, { zh: string; en: string }> = {
  starting: { zh: "准备更新…", en: "preparing…" },
  "": { zh: "准备更新…", en: "preparing…" },
  install: { zh: "安装官方构建…", en: "installing official build…" },
  baseline: { zh: "同步构建基线…", en: "syncing baseline…" },
  build: { zh: "重构建前端…", en: "rebuilding frontend…" },
};

export default function UpstreamBadge({ lang }: { lang: "zh-CN" | "en" }) {
  const t = (zh: string, en: string) => (lang === "zh-CN" ? zh : en);
  const [state, setState] = useState<Assessed | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdStatus | null>(null);
  const zh = lang === "zh-CN";

  // 先读缓存结果，保证每次进画布都能看到上一次的结论（含限流提示）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESULT_KEY);
      if (raw) setState(JSON.parse(raw) as Assessed);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async (force: boolean) => {
    let now = Date.now();
    let retryAt = 0;
    let last = 0;
    try {
      retryAt = Number(localStorage.getItem(RETRY_KEY)) || 0;
      last = Number(localStorage.getItem(CHECK_KEY)) || 0;
    } catch { /* ignore */ }
    if (!force) {
      if (retryAt && now < retryAt) return; // 限流窗口内：直接用缓存状态渲染
      if (now - last < CHECK_INTERVAL) return; // 24h 节流
    }
    try {
      const result = await probe();
      if (result.state === "unknown") return; // 真离线：静默
      setState(result);
      try {
        localStorage.setItem(RESULT_KEY, JSON.stringify(result));
        if (result.state === "rate-limited") {
          // 记下重试时刻（拿不到就用 10 分钟兜底），期间不再发请求
          localStorage.setItem(RETRY_KEY, String(result.resetAt || now + 10 * 60 * 1000));
        } else {
          localStorage.setItem(CHECK_KEY, String(now));
          localStorage.removeItem(RETRY_KEY);
        }
      } catch { /* ignore */ }
    } catch { /* 离线/限流：静默，下次再试 */ }
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  const flashCopied = (msg: string) => {
    setCopied(msg);
    window.setTimeout(() => setCopied(null), 2500);
  };

  const copyCommand = async () => {
    const cmd = state?.command;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      flashCopied(t("已复制升级命令", "upgrade cmd copied"));
    } catch { /* ignore */ }
  };

  const copyUpdLog = async () => {
    const text = [upd?.error ? `错误: ${upd.error}` : "", ...(upd?.log || [])].filter(Boolean).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(t("已复制诊断日志", "diagnostic log copied"));
    } catch { /* ignore */ }
  };

  // 轮询服务端更新进度（2s），任务结束后停表；成功则清缓存让刷新后立即重新自检。
  // 每次 fetch 带 10s 超时 + no-store：连接意外挂起时 10s 后自愈重试，绝不永久卡死；
  // 也防任何缓存层把 running=true 的旧响应反复回给循环（实测会导致徽标停在「更新中」）。
  const pollUpdate = useCallback(async () => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await fetch("/api/upstream/update-status", { headers: jsonHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue; // 服务端瞬时不可达：继续轮询
        const j = (await r.json()) as UpdStatus;
        if (!j?.success) continue;
        setUpd(j);
        if (!j.running) {
          if (j.ok === true) clearCachedResult();
          return;
        }
      } catch { /* 网络抖动/超时：继续轮询 */ }
    }
  }, []);

  // 立即向服务端同步一次真实任务状态（点击「更新中」徽标时的自愈入口：
  // 若轮询循环曾因异常停滞，一次点击即可让徽标回到与服务器一致的状态）
  const resyncUpdate = useCallback(async () => {
    try {
      const r = await fetch("/api/upstream/update-status", { headers: jsonHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!r.ok) return;
      const j = (await r.json()) as UpdStatus;
      if (!j?.success) return;
      setUpd(j);
      if (!j.running && j.ok === true) clearCachedResult();
    } catch { /* 保持当前显示 */ }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!state || state.state !== "build-available") return;
    setUpd({ success: true, running: true, phase: "starting", ok: null, version: state.build.version, error: "", log: [] });
    try {
      const r = await fetch("/api/upstream/apply-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: state.build.version, sha: state.build.sha, date: state.masterDate }),
      });
      if (r.status === 404) {
        // 服务端端点未注入（旧 server 进程未重启过）→ 回退为复制手动命令，不隐藏该限制
        setUpd(null);
        try {
          await navigator.clipboard.writeText(state.command);
          flashCopied(t("服务端未就绪，已复制升级命令", "server endpoint missing; cmd copied"));
        } catch { /* ignore */ }
        return;
      }
      if (!r.ok && r.status !== 409) {
        // 409 = 已有任务在跑 → 转为跟随轮询；其余状态按失败处理并保留原因
        const j = await r.json().catch(() => null);
        throw new Error(j?.message || `HTTP ${r.status}`);
      }
      void pollUpdate();
    } catch (e) {
      setUpd({
        success: true, running: false, phase: "failed", ok: false,
        version: state.build.version, error: e instanceof Error ? e.message : String(e), log: [],
      });
    }
  }, [state, pollUpdate]);

  if (!state || state.state === "unknown") return null;

  const warn = state.state === "build-available" || state.state === "source-only";
  const limited = state.state === "rate-limited";
  const base = state.baseline;
  const label = `${base.commit}${base.date ? ` · ${base.date}` : ""}`;
  const updRunning = !!upd?.running;
  const updPhase = upd ? (UPD_PHASE_LABELS[upd.phase] || UPD_PHASE_LABELS[""]) : null;

  let text: string;
  if (copied) {
    text = copied;
  } else if (upd) {
    if (upd.running) text = t(`更新中：${updPhase?.zh || "处理中…"}`, `updating: ${updPhase?.en || "working…"}`);
    else if (upd.ok === true) text = t(`✓ 已更新 ${upd.version} — 点击刷新`, `✓ updated ${upd.version} — click to reload`);
    else text = t(`✗ 更新失败 — 点击复制日志`, `✗ update failed — click to copy log`);
  } else if (limited) {
    text = t(
      `自检被限流${state.resetLabel ? `，${state.resetLabel} 后重试` : ""}`,
      `self-check rate-limited${state.resetLabel ? `, retry after ${state.resetLabel}` : ""}`,
    );
  } else {
    text = `${label} · ${state.short[zh ? "zh" : "en"]}`;
  }

  let titleText: string;
  if (upd && !upd.running) {
    const tail = (upd.log || []).slice(-6).join("\n");
    titleText = upd.ok === true
      ? t(`更新完成 ${upd.version}。点击刷新页面加载新构建（PWA 客户端可能需刷新两次）。`, `Update finished ${upd.version}. Click to reload (PWA clients may need two refreshes).`)
      : `${t("更新失败", "Update failed")}${upd.error ? `: ${upd.error}` : ""}${tail ? `\n${tail}` : ""}`;
  } else if (updRunning) {
    titleText = (upd?.log || []).slice(-6).join("\n") || t("更新进行中…", "update in progress…");
  } else {
    titleText = state.title[zh ? "zh" : "en"];
  }

  const onClick = () => {
    if (upd) {
      if (upd.running) { void resyncUpdate(); return; } // 更新中：点击立即对齐服务端真实状态
      if (upd.ok === true) { window.location.reload(); return; }
      void copyUpdLog(); // 失败：复制诊断日志（错误保持可见，不静默）
      return;
    }
    if (state.state === "build-available") { void startUpdate(); return; }
    void copyCommand();
    if (!limited) void refresh(true);
  };

  const bg = upd
    ? upd.ok === true ? "#d3f9d8" : upd.ok === false ? "#ffe3e3" : "#fff3bf"
    : warn ? "#fff3bf" : "var(--island-bg-color, #f1f3f5)";
  const border = upd
    ? upd.ok === true ? "#69db7c" : upd.ok === false ? "#ffa8a8" : "#ffd43b"
    : warn ? "#ffd43b" : limited ? "#adb5bd" : "var(--color-border-outline, #dee2e6)";
  const color = upd
    ? upd.ok === true ? "#2b8a3e" : upd.ok === false ? "#c92a2a" : "#664d03"
    : warn ? "#664d03" : "var(--text-primary-color, #495057)";

  const icon = upd ? (upd.running ? "⏳ " : upd.ok === true ? "✓ " : "✗ ") : warn ? "⬆ " : limited ? "⏳ " : "✓ ";

  return (
    <div
      role="button"
      title={titleText}
      onClick={onClick}
      style={toolbarBadge({
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
        cursor: updRunning ? "progress" : upd || state.command ? "pointer" : "default",
        userSelect: "none",
      })}>
      {icon}
      {text}
    </div>
  );
}
