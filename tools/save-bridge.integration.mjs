// save-bridge 的端到端联调（对着桩 WebDAV 跑，不接触任何真实网盘）。
//
// 三终端用法：
//   A) node tools/dev-stub-webdav.mjs
//   B) SAVE_BRIDGE_PORT=5112 SAVE_TARGETS_CONFIG=.save-targets.test.json node tools/save-bridge.mjs
//   C) node tools/save-bridge.integration.mjs
//
// 覆盖：健康检查 / 配置校验与回读（不泄露密码）/ WebDAV 测试与上传（校验服务端真收到字节）/
//       OAuth 授权 URL（PKCE、state、redirect_uri，且不含 client_secret）/ 回调防伪 / 未授权错误提示。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.BRIDGE_BASE || "http://127.0.0.1:5112";
const STUB = process.env.STUB_BASE || "http://127.0.0.1:5111";
const RECEIVED = process.env.STUB_RECEIVED || path.join(os.tmpdir(), "stub-webdav-received.json");

const results = [];
const check = (name, cond, extra = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};
const j = async (p, init) => {
  const r = await fetch(B + p, init);
  let body = null;
  try { body = await r.json(); } catch { /* 可能非 JSON */ }
  return { status: r.status, body };
};
const post = (p, obj) => j(p, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

let r = await j("/health");
if (!r.body?.ok) {
  console.error(`无法连接 save-bridge（${B}）。请先按文件头注释启动桩与中转服务。`);
  process.exit(2);
}
check("GET /health 正常", r.status === 200 && r.body.ok === true);

r = await post("/webdav/test", { url: "dav.example.com" });
check("非法 WebDAV 地址被拒并给出原因", r.status === 400 && /http/.test(r.body.error), r.body.error);

r = await post("/config", {
  webdav: { url: `${STUB}/dav`, username: "tester", password: "app-pass" },
  providers: { dropbox: { clientId: "fake-client-id" } },
});
check("POST /config 写入成功", r.status === 200 && r.body.config.webdav.url === `${STUB}/dav`);
check("配置回读不返回密码明文", r.status === 200 && r.body.config.webdav.hasPassword === true && !("password" in r.body.config.webdav));

r = await post("/webdav/test", {});
check("WebDAV 测试连接通过（桩返回 207）", r.status === 200 && r.body.ok === true, `status=${r.body.status}`);

const payload = JSON.stringify({ type: "excalidraw", elements: [{ id: "t1" }] });
r = await post("/webdav/upload", { filename: "架构图", content: payload });
check("WebDAV 上传成功", r.status === 200 && r.body.ok === true, r.body.savedTo || r.body.error);
check("上传路径已 URL 编码且补 .excalidraw", /%E6%9E%B6%E6%9E%84%E5%9B%BE\.excalidraw$/.test(r.body.savedTo || ""), r.body.savedTo);
check("桩服务器确实收到了正确字节", fs.existsSync(RECEIVED) && fs.readFileSync(RECEIVED, "utf8") === payload);

r = await j("/oauth/start?provider=onedrive");
check("未配置 client_id 的网盘被拒", r.status === 400 && /client_id/.test(r.body.error), r.body.error);

r = await j("/oauth/start?provider=dropbox&redirectBase=http://127.0.0.1:5112");
check("已配置网盘返回授权 URL", r.status === 200 && typeof r.body.url === "string", r.body.error);
if (r.body?.url) {
  const u = new URL(r.body.url);
  check("授权 URL 指向官方站点", u.host === "www.dropbox.com");
  check("授权 URL 含 PKCE/state/redirect_uri",
    !!u.searchParams.get("code_challenge") &&
    u.searchParams.get("code_challenge_method") === "S256" &&
    !!u.searchParams.get("state") &&
    u.searchParams.get("redirect_uri") === "http://127.0.0.1:5112/oauth/callback");
  check("授权 URL 不含 client_secret", !u.searchParams.get("client_secret"));
}

const cb = await fetch(`${B}/oauth/callback?code=x&state=bogus`);
const cbText = await cb.text();
check("伪造 state 的回调被安全拒绝", cb.status === 400 && /state/.test(cbText));

r = await j("/oauth/status");
check("GET /oauth/status 返回三家状态", r.status === 200 && Object.keys(r.body.connected).length === 3);

r = await post("/upload?provider=dropbox", { filename: "x", content: "{}" });
check("未授权上传给出可读错误", r.status === 500 && /授权/.test(r.body.error), r.body.error);

console.log(results.join("\n"));
console.log(`\n${results.filter((x) => x.startsWith("PASS")).length}/${results.length} 通过`);
