#!/usr/bin/env node
/**
 * Agent 通知服务（配合 Web UI "Send to Agent" 按钮）
 *
 * 接收前端 POST /notify，写入 .agent/pending.json 标记文件。
 * Pi Agent 检测到标记后走 Review Gate 处理画布，处理完删除标记。
 *
 * 环境变量：
 *   AGENT_NOTIFY_PORT 监听端口（默认 5010）
 *   AGENT_MARKER_DIR  标记目录（默认 <project>/.agent）
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
const MARKER_FILE = path.join(MARKER_DIR, "pending.json");
const APPROVED_FILE = path.join(MARKER_DIR, "approved.json");

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        pending: fs.existsSync(MARKER_FILE),
        approved: fs.existsSync(APPROVED_FILE),
        marker: MARKER_FILE,
      })
    );
    return;
  }

  if (req.method === "POST" && req.url === "/notify") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, marker: MARKER_FILE }));
    });
    return;
  }

  // Web UI Approve 按钮：写入 .agent/approved.json（status: APPROVED）
  if (req.method === "POST" && req.url === "/approve") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, approved: true, marker: APPROVED_FILE }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`agent-notify: http://0.0.0.0:${PORT} (marker: ${MARKER_FILE})`);
});
