import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// LAN 访问：host 0.0.0.0 + 固定端口 5001（避开被 IIS 占用的 80）
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5001,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5001,
    strictPort: true,
  },
});
