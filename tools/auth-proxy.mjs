#!/usr/bin/env node
/**
 * 可选认证代理（phase_7 / security）
 *
 * 当画布需要暴露到公网或不可信网络时，在 canvas server 前加 Basic Auth。
 * 启用后请把 canvas server 绑回 127.0.0.1（见 start-auth.bat 公网模式），
 * 由本代理对外提供认证后的访问（含 WebSocket 实时同步转发）。
 *
 * 环境变量（或 .auth.env 文件，见 start-auth.bat）：
 *   EXCALIDRAW_PROXY_PORT   代理监听端口（默认 5003；注意 5002 已被工作区 UI 占用）
 *   EXCALIDRAW_PROXY_TARGET 目标 canvas server（默认 http://127.0.0.1:5001）
 *   EXCALIDRAW_AUTH_USER    用户名（默认 admin）
 *   EXCALIDRAW_AUTH_PASS    密码（默认 excalidraw123 —— 生产必须通过 .auth.env 设置强密码）
 *   EXCALIDRAW_ALLOW_DEFAULT_PASS  1 时才允许默认弱密码启动（仅本地试用）
 *
 * 用法：node tools/auth-proxy.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 启动时若存在项目根 .auth.env 则自动加载（start-auth.bat 会生成）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, "..", ".auth.env");
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = parseInt(process.env.EXCALIDRAW_PROXY_PORT || "5003", 10);
const TARGET = process.env.EXCALIDRAW_PROXY_TARGET || "http://127.0.0.1:5001";
const USER = process.env.EXCALIDRAW_AUTH_USER || "admin";
const PASS = process.env.EXCALIDRAW_AUTH_PASS || "excalidraw123";
const REALM = "excalidraw-workspace";

if (PASS === "excalidraw123" && process.env.EXCALIDRAW_ALLOW_DEFAULT_PASS !== "1") {
  console.error(
    "[auth-proxy] 使用默认弱密码禁止启动！请通过 .auth.env 或环境变量设置强密码，" +
      "或本地试用时加 EXCALIDRAW_ALLOW_DEFAULT_PASS=1"
  );
  process.exit(1);
}
if (!USER || !PASS || PASS.length < 8) {
  console.error("[auth-proxy] 密码至少 8 位，且用户名/密码不能为空");
  process.exit(1);
}

const target = new URL(TARGET);

function checkAuth(req) {
  const h = req.headers.authorization || "";
  const b64 = h.replace(/^Basic\s+/i, "");
  let decoded = "";
  try {
    decoded = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return false;
  }
  const [u, p] = decoded.split(":");
  return u === USER && p === PASS;
}

function deny(res) {
  res.writeHead(401, {
    "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
  });
  res.end("Authentication required");
}

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) return deny(res);
  const proxyReq = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: req.headers.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (e) => {
    res.writeHead(502);
    res.end(`Bad Gateway: ${e.message}`);
  });
  req.pipe(proxyReq);
});

// WebSocket 转发（Excalidraw 实时同步）
server.on("upgrade", (req, socket, head) => {
  if (!checkAuth(req)) {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        `WWW-Authenticate: Basic realm="${REALM}"\r\n\r\n`
    );
    socket.destroy();
    return;
  }
  const proxyReq = http.request({
    host: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join("") +
        "\r\n"
    );
    proxyHead && proxySocket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`认证代理已启动: http://0.0.0.0:${PORT} -> ${TARGET}`);
  console.log(`凭据: ${USER} / ${PASS.slice(0, 2)}***（来自 .auth.env 或环境变量）`);
  console.log("对外访问请加 HTTPS 终止（nginx/Caddy 反代 TLS），不建议直连公网 HTTP");
});
