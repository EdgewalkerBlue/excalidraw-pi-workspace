// Excalidraw 画布 PWA Service Worker（官方底层新前端）
// 策略：app shell 静态资源缓存优先；导航与 /api/ 一律走网络（API 绝不缓存——
// 旧版缓存 GET /api/elements 导致客户端永远读旧场景的教训）。
const CACHE = "excalidraw-canvas-shell";
const APP_SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket")) return; // 数据永远走网络
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // 带内容哈希的构建产物：缓存优先（hash 变即新 URL，天然失效）
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    })),
  );
});
