#!/usr/bin/env node
/**
 * 保存目标中转服务（save-bridge，默认 :5011）
 *
 * 存在的理由：
 *   1. 浏览器直连 WebDAV 与各网盘的 token 端点会撞 CORS，且授权码换 token 不应放在前端；
 *   2. OAuth 回调需要一个固定落点 —— 本机服务天然是 http://localhost:5011/oauth/callback。
 *
 * 端点：
 *   GET  /health                     服务与各目标配置状态
 *   GET  /config                     读配置（**不返回密码**，providers 只回 clientId 与是否配置）
 *   POST /config                     写配置（WebDAV 凭据 / 各网盘 client_id）
 *   POST /webdav/test                测试 WebDAV 连接（PROPFIND Depth:0 → 207/200 即通过）
 *   POST /webdav/upload              { filename, content } → PUT 到 WebDAV
 *   GET  /oauth/start?provider=&redirectBase=   → 302 到平台授权页（PKCE + state）
 *   GET  /oauth/callback?code=&state=           → 服务端换 token 并落盘，返回自关闭页面
 *   GET  /oauth/status               各网盘是否已连接
 *   POST /oauth/disconnect           { provider } 删除该网盘 token
 *   POST /upload                     { provider, filename, content } → 上传到该网盘
 *
 * 安全默认：只监听 127.0.0.1（避免把"能上传到你云盘"的接口暴露到局域网）。
 * 需要手机等其它设备使用时，显式设置 SAVE_BRIDGE_HOST=0.0.0.0 并自行承担风险。
 *
 * 配置文件：<project>/.save-targets.json（含凭据与 token，**已 gitignore**）
 * 用法：node tools/save-bridge.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  MANUAL_TARGETS,
  OAUTH_PROVIDERS,
  buildAuthorizeUrl,
  buildGdriveMultipart,
  buildRefreshParams,
  buildTokenParams,
  joinWebdavUrl,
  makeCodeChallenge,
  makeCodeVerifier,
  makeState,
  mergeRefreshed,
  needsRefresh,
  sanitizeFilename,
  validateWebdav,
} from "./save-targets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.SAVE_BRIDGE_PORT || "5011", 10);
const HOST = process.env.SAVE_BRIDGE_HOST || "127.0.0.1";
const CONFIG_FILE = process.env.SAVE_TARGETS_CONFIG || path.join(ROOT, ".save-targets.json");

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest();

// ── 配置读写 ────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return { webdav: j.webdav || {}, providers: j.providers || {}, tokens: j.tokens || {} };
  } catch {
    return { webdav: {}, providers: {}, tokens: {} };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
}
function publicConfig(cfg) {
  return {
    webdav: {
      url: cfg.webdav.url || "",
      username: cfg.webdav.username || "",
      hasPassword: !!cfg.webdav.password,
      directory: cfg.webdav.directory || "",
    },
    providers: Object.fromEntries(
      Object.keys(OAUTH_PROVIDERS).map((id) => [id, { clientId: cfg.providers[id]?.clientId || "" }]),
    ),
    connected: Object.fromEntries(
      Object.keys(OAUTH_PROVIDERS).map((id) => [id, !!cfg.tokens[id]?.access_token || !!cfg.tokens[id]?.refresh_token]),
    ),
    manualTargets: MANUAL_TARGETS,
  };
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────
function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function send(res, status, body, type = "application/json; charset=utf-8") {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  res.writeHead(status, { "Content-Type": type, "Content-Length": buf.length, ...CORS });
  res.end(buf);
}
const html = (title, msg, ok = true) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:14px system-ui;padding:28px;background:#1e1e1e;color:#ddd">` +
  `<h2 style="color:${ok ? "#69db7c" : "#ff8787"}">${title}</h2><p>${msg}</p>` +
  `<p style="color:#888">此窗口可关闭。</p>` +
  `<script>setTimeout(function(){try{window.opener&&window.opener.postMessage({type:"save-bridge-oauth",ok:${ok}},"*");}catch(e){}setTimeout(function(){window.close()},600)},300)</script></body>`;

// ── WebDAV ─────────────────────────────────────────────────────────────
async function webdavRequest(cfg, { method, url, body, headers = {} }) {
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`, "utf8").toString("base64");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: `Basic ${auth}`, ...headers },
      body,
      signal: ac.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function webdavUpload(cfg, filename, contentBuf) {
  const url = joinWebdavUrl(cfg.url, filename);
  const r = await webdavRequest(cfg, {
    method: "PUT",
    url,
    body: contentBuf,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
  if (!(r.status >= 200 && r.status < 300)) {
    throw new Error(`WebDAV 返回 ${r.status}${r.status === 401 ? "（用户名或应用密码不对）" : ""}`);
  }
  return { savedTo: url, status: r.status };
}

// ── OAuth ──────────────────────────────────────────────────────────────
const pending = new Map(); // state -> { provider, verifier, redirectUri, ts }

async function exchangeToken(provider, params) {
  const spec = OAUTH_PROVIDERS[provider];
  const r = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`token 响应非 JSON（${r.status}）：${text.slice(0, 160)}`);
  }
  if (!r.ok || j.error) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
  return j;
}

async function ensureToken(cfg, provider) {
  const spec = OAUTH_PROVIDERS[provider];
  const clientId = (cfg.providers[provider]?.clientId || "").trim();
  if (!clientId) throw new Error(`${spec.label.zh} 未配置 client_id`);
  let token = cfg.tokens[provider];
  if (!token) throw new Error(`${spec.label.zh} 尚未授权，请先点"授权"`);
  if (needsRefresh(token)) {
    if (!token.refresh_token) throw new Error(`${spec.label.zh} 的凭据已过期，请重新授权`);
    const resp = await exchangeToken(provider, buildRefreshParams(provider, { clientId, refreshToken: token.refresh_token }));
    token = mergeRefreshed(token, resp);
    cfg.tokens[provider] = token;
    saveConfig(cfg);
  }
  return token;
}

async function uploadToProvider(cfg, provider, filename, contentBuf) {
  const spec = OAUTH_PROVIDERS[provider];
  const token = await ensureToken(cfg, provider);
  const name = sanitizeFilename(filename);
  const url = typeof spec.upload.url === "function" ? spec.upload.url(name) : spec.upload.url;
  let body = contentBuf;
  const headers = { Authorization: `Bearer ${token.access_token}`, ...spec.upload.headers(name) };
  if (spec.upload.multipart) {
    const boundary = `----save-bridge-${crypto.randomBytes(8).toString("hex")}`;
    body = buildGdriveMultipart(name, contentBuf, boundary);
    headers["Content-Type"] = `multipart/related; boundary=${boundary}`;
  }
  const r = await fetch(url, { method: spec.upload.method, headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${spec.label.zh} 上传失败：HTTP ${r.status} ${text.slice(0, 180)}`);
  let j = {};
  try {
    j = JSON.parse(text);
  } catch { /* 有些接口返回空体 */ }
  return { savedTo: spec.upload.resultPath(j) || name, status: r.status };
}

// ── 路由 ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const route = `${req.method} ${u.pathname}`;
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");

    if (route === "GET /health") {
      const cfg = loadConfig();
      return send(res, 200, {
        ok: true,
        service: "save-bridge",
        port: PORT,
        webdavConfigured: validateWebdav(cfg.webdav).length === 0,
        providers: Object.fromEntries(
          Object.entries(OAUTH_PROVIDERS).map(([id, s]) => [
            id,
            { label: s.label, configured: !!(cfg.providers[id]?.clientId || "").trim(), connected: !!cfg.tokens[id] },
          ]),
        ),
      });
    }

    if (route === "GET /config") return send(res, 200, publicConfig(loadConfig()));

    if (route === "POST /config") {
      const patch = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const cfg = loadConfig();
      if (patch.webdav) {
        cfg.webdav = {
          url: patch.webdav.url ?? cfg.webdav.url ?? "",
          username: patch.webdav.username ?? cfg.webdav.username ?? "",
          // 密码留空 = 不改动已保存的密码
          password: patch.webdav.password ? patch.webdav.password : cfg.webdav.password || "",
          directory: patch.webdav.directory ?? cfg.webdav.directory ?? "",
        };
      }
      if (patch.providers) {
        cfg.providers = cfg.providers || {};
        for (const [id, v] of Object.entries(patch.providers)) {
          if (!OAUTH_PROVIDERS[id]) continue;
          cfg.providers[id] = { clientId: String(v?.clientId ?? "").trim() };
        }
      }
      saveConfig(cfg);
      return send(res, 200, { ok: true, config: publicConfig(cfg) });
    }

    if (route === "POST /webdav/test") {
      const cfg = loadConfig();
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const cand = { ...cfg.webdav, ...body, password: body.password || cfg.webdav.password };
      const errs = validateWebdav(cand);
      if (errs.length) return send(res, 400, { ok: false, error: errs.join("；") });
      const r = await webdavRequest(cand, {
        method: "PROPFIND",
        url: String(cand.url).replace(/\/+$/, "") + "/",
        headers: { Depth: "0", "Content-Type": "application/xml" },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      });
      const ok = r.status === 207 || r.status === 200 || r.status === 204;
      return send(res, ok ? 200 : 502, {
        ok,
        status: r.status,
        error: ok ? undefined : `WebDAV 返回 ${r.status}${r.status === 401 ? "（用户名或应用密码不对）" : r.status === 404 ? "（路径不存在）" : ""}`,
      });
    }

    if (route === "POST /webdav/upload") {
      const cfg = loadConfig();
      const errs = validateWebdav(cfg.webdav);
      if (errs.length) return send(res, 400, { ok: false, error: `WebDAV 未配置完整：${errs.join("；")}` });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!body.content) return send(res, 400, { ok: false, error: "缺少 content" });
      const out = await webdavUpload(cfg.webdav, body.filename || "Untitled", Buffer.from(body.content, "utf8"));
      return send(res, 200, { ok: true, ...out });
    }

    if (route === "GET /oauth/start") {
      const provider = u.searchParams.get("provider");
      const spec = OAUTH_PROVIDERS[provider];
      if (!spec) return send(res, 400, { ok: false, error: `未知 provider: ${provider}` });
      const cfg = loadConfig();
      const clientId = (cfg.providers[provider]?.clientId || "").trim();
      if (!clientId) return send(res, 400, { ok: false, error: `${spec.label.zh} 未配置 client_id` });
      const redirectBase = (u.searchParams.get("redirectBase") || `http://127.0.0.1:${PORT}`).replace(/\/+$/, "");
      const redirectUri = `${redirectBase}/oauth/callback`;
      const verifier = makeCodeVerifier(64);
      const state = makeState(16);
      pending.set(state, { provider, verifier, redirectUri, ts: Date.now() });
      for (const [k, v] of pending) if (Date.now() - v.ts > 10 * 60 * 1000) pending.delete(k);
      const url = buildAuthorizeUrl(provider, {
        clientId,
        redirectUri,
        codeChallenge: makeCodeChallenge(verifier, sha256),
        state,
      });
      return send(res, 200, { ok: true, url, redirectUri });
    }

    if (route === "GET /oauth/callback") {
      const state = u.searchParams.get("state") || "";
      const code = u.searchParams.get("code") || "";
      const err = u.searchParams.get("error");
      const p = pending.get(state);
      if (err) return send(res, 200, html("授权被拒绝", String(err), false), "text/html; charset=utf-8");
      if (!p) return send(res, 400, html("授权失败", "state 无效或已过期，请回到画布重新发起授权。", false), "text/html; charset=utf-8");
      pending.delete(state);
      const cfg = loadConfig();
      try {
        const resp = await exchangeToken(
          p.provider,
          buildTokenParams(p.provider, {
            code,
            clientId: (cfg.providers[p.provider]?.clientId || "").trim(),
            redirectUri: p.redirectUri,
            codeVerifier: p.verifier,
          }),
        );
        cfg.tokens[p.provider] = {
          access_token: resp.access_token,
          refresh_token: resp.refresh_token,
          expires_at: resp.expires_in ? Date.now() + Number(resp.expires_in) * 1000 : 0,
          obtained_at: Date.now(),
        };
        saveConfig(cfg);
        return send(res, 200, html("授权成功", `${OAUTH_PROVIDERS[p.provider].label.zh} 已连接，可以回到画布保存了。`), "text/html; charset=utf-8");
      } catch (e) {
        return send(res, 200, html("授权失败", String(e.message), false), "text/html; charset=utf-8");
      }
    }

    if (route === "GET /oauth/status") {
      const cfg = loadConfig();
      return send(res, 200, {
        ok: true,
        connected: Object.fromEntries(Object.keys(OAUTH_PROVIDERS).map((id) => [id, !!cfg.tokens[id]])),
      });
    }

    if (route === "POST /oauth/disconnect") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const cfg = loadConfig();
      if (cfg.tokens[body.provider]) {
        delete cfg.tokens[body.provider];
        saveConfig(cfg);
      }
      return send(res, 200, { ok: true });
    }

    if (route === "POST /upload") {
      const provider = u.searchParams.get("provider");
      if (!OAUTH_PROVIDERS[provider]) return send(res, 400, { ok: false, error: `未知 provider: ${provider}` });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!body.content) return send(res, 400, { ok: false, error: "缺少 content" });
      const cfg = loadConfig();
      const out = await uploadToProvider(cfg, provider, body.filename || "Untitled", Buffer.from(body.content, "utf8"));
      return send(res, 200, { ok: true, provider, ...out });
    }

    return send(res, 404, { ok: false, error: "未知端点" });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`save-bridge: http://${HOST}:${PORT}`);
  if (HOST !== "127.0.0.1") {
    console.warn("[warn] 已监听非本机地址：局域网内可访问「上传到你云盘」的接口，请自行确认风险");
  }
  console.log(`config: ${CONFIG_FILE}`);
});
