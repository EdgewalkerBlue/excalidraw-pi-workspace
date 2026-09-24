import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// :5001 画布前端（官方 @excalidraw/excalidraw master 底层 + 二开功能）
// 构建产物直接输出到 mcp-excalidraw-server 的静态目录（emptyOutDir 全清旧 bundle）。
// 开发模式走 5004 端口，/api 与 WS 代理到 5001。
// 注意：原 5003 与 auth-proxy（tools/auth-proxy.mjs 默认端口）冲突，2026-09-23 改为 5004。
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: here,
  // 官方底层基线（升级 @excalidraw/excalidraw 时同步更新；WebUI 更新提醒比对用）
  // 取自上游 excalidraw/excalidraw master 快照，与该版本的 npm 构建一一对应。
  define: {
    __CANVAS_BASELINE__: JSON.stringify({
      commit: "c0ad61c",
      date: "2026-09-16",
      version: "0.18.0-c0ad61c",
    }),
    // 二开仓库地址：注入到官方菜单「Excalidraw links」里的自建链接（见 src/extra-menu-links.tsx）。
    // 换仓库/迁移时只改这一处。
    __FORK_REPO_URL__: JSON.stringify(process.env.FORK_REPO_URL || "https://github.com/EdgewalkerBlue/excalidraw-pi-workspace"),
  },
  build: {
    outDir: path.resolve(here, "../node_modules/mcp-excalidraw-server/dist/frontend"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5004,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:5001", changeOrigin: true },
      "/socket": { target: "ws://127.0.0.1:5001", ws: true },
    },
  },
});
