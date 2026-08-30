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
