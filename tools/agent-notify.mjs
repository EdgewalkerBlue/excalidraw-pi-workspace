#!/usr/bin/env node
/**
 * Agent 通知服务（配合 Web UI "Send to Agent / Approve / Reject"）
 *
 * 端点：
 *   POST /notify   : 写 .agent/pending.json（Send to Agent）
 *   POST /approve  : 写 .agent/approved.json（Approve）
 *   POST /reject   : 清除标记 + 恢复画布快照 + 写 rejected.json（Reject）
 *   POST /snapshot : 从 canvas server 拉取当前画布保存快照（Send 时调用）
 *   GET  /health   : pending / approved / rejected / snapshot 状态
 *
 * 环境变量：
 *   AGENT_NOTIFY_PORT      监听端口（默认 5010）
 *   AGENT_MARKER_DIR       标记目录（默认 <project>/.agent）
 *   EXCALIDRAW_CANVAS_URL  canvas server 地址（默认 http://127.0.0.1:5001）
 *
 * 用法：node tools/agent-notify.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.AGENT_NOTIFY_PORT || "5010", 10);
const MARKER_DIR =
  process.env.AGENT_MARKER_DIR || path.resolve(__dirname, "..", ".agent");
const CANVAS_URL = process.env.EXCALIDRAW_CANVAS_URL || "http://127.0.0.1:5001";
const MARKER_FILE = path.join(MARKER_DIR, "pending.json");
const APPROVED_FILE = path.join(MARKER_DIR, "approved.json");
const REJECTED_FILE = path.join(MARKER_DIR, "rejected.json");
const SNAPSHOT_FILE = path.join(MARKER_DIR, "snapshot.json");

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

/** 从 canvas server 拉取当前画布 */
async function fetchCanvasElements() {
  const resp = await fetch(`${CANVAS_URL}/api/elements`);
  if (!resp.ok) throw new Error(`canvas ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : data.elements || [];
}

// ---- Send to Task Set：画布 frame → 各项目 .pi/task_set.json ----
const PROJECTS_ROOT = process.env.CANVAS_PROJECTS_ROOT || "D:\\projects";
const DONE_PREFIX_RE = /^\s*(?:✓|✔|\[x\]|已完成)/i;
const PRIORITY_RE = /^\s*(P[0-3])\s*[:：、.，-]?\s*/i;

/** frame.name → 项目根路径：绝对路径直接用，否则 <PROJECTS_ROOT>/<name> */
function resolveProjectPath(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]:[\\/]/.test(raw) || /^[\\/]/.test(raw)) return path.normalize(raw);
  return path.join(PROJECTS_ROOT, raw);
}

/** 单行任务解析：✓/已完成 开头 → 跳过；P0-P3 前缀 → 优先级，默认 P2 */
function parseTaskLine(line) {
  let text = String(line || "").trim();
  if (!text) return null;
  if (DONE_PREFIX_RE.test(text)) return { done: true };
  let priority = "P2";
  const m = text.match(PRIORITY_RE);
  if (m) {
    priority = m[1].toUpperCase();
    text = text.slice(m[0].length).trim();
  }
  if (!text) return null;
  return { done: false, priority, title: text };
}

/** 生成任务 id：T-YYYYMMDD-NNN（按现有最大序号递增） */
function nextTaskId(existing) {
  const now = new Date();
  const ymd =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  let max = 0;
  for (const t of existing) {
    const m = String(t.id || "").match(/^T-\d{8}-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `T-${ymd}-${String(max + 1).padStart(3, "0")}`;
}

/** 合并写入项目 task_set.json：标题去重（幂等）、P 级稳定排序、状态"待执行" */
function mergeTaskSet(file, projectDirName, incoming) {
  let doc;
  if (fs.existsSync(file)) {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    doc = {
      任务集: {
        名称: projectDirName,
        创建时间: new Date().toISOString().slice(0, 10),
        说明: "来自画布 Send to Task Set",
        任务列表: [],
      },
    };
  }
  const ts = (doc["任务集"] = doc["任务集"] || {});
  ts.名称 = ts.名称 || projectDirName;
  ts.创建时间 = ts.创建时间 || new Date().toISOString().slice(0, 10);
  ts.任务列表 = Array.isArray(ts.任务列表) ? ts.任务列表 : [];
  // 约定：任务集只保留未完成项 —— 自动剔除状态为"已完成"的历史任务
  const removed = ts.任务列表.length;
  ts.任务列表 = ts.任务列表.filter((t) => String(t.状态 || "") !== "已完成");
  const removedCount = removed - ts.任务列表.length;

  const existTitles = new Set(
    ts.任务列表.map((t) => String(t.标题 || "").replace(/^P[0-3]\s*/, "").trim())
  );
  let added = 0;
  let skipped = 0;
  for (const it of incoming) {
    if (existTitles.has(it.title)) {
      skipped++;
      continue;
    }
    existTitles.add(it.title);
    ts.任务列表.push({
      id: nextTaskId(ts.任务列表),
      标题: `${it.priority} ${it.title}`,
      路径: "",
      状态: "待执行",
    });
    added++;
  }

  // P0 > P1 > P2 > P3 稳定排序（JS sort 为稳定排序，同级保持原序）
  const priOf = (t) => {
    const m = String(t.标题 || "").match(/^P([0-3])/);
    return m ? parseInt(m[1], 10) : 2;
  };
  ts.任务列表.sort((a, b) => priOf(a) - priOf(b));

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
  return { added, skipped, removed: removedCount };
}

/** 解析画布 frame 分组并写入各项目任务集 */
async function handleTaskSet() {
  const elements = await fetchCanvasElements();
  const frames = elements.filter((e) => e.type === "frame");
  const projects = [];
  for (const f of frames) {
    const name = String(f.name || "").trim() || f.id;
    const projectPath = resolveProjectPath(name);
    const r = { frame: name, path: projectPath, added: 0, skipped: 0, error: null };
    try {
      if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
        throw new Error(`项目目录不存在: ${projectPath}`);
      }
      // frame 内未绑定的 text 元素 → 逐行任务
      const texts = elements.filter(
        (e) => e.frameId === f.id && e.type === "text" && !e.containerId
      );
      const incoming = [];
      for (const t of texts) {
        for (const line of String(t.text || "").split(/\r?\n/)) {
          const task = parseTaskLine(line);
          if (task && !task.done) incoming.push(task);
        }
      }
      if (incoming.length === 0) {
        r.note = "no-tasks";
        projects.push(r);
        continue;
      }
      const file = path.join(projectPath, ".pi", "task_set.json");
      const { added, skipped, removed } = mergeTaskSet(file, path.basename(projectPath), incoming);
      r.added = added;
      r.skipped = skipped;
      r.removed = removed;
      r.file = file;
    } catch (e) {
      r.error = e.message;
    }
    projects.push(r);
  }
  return { projects };
}

/** 恢复画布快照（清空后批量重建） */
async function restoreCanvasSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return { restored: false, reason: "no-snapshot" };
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  const elements = snap.elements || [];

  const clearResp = await fetch(`${CANVAS_URL}/api/elements/clear`, {
    method: "DELETE",
  });
  if (!clearResp.ok) throw new Error(`clear ${clearResp.status}`);

  let count = 0;
  if (elements.length > 0) {
    const batchResp = await fetch(`${CANVAS_URL}/api/elements/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    });
    if (!batchResp.ok) {
      const err = await batchResp.text();
      throw new Error(`batch ${batchResp.status}: ${err.slice(0, 120)}`);
    }
    const body = await batchResp.json();
    count = body.count ?? elements.length;
  }
  return { restored: true, count };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        pending: fs.existsSync(MARKER_FILE),
        approved: fs.existsSync(APPROVED_FILE),
        rejected: fs.existsSync(REJECTED_FILE),
        snapshot: fs.existsSync(SNAPSHOT_FILE),
        marker: MARKER_FILE,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/notify") {
      let payload = {};
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        /* ignore */
      }
      fs.mkdirSync(MARKER_DIR, { recursive: true });
      fs.writeFileSync(
        MARKER_FILE,
        JSON.stringify(
          { received_at: new Date().toISOString(), status: "PENDING", ...payload },
          null,
          2
        ),
        "utf8"
      );
      json(res, 200, { ok: true, marker: MARKER_FILE });
      return;
    }

    // Send 时保存画布快照（供 Reject 恢复）
    if (req.method === "POST" && req.url === "/snapshot") {
      try {
        const elements = await fetchCanvasElements();
        fs.mkdirSync(MARKER_DIR, { recursive: true });
        fs.writeFileSync(
          SNAPSHOT_FILE,
          JSON.stringify(
            { saved_at: new Date().toISOString(), elements },
            null,
            2
          ),
          "utf8"
        );
        json(res, 200, { ok: true, snapshot_count: elements.length });
      } catch (e) {
        json(res, 500, { ok: false, error: e.message });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/approve") {
      let payload = {};
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        /* ignore */
      }
      fs.mkdirSync(MARKER_DIR, { recursive: true });
      const pending = fs.existsSync(MARKER_FILE)
        ? JSON.parse(fs.readFileSync(MARKER_FILE, "utf8"))
        : null;
      fs.writeFileSync(
        APPROVED_FILE,
        JSON.stringify(
          {
            approved_at: new Date().toISOString(),
            status: "APPROVED",
            pending: pending,
            ...payload,
          },
          null,
          2
        ),
        "utf8"
      );
      json(res, 200, { ok: true, approved: true, marker: APPROVED_FILE });
      return;
    }

    // Reject：清除标记 + 恢复画布快照 + 写 rejected.json
    if (req.method === "POST" && req.url === "/reject") {
      let payload = {};
      try {
        payload = JSON.parse((await readBody(req)) || "{}");
      } catch {
        /* ignore */
      }
      const hadPending = fs.existsSync(MARKER_FILE);
      const hadApproved = fs.existsSync(APPROVED_FILE);
      fs.mkdirSync(MARKER_DIR, { recursive: true });
      const pendingSnapshot = hadPending
        ? JSON.parse(fs.readFileSync(MARKER_FILE, "utf8"))
        : null;
      // 回退：清除待处理与已批准标记
      if (hadPending) fs.unlinkSync(MARKER_FILE);
      if (hadApproved) fs.unlinkSync(APPROVED_FILE);

      // 恢复画布快照（如有）
      let restore = { restored: false };
      try {
        restore = await restoreCanvasSnapshot();
      } catch (e) {
        restore = { restored: false, error: e.message };
      }

      fs.writeFileSync(
        REJECTED_FILE,
        JSON.stringify(
          {
            rejected_at: new Date().toISOString(),
            status: "REJECTED",
            reverted: { pending: hadPending, approved: hadApproved },
            canvas_restore: restore,
            pending_snapshot: pendingSnapshot,
            ...payload,
          },
          null,
          2
        ),
        "utf8"
      );
      json(res, 200, {
        ok: true,
        rejected: true,
        reverted: { pending: hadPending, approved: hadApproved },
        canvas_restore: restore,
      });
      return;
    }

    // Send to Task Set：画布 frame → 各项目 .pi/task_set.json
    if (req.method === "POST" && req.url === "/task-set") {
      try {
        const { projects } = await handleTaskSet();
        const ok = projects.every((p) => !p.error);
        json(res, 200, { ok, projects });
      } catch (e) {
        json(res, 500, { ok: false, error: e.message });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (e) {
    json(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`agent-notify: http://0.0.0.0:${PORT}`);
  console.log(`  canvas: ${CANVAS_URL}`);
  console.log(`  marker: ${MARKER_FILE}`);
});
