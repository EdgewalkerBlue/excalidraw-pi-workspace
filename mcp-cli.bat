@echo off
rem Excalidraw MCP CLI 桥接脚本 (Pi Agent 通过此命令驱动画布)
set EXPRESS_SERVER_URL=http://127.0.0.1:5001
npx mcp-excalidraw-server %*
