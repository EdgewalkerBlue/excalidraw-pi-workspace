#!/usr/bin/env node
/**
 * PWA 补丁脚本（phase_7）
 *
 * 为 mcp-excalidraw-server 的 Web UI 注入 PWA 能力（Android 可安装）：
 *   1. 生成应用图标 PNG（192 / 512，Excalidraw 风格）
 *   2. 写入 manifest.json + sw.js 到 dist/frontend/
 *   3. 幂等地在 index.html 中插入 manifest / theme-color / SW 注册
 *
 * 注意：修改的是 node_modules 内打包产物，升级 mcp-excalidraw-server 后需重跑本脚本。
 * 用法：node tools/patch-pwa.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "mcp-excalidraw-server",
  "dist",
  "frontend"
);

// ---------- 最小 PNG 编码（无外部依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = rowStart + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Excalidraw 风格图标：深色底 + 紫色画布卡片 + 白色折线笔迹
function iconPixels(size) {
  const bg = [30, 30, 46]; // #1e1e2e
  const card = [105, 101, 219]; // #6965db
  const ink = [255, 255, 255];
  const s = size;
  const cardL = s * 0.2, cardT = s * 0.2, cardR = s * 0.8, cardB = s * 0.8, radius = s * 0.09;
  const inRoundRect = (x, y) => {
    if (x < cardL || x > cardR || y < cardT || y > cardB) return false;
    const cx = Math.max(cardL + radius, Math.min(x, cardR - radius));
    const cy = Math.max(cardT + radius, Math.min(y, cardB - radius));
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  };
  // 折线：三段线段（白）
  const segs = [
    [s * 0.33, s * 0.55, s * 0.45, s * 0.4],
    [s * 0.45, s * 0.4, s * 0.58, s * 0.62],
    [s * 0.58, s * 0.62, s * 0.7, s * 0.48],
  ];
  const onInk = (x, y) => {
    const w = Math.max(2, s * 0.022);
    for (const [x1, y1, x2, y2] of segs) {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx, py = y1 + t * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= w * w) return true;
    }
    return false;
  };
  return (x, y) => {
    if (inRoundRect(x, y)) {
      if (onInk(x, y)) return [...ink, 255];
      return [...card, 255];
    }
    return [...bg, 255];
  };
}

// ---------- 写入资源 ----------
const out = (name) => path.join(FRONTEND, name);

fs.writeFileSync(out("icon-192.png"), encodePng(192, iconPixels(192)));
fs.writeFileSync(out("icon-512.png"), encodePng(512, iconPixels(512)));

fs.writeFileSync(
  out("manifest.json"),
  JSON.stringify(
    {
      name: "Excalidraw 工作区",
      short_name: "Excalidraw",
      description: "Android 可访问的 Excalidraw 无限画布（Pi Agent 双向协作）",
      start_url: "./",
      scope: "./",
      display: "standalone",
      orientation: "any",
      background_color: "#1e1e2e",
      theme_color: "#1e1e2e",
      lang: "zh-CN",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2
  )
);

fs.writeFileSync(
  out("sw.js"),
  `// Excalidraw 工作区 Service Worker（PWA 离线缓存）
const CACHE = "excalidraw-workspace-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // 导航请求（页面/刷新）：网络优先，离线时回退缓存 → 避免旧页面缓存
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }))
  );
});
`
);

// ---------- 幂等补丁 index.html ----------
const indexHtml = path.join(FRONTEND, "index.html");
let html = fs.readFileSync(indexHtml, "utf8");
const PATCH_MARK = "<!-- pi-pwa-patch -->";
if (html.includes(PATCH_MARK)) {
  console.log("index.html 已打过补丁，跳过（幂等）");
} else {
  const headEnd = html.indexOf("</head>");
  if (headEnd < 0) {
    console.error("未找到 </head>，中止");
    process.exit(1);
  }
  const inject =
    `    <link rel="manifest" href="./manifest.json" />\n` +
    `    <meta name="theme-color" content="#1e1e2e" />\n` +
    `    <link rel="apple-touch-icon" href="./icon-192.png" />\n` +
    `    <meta name="apple-mobile-web-app-capable" content="yes" />\n` +
    `    <meta name="mobile-web-app-capable" content="yes" />\n` +
    `    ${PATCH_MARK}\n`;
  html = html.slice(0, headEnd) + inject + html.slice(headEnd);
  fs.writeFileSync(indexHtml, html, "utf8");
  console.log("index.html 已注入 PWA 资源");
}

// ---------- SW 注册脚本（插到 body 末尾） ----------
const SW_MARK = "pi-pwa-sw";
if (html.includes(SW_MARK)) {
  console.log("SW 注册已存在（幂等）");
} else {
  const bodyEnd = html.indexOf("</body>");
  if (bodyEnd < 0) {
    console.error("未找到 </body>，跳过 SW 注册");
  } else {
    const swScript =
      `\n    <script>/* ${SW_MARK} */\n` +
      `      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {\n` +
      `        window.addEventListener('load', () => {\n` +
      `          navigator.serviceWorker.register('./sw.js').catch(() => {});\n` +
      `        });\n` +
      `      }\n` +
      `    </script>\n`;
    html = html.slice(0, bodyEnd) + swScript + html.slice(bodyEnd);
    fs.writeFileSync(indexHtml, html, "utf8");
    console.log("SW 注册脚本已注入");
  }
}

console.log("PWA 补丁完成。资源: manifest.json / sw.js / icon-192.png / icon-512.png");

// ---------- Send to Agent 注入脚本 ----------
const SEND_SRC = path.resolve(__dirname, "..", "webui", "send-to-agent.js");
const SEND_DST = out("send-to-agent.js");
fs.copyFileSync(SEND_SRC, SEND_DST);
console.log("send-to-agent.js 已复制到 frontend");

// 幂等注入 <script> 标签（head 末尾，放在 PWA 补丁后）
html = fs.readFileSync(indexHtml, "utf8");
const SEND_MARK = "pi-sendtoagent-patch";
if (html.includes(SEND_MARK)) {
  console.log("send-to-agent 脚本注入已存在（幂等）");
} else {
  const headEnd2 = html.indexOf("</head>");
  if (headEnd2 < 0) {
    console.error("未找到 </head>，跳过 send-to-agent 注入");
  } else {
    const inject2 = `    <script defer src="./send-to-agent.js"></script> <!-- ${SEND_MARK} -->\n`;
    html = html.slice(0, headEnd2) + inject2 + html.slice(headEnd2);
    fs.writeFileSync(indexHtml, html, "utf8");
    console.log("send-to-agent 脚本已注入 index.html");
  }
}

console.log("全部补丁完成。");
