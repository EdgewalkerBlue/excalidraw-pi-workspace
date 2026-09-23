#!/usr/bin/env node
/**
 * 官方底层更新自检（命令行版）—— 与画布 WebUI 顶部徽标共用同一份判定规则
 * （canvas-web/src/upstream-core.mjs），避免两处平行实现。
 *
 * 作用：比对「本项目构建基线」与「Excalidraw 官方 master / 已发布构建」，并额外
 * 检测 package.json 实际安装版本与 canvas-web/vite.config.ts 里 __CANVAS_BASELINE__
 * 声明是否一致（两者漂移会导致画布里的提醒说谎）。
 *
 * 用法：
 *   npm run check:upstream
 *   node tools/check-upstream.mjs --json
 *
 * 退出码：0 已是官方最新（或离线无法判定）；1 有可升级项 / 基线漂移；
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { UPSTREAM_ENDPOINTS, assess, pickLatestBuild } from "../canvas-web/src/upstream-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "excalidraw-workspace", Accept: "application/json", ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode} ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("timeout " + url)); });
  });
}

/** 读构建基线：canvas-web/vite.config.ts 里 injected 的 __CANVAS_BASELINE__ */
function readBaseline() {
  const cfg = path.join(ROOT, "canvas-web", "vite.config.ts");
  const src = fs.readFileSync(cfg, "utf8");
  const m = src.match(/__CANVAS_BASELINE__:\s*JSON\.stringify\((\{[\s\S]*?\})\)/);
  if (!m) throw new Error("canvas-web/vite.config.ts 未找到 __CANVAS_BASELINE__");
  // 源片段是 TS 对象字面量（键无引号、可能含注释/尾逗号）→ 规范化后再解析
  const literal = m[1]
    .replace(/\/\/[^\n]*/g, "")
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(literal);
  } catch (e) {
    throw new Error(`解析 __CANVAS_BASELINE__ 失败（${e.message}）：${literal}`);
  }
}

/** 实际安装的 @excalidraw/excalidraw 版本（node_modules 为准，非 package.json 声明） */
function readInstalled() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "@excalidraw", "excalidraw", "package.json"), "utf8")).version;
  } catch { return null; }
}

async function main() {
  const jsonOnly = process.argv.includes("--json");
  const baseline = readBaseline();
  const installed = readInstalled();
  const fetched = {};
  const errors = [];

  await Promise.all([
    getJson(UPSTREAM_ENDPOINTS.head).then((v) => {
      fetched.master = { sha: v.sha, date: v.commit?.committer?.date };
    }).catch((e) => errors.push(`GitHub master: ${e.message}`)),
    getJson(UPSTREAM_ENDPOINTS.compare(baseline.commit)).then((v) => {
      fetched.compare = { total_commits: v.total_commits, commits: v.commits || [] };
    }).catch((e) => errors.push(`GitHub compare: ${e.message}`)),
    getJson(UPSTREAM_ENDPOINTS.npmTags).then((v) => { fetched.tags = v; })
      .catch((e) => errors.push(`npm dist-tags: ${e.message}`)),
  ]);

  const result = assess(baseline, fetched);
  // 基线漂移：声明的 version 与实际安装不一致（升级依赖后忘记改 vite.config.ts）
  const drift = baseline.version && installed && baseline.version !== installed;

  if (jsonOnly) {
    console.log(JSON.stringify({ baseline, installed, drift, result, errors }, null, 2));
  } else {
    const build = pickLatestBuild(fetched.tags);
    console.log("=== Excalidraw 官方底层自检 ===");
    console.log(` 本项目基线   : ${baseline.commit} (${baseline.date})  构建 ${baseline.version || "—"}`);
    console.log(` 实际安装版本 : ${installed || "—"}${drift ? "   ⚠ 与基线声明不一致（请同步 canvas-web/vite.config.ts）" : ""}`);
    console.log(` 上游 master  : ${result.masterSha || "—"} (${result.masterDate || "—"})  领先 ${result.behindBy} 个提交`);
    console.log(` 官方最新构建 : ${build.version || "—"}  (dist-tag ${build.tag})`);
    console.log(` 判定         : ${stateLabel(result.state)}`);
    if (result.command) console.log(` 升级命令     : ${result.command}`);
    if (errors.length) console.log(` 网络告警     : ${errors.join(" | ")}（离线或被限流，判定可能不完整）`);
    console.log(" 画布 WebUI 每 24h 自检一次，有新构建时右上角徽标会自动变黄。");
  }

  process.exitCode = result.state === "build-available" || drift ? 1 : 0;
}

function stateLabel(s) {
  return {
    "up-to-date": "已是官方最新 / up to date",
    "build-available": "有可升级的官方构建 / newer official build available",
    "source-only": "仅源码领先，尚未发布构建 / source-only commits ahead",
    unknown: "无法判定（离线/限流） / unknown (offline or rate-limited)",
  }[s] || s;
}

main().catch((e) => {
  console.error("check-upstream failed:", e.message);
  process.exitCode = 2;
});
