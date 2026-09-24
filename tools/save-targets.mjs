// 「保存到…」各保存目标的纯逻辑与规格：单一事实来源。
//
// 为什么是 .mjs：tool 侧（save-bridge.mjs）与单测（save-targets.test.mjs）共用，
// 且不依赖任何浏览器/网络对象。类型声明见 save-targets.d.mts。
//
// 设计要点：
//   · 三种网盘都用 **OAuth 2.0 + PKCE 公共客户端**（无需 client_secret，用户自己注册应用拿 client_id）；
//   · 授权码换 token、以及上传请求，**全部由本机中转服务发出**（save-bridge.mjs）——
//     浏览器直连会踩 CORS，且本机服务同时解决了 localhost 回调的落点问题；
//   · WebDAV 不需要任何注册，凭据只存本机配置文件（.save-targets.json，已 gitignore）。

/** 支持 OAuth 直连的网盘规格（端点与 scope 均取自各家官方文档） */
export const OAUTH_PROVIDERS = {
  dropbox: {
    label: { zh: "Dropbox", en: "Dropbox" },
    kind: "dropbox",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scope: "files.content.write files.content.read",
    extraAuthParams: { token_access_type: "offline" },
    consoleUrl: "https://www.dropbox.com/developers/apps",
    consoleHint: {
      zh: "创建 Scoped App，勾选 files.content.write / files.content.read，Redirect URI 填本机回调地址",
      en: "Create a scoped app, enable files.content.write / files.content.read, add the local callback as redirect URI",
    },
    // 上传：POST https://content.dropboxapi.com/2/files/upload，参数走 Dropbox-API-Arg 头
    upload: {
      url: "https://content.dropboxapi.com/2/files/upload",
      method: "POST",
      headers: (filename) => ({
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path: `/${filename}`, mode: "overwrite", mute: false, autorename: false }),
      }),
      resultPath: (j) => j?.path_display || "",
    },
  },
  gdrive: {
    label: { zh: "Google 云端硬盘", en: "Google Drive" },
    kind: "gdrive",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/drive.file",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    consoleHint: {
      zh: "创建 OAuth 客户端（类型：Web 应用），把本机回调地址加入「已获授权的重定向 URI」，并启用 Drive API",
      en: "Create an OAuth client (type: Web application), add the local callback to Authorized redirect URIs, and enable the Drive API",
    },
    // 上传：POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart（multipart/related）
    upload: {
      url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      method: "POST",
      headers: () => ({}),
      multipart: true,
      resultPath: (j) => j?.name || "",
    },
  },
  onedrive: {
    label: { zh: "OneDrive", en: "OneDrive" },
    kind: "onedrive",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access Files.ReadWrite.AppFolder",
    extraAuthParams: { response_mode: "query" },
    consoleUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    consoleHint: {
      zh: "注册应用并把平台设为「Web」，重定向 URI 填本机回调地址；公共客户端无需 client_secret",
      en: "Register an app with platform Web and add the local callback URI; public clients need no client_secret",
    },
    // 上传：PUT https://graph.microsoft.com/v1.0/me/drive/special/approot:/<name>:/content
    upload: {
      url: (filename) => `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(filename)}:/content`,
      method: "PUT",
      headers: () => ({ "Content-Type": "application/octet-stream" }),
      resultPath: (j) => j?.name || "",
    },
  },
};

/** 网盘「导出后手动上传」快捷入口（无 OAuth 应用时的替代路径，仅打开其上传页） */
export const MANUAL_TARGETS = [
  { id: "baidu", label: { zh: "百度网盘", en: "Baidu Netdisk" }, url: "https://pan.baidu.com/disk/main" },
  { id: "aliyun", label: { zh: "阿里云盘", en: "Aliyun Drive" }, url: "https://www.alipan.com/drive" },
  { id: "jianguoyun", label: { zh: "坚果云（支持 WebDAV）", en: "Jianguoyun (WebDAV)" }, url: "https://www.jianguoyun.com/d/home" },
  { id: "quark", label: { zh: "夸克网盘", en: "Quark Drive" }, url: "https://pan.quark.cn/list" },
  { id: "weiyun", label: { zh: "腾讯微云", en: "Tencent Weiyun" }, url: "https://www.weiyun.com/disk" },
];

/** 规范化网盘文件名：去掉路径分隔与控制字符，保证以 .excalidraw 结尾 */
export function sanitizeFilename(name) {
  let base = String(name ?? "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  if (!base) base = "Untitled";
  if (!/\.excalidraw$/i.test(base)) base += ".excalidraw";
  return base.slice(0, 180);
}

/** 拼接 WebDAV 目录与文件名，保留协议与主机，避免出现双斜杠 */
export function joinWebdavUrl(baseUrl, filename) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(sanitizeFilename(filename))}`;
}

/** WebDAV 配置校验（返回错误信息数组，空数组=通过） */
export function validateWebdav(cfg) {
  const errs = [];
  const url = String(cfg?.url ?? "").trim();
  if (!url) errs.push("缺少 WebDAV 地址");
  else if (!/^https?:\/\//i.test(url)) errs.push("WebDAV 地址必须以 http:// 或 https:// 开头");
  if (!String(cfg?.username ?? "").trim()) errs.push("缺少用户名");
  if (!String(cfg?.password ?? "")) errs.push("缺少密码/应用密码");
  return errs;
}

/** 各 provider 是否已具备 client_id */
export function providerStatus(config) {
  const out = {};
  for (const [id, spec] of Object.entries(OAUTH_PROVIDERS)) {
    const clientId = String(config?.providers?.[id]?.clientId ?? "").trim();
    out[id] = { label: spec.label, clientId, configured: !!clientId };
  }
  return out;
}

// ── PKCE（RFC 7636）────────────────────────────────────────────────────
const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** 生成 code_verifier（43–128 字符，未保留字符集） */
export function makeCodeVerifier(len = 64, rnd = Math.random) {
  const n = Math.min(128, Math.max(43, Math.floor(len)));
  let s = "";
  for (let i = 0; i < n; i++) s += UNRESERVED[Math.floor(rnd() * UNRESERVED.length)];
  return s;
}

/** base64url（无填充）——PKCE 的 S256 challenge 与 state 都用它 */
export function base64Url(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** code_challenge = base64url(sha256(verifier)) */
export function makeCodeChallenge(verifier, sha256) {
  return base64Url(sha256(verifier));
}

/** 生成 state（防 CSRF，回调时校验） */
export function makeState(bytes = 16, rnd = Math.random) {
  const arr = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(rnd() * 256);
  return base64Url(arr);
}

/** 构造授权 URL（各平台参数差异用规格里的 extraAuthParams 表达） */
export function buildAuthorizeUrl(provider, { clientId, redirectUri, codeChallenge, state }) {
  const spec = OAUTH_PROVIDERS[provider];
  if (!spec) throw new Error(`未知 provider: ${provider}`);
  if (!clientId) throw new Error("缺少 client_id");
  const u = new URL(spec.authorizeUrl);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  if (spec.scope) u.searchParams.set("scope", spec.scope);
  for (const [k, v] of Object.entries(spec.extraAuthParams || {})) u.searchParams.set(k, v);
  return u.toString();
}

/** 构造换 token 的请求体（PKCE 公共客户端：带 code_verifier，不带 client_secret） */
export function buildTokenParams(provider, { code, clientId, redirectUri, codeVerifier }) {
  const spec = OAUTH_PROVIDERS[provider];
  if (!spec) throw new Error(`未知 provider: ${provider}`);
  const p = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  // Microsoft 的公共客户端要显式声明
  if (provider === "onedrive") p.set("client_info", "1");
  return p.toString();
}

/** 检查 token（含过期判断），过期且有 refresh_token 时给出需要刷新 */
export function needsRefresh(token, nowMs = Date.now(), skewMs = 60_000) {
  if (!token?.access_token) return true;
  if (!token.expires_at) return false;
  return Number(token.expires_at) - skewMs <= nowMs;
}

/** 合并刷新后的 token（保留 refresh_token，重算过期时间） */
export function mergeRefreshed(token, resp, nowMs = Date.now()) {
  return {
    ...token,
    access_token: resp.access_token,
    refresh_token: resp.refresh_token || token.refresh_token,
    expires_at: resp.expires_in ? nowMs + Number(resp.expires_in) * 1000 : token.expires_at,
  };
}

/** 构造刷新 token 的请求体 */
export function buildRefreshParams(provider, { clientId, refreshToken }) {
  const spec = OAUTH_PROVIDERS[provider];
  if (!spec) throw new Error(`未知 provider: ${provider}`);
  const p = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (provider === "onedrive") p.set("client_info", "1");
  return p.toString();
}

/** Google Drive 的 multipart/related 上传体（元数据 + 文件内容） */
export function buildGdriveMultipart(filename, bodyBuf, boundary) {
  const meta = JSON.stringify({ name: sanitizeFilename(filename) });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return Buffer.concat([head, bodyBuf, tail]);
}
