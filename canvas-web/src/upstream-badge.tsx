// 画布 WebUI 的「官方底层更新自检」提醒。
// 判定规则复用 upstream-core.mjs（与 tools/check-upstream.mjs 同一份 SSOT，避免平行实现）。
// 每 24h 检查一次（localStorage 节流），结果缓存到 localStorage 以便跨刷新显示；
// 网络不可达 / API 限流时静默不打扰。
import { useCallback, useEffect, useState } from "react";
import { CHECK_INTERVAL, UPSTREAM_ENDPOINTS, assess } from "./upstream-core.mjs";

const CHECK_KEY = "pi-canvas-upstream-check";
const RESULT_KEY = "pi-canvas-upstream-result";

type Assessed = ReturnType<typeof assess>;

const jsonHeaders = { Accept: "application/json" };

async function fetchJson(url: string, headers?: Record<string, string>) {
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json", ...headers } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function probe(): Promise<Assessed> {
  const head = await fetchJson(UPSTREAM_ENDPOINTS.head);
  const master = {
    sha: String(head?.sha || ""),
    date: String(head?.commit?.committer?.date || ""),
  };
  const base = String(__CANVAS_BASELINE__.commit);
  const [compare, tags] = await Promise.all([
    fetchJson(UPSTREAM_ENDPOINTS.compare(base)).catch(() => null),
    fetchJson(UPSTREAM_ENDPOINTS.npmTags, jsonHeaders).catch(() => null),
  ]);
  return assess(__CANVAS_BASELINE__, {
    master,
    compare: compare ? { total_commits: compare.total_commits, commits: compare.commits || [] } : undefined,
    tags: tags || undefined,
  });
}

export default function UpstreamBadge({ lang }: { lang: "zh-CN" | "en" }) {
  const t = (zh: string, en: string) => (lang === "zh-CN" ? zh : en);
  const [state, setState] = useState<Assessed | null>(null);
  const [copied, setCopied] = useState(false);

  // 先读缓存结果，保证每次进画布都能看到当前基线/状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESULT_KEY);
      if (raw) setState(JSON.parse(raw) as Assessed);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async (force: boolean) => {
    let last = 0;
    try { last = Number(localStorage.getItem(CHECK_KEY)) || 0; } catch { /* ignore */ }
    if (!force && Date.now() - last < CHECK_INTERVAL) return;
    try {
      const result = await probe();
      if (result.state !== "unknown") {
        setState(result);
        try {
          localStorage.setItem(RESULT_KEY, JSON.stringify(result));
          localStorage.setItem(CHECK_KEY, String(Date.now()));
        } catch { /* ignore */ }
      }
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

  const stale = state.state !== "up-to-date";
  const base = state.baseline;
  const label = `${base.commit}${base.date ? ` · ${base.date}` : ""}`;
  return (
    <div
      role="button"
      title={state.title[lang === "zh-CN" ? "zh" : "en"]}
      onClick={() => { void copy(); void refresh(true); }}
      style={{
        marginLeft: 6, padding: "4px 8px", borderRadius: 4, fontSize: 12,
        backgroundColor: stale ? "#fff3bf" : "#f1f3f5",
        border: `1px solid ${stale ? "#ffd43b" : "#dee2e6"}`,
        color: stale ? "#664d03" : "#495057",
        cursor: state.command ? "pointer" : "default",
        whiteSpace: "nowrap", userSelect: "none", fontFamily: "inherit",
      }}>
      {stale ? "⬆ " : "✓ "}
      {copied
        ? t("已复制升级命令", "upgrade cmd copied")
        : `${label} · ${state.short[lang === "zh-CN" ? "zh" : "en"]}`}
    </div>
  );
}
