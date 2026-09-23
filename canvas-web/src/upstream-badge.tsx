// 画布 WebUI 的「官方底层更新自检」提醒。
// 判定规则复用 upstream-core.mjs（与 tools/check-upstream.mjs 同一份 SSOT，避免平行实现）。
//
// 行为约定：
//   · 每 24h 检查一次（localStorage 节流），结果缓存，跨刷新立即可见；
//   · 只有**拿到有效结果**才写 24h 时间戳 —— 离线/限流不会白等一整天；
//   · GitHub 未认证接口限流（403/429）时，徽标**可见地**显示「自检被限流 + 预计重试时间」，
//     并在配额重置前不再发请求（避免无意义地继续消耗）；真离线则保持静默。
import { useCallback, useEffect, useState } from "react";
import { CHECK_INTERVAL, UPSTREAM_ENDPOINTS, assess } from "./upstream-core.mjs";

const CHECK_KEY = "pi-canvas-upstream-check";
const RESULT_KEY = "pi-canvas-upstream-result";
const RETRY_KEY = "pi-canvas-upstream-retry"; // 限流窗口：在此之前不发请求

type Assessed = ReturnType<typeof assess>;

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
    fetchJson(UPSTREAM_ENDPOINTS.npmTags, jsonHeaders).catch(() => null),
  ]);
  return assess(__CANVAS_BASELINE__, {
    master,
    compare: compare ? { total_commits: compare.total_commits, commits: compare.commits || [] } : undefined,
    tags: tags || undefined,
    blocked,
  });
}

export default function UpstreamBadge({ lang }: { lang: "zh-CN" | "en" }) {
  const t = (zh: string, en: string) => (lang === "zh-CN" ? zh : en);
  const [state, setState] = useState<Assessed | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    const cmd = state?.command;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  if (!state || state.state === "unknown") return null;

  const warn = state.state === "build-available" || state.state === "source-only";
  const limited = state.state === "rate-limited";
  const base = state.baseline;
  const label = `${base.commit}${base.date ? ` · ${base.date}` : ""}`;
  const text = copied
    ? t("已复制升级命令", "upgrade cmd copied")
    : limited
      ? t(
          `自检被限流${state.resetLabel ? `，${state.resetLabel} 后重试` : ""}`,
          `self-check rate-limited${state.resetLabel ? `, retry after ${state.resetLabel}` : ""}`,
        )
      : `${label} · ${state.short[lang === "zh-CN" ? "zh" : "en"]}`;

  return (
    <div
      role="button"
      title={state.title[lang === "zh-CN" ? "zh" : "en"]}
      onClick={() => { void copy(); if (!limited) void refresh(true); }}
      style={{
        marginLeft: 6, padding: "4px 8px", borderRadius: 4, fontSize: 12,
        backgroundColor: warn ? "#fff3bf" : "#f1f3f5",
        border: `1px solid ${warn ? "#ffd43b" : limited ? "#adb5bd" : "#dee2e6"}`,
        color: warn ? "#664d03" : "#495057",
        cursor: state.command ? "pointer" : "default",
        whiteSpace: "nowrap", userSelect: "none", fontFamily: "inherit",
      }}>
      {warn ? "⬆ " : limited ? "⏳ " : "✓ "}
      {text}
    </div>
  );
}
