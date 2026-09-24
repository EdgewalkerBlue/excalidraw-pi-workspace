// 「保存到…」保存目标的纯逻辑单测（离线，不碰网络）。
// PKCE 部分使用 RFC 7636 Appendix B 的官方测试向量校验。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MANUAL_TARGETS,
  OAUTH_PROVIDERS,
  base64Url,
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
  providerStatus,
  sanitizeFilename,
  validateWebdav,
} from "./save-targets.mjs";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest();

test("三个 OAuth provider 规格齐全（授权/换token/控制台/上传）", () => {
  for (const id of ["dropbox", "gdrive", "onedrive"]) {
    const p = OAUTH_PROVIDERS[id];
    assert.ok(p, `${id} 规格缺失`);
    assert.match(p.authorizeUrl, /^https:\/\//);
    assert.match(p.tokenUrl, /^https:\/\//);
    assert.ok(p.scope.split(" ").length >= 1);
    assert.ok(p.consoleUrl.startsWith("https://"));
    assert.equal(typeof p.upload.method, "string");
    assert.ok(typeof p.upload.url === "string" || typeof p.upload.url === "function");
  }
  assert.ok(MANUAL_TARGETS.length >= 4, "常用网盘快捷入口至少 4 个");
  assert.ok(MANUAL_TARGETS.every((t) => /^https:\/\//.test(t.url)));
});

test("sanitizeFilename 去掉非法字符并保证 .excalidraw 后缀", () => {
  assert.equal(sanitizeFilename("架构图"), "架构图.excalidraw");
  assert.equal(sanitizeFilename("a/b:c*d?e"), "a_b_c_d_e.excalidraw");
  assert.equal(sanitizeFilename("x.EXCALIDRAW"), "x.EXCALIDRAW");
  assert.equal(sanitizeFilename(""), "Untitled.excalidraw");
  assert.equal(sanitizeFilename(null), "Untitled.excalidraw");
  assert.ok(sanitizeFilename("z".repeat(400)).length <= 180);
});

test("joinWebdavUrl 不产生双斜杠并编码文件名", () => {
  assert.equal(joinWebdavUrl("https://dav.jianguoyun.com/dav/", "a.excalidraw"), "https://dav.jianguoyun.com/dav/a.excalidraw");
  assert.equal(joinWebdavUrl("https://x.com/dav", "白板.excalidraw"), `https://x.com/dav/${encodeURIComponent("白板.excalidraw")}`);
});

test("validateWebdav 逐项报错", () => {
  assert.deepEqual(validateWebdav({ url: "https://dav.example.com/dav", username: "u", password: "p" }), []);
  assert.equal(validateWebdav({}).length, 3);
  assert.ok(validateWebdav({ url: "dav.example.com", username: "u", password: "p" })[0].includes("http"));
});

test("providerStatus 只暴露 clientId 与配置状态", () => {
  const st = providerStatus({ providers: { dropbox: { clientId: " abc123 " } } });
  assert.equal(st.dropbox.configured, true);
  assert.equal(st.dropbox.clientId, "abc123");
  assert.equal(st.gdrive.configured, false);
  assert.equal(st.onedrive.configured, false);
});

test("base64Url 输出无填充的 URL 安全串", () => {
  assert.equal(base64Url("hello"), "aGVsbG8");
  // 同时覆盖 +/ → -_ 的映射（[251,255,190] 的标准 base64 是 "+/++"）
  assert.equal(base64Url(Buffer.from([251, 255, 190])), "-_--");
  assert.ok(!/[+/=]/.test(base64Url(Buffer.from([1, 2, 3, 4, 5]))));
});

test("makeCodeVerifier 长度受限、字符集合法", () => {
  const v = makeCodeVerifier(64);
  assert.equal(v.length, 64);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
  assert.equal(makeCodeVerifier(1).length, 43, "下限 43");
  assert.equal(makeCodeVerifier(999).length, 128, "上限 128");
});

test("PKCE S256 与 RFC 7636 附录 B 测试向量一致", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(makeCodeChallenge(verifier, sha256), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("buildAuthorizeUrl 带上 PKCE 与各平台特有参数", () => {
  const url = buildAuthorizeUrl("dropbox", {
    clientId: "cid",
    redirectUri: "http://localhost:5011/oauth/callback",
    codeChallenge: "chal",
    state: "st",
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("token_access_type"), "offline", "Dropbox 需 offline 才有 refresh_token");

  const g = new URL(buildAuthorizeUrl("gdrive", { clientId: "c", redirectUri: "r", codeChallenge: "x", state: "s" }));
  assert.equal(g.searchParams.get("access_type"), "offline");
  assert.match(g.searchParams.get("scope"), /drive\.file/);

  const m = new URL(buildAuthorizeUrl("onedrive", { clientId: "c", redirectUri: "r", codeChallenge: "x", state: "s" }));
  assert.equal(m.searchParams.get("response_mode"), "query");
  assert.match(m.searchParams.get("scope"), /Files\.ReadWrite/);
});

test("buildAuthorizeUrl 缺 client_id 抛错", () => {
  assert.throws(() => buildAuthorizeUrl("dropbox", { clientId: "", redirectUri: "r", codeChallenge: "x", state: "s" }), /client_id/);
});

test("换 token 参数：带 code_verifier、不带 client_secret", () => {
  const body = buildTokenParams("gdrive", { code: "c", clientId: "cid", redirectUri: "r", codeVerifier: "v" });
  assert.match(body, /grant_type=authorization_code/);
  assert.match(body, /code_verifier=v/);
  assert.ok(!/client_secret/.test(body), "公共客户端不得出现 client_secret");
  assert.match(buildTokenParams("onedrive", { code: "c", clientId: "cid", redirectUri: "r", codeVerifier: "v" }), /client_info=1/);
});

test("needsRefresh / mergeRefreshed / buildRefreshParams", () => {
  const now = 1_000_000;
  assert.equal(needsRefresh(null, now), true);
  assert.equal(needsRefresh({ access_token: "t" }, now), false, "无过期时间视为有效");
  assert.equal(needsRefresh({ access_token: "t", expires_at: now + 30_000 }, now), true, "小于 skew 视为需刷新");
  assert.equal(needsRefresh({ access_token: "t", expires_at: now + 600_000 }, now), false);

  const merged = mergeRefreshed({ access_token: "old", refresh_token: "r1" }, { access_token: "new", expires_in: 3600 }, now);
  assert.equal(merged.access_token, "new");
  assert.equal(merged.refresh_token, "r1", "未返回新 refresh_token 时保留旧的");
  assert.equal(merged.expires_at, now + 3_600_000);

  assert.match(buildRefreshParams("dropbox", { clientId: "cid", refreshToken: "r" }), /grant_type=refresh_token/);
});

test("Google Drive multipart 体包含元数据、边界与原始字节", () => {
  const body = buildGdriveMultipart("架构图", Buffer.from('{"a":1}', "utf8"), "BOUNDARY");
  const s = body.toString("utf8");
  assert.match(s, /^--BOUNDARY\r\nContent-Type: application\/json/);
  assert.match(s, /"name":"架构图\.excalidraw"/);
  assert.match(s, /Content-Type: application\/octet-stream/);
  assert.match(s, /--BOUNDARY--\r\n$/);
  assert.ok(s.includes('{"a":1}'));
});

test("makeState 生成 URL 安全且不重复", () => {
  const a = makeState(16);
  const b = makeState(16);
  assert.match(a, /^[A-Za-z0-9\-_]+$/);
  assert.notEqual(a, b);
});
