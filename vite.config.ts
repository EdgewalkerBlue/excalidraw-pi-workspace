import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 端口分工（避免冲突）：
//   5001  Canvas Server（mcp-excalidraw-server，协作闭环锚点：MCP CLI / agent-notify / Pi 扩展均指向此端口）
//   5002  工作区 UI（本 Vite 应用，npm run dev / preview）
// 原配置与 Canvas Server 同为 5001，strictPort 下先启动一方占住端口，另一方直接启动失败。
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5002,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5002,
    strictPort: true,
  },
});
