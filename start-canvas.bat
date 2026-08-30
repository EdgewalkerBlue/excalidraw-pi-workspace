@echo off
rem Agent 通知服务（Web UI "Send to Agent" 按钮依赖，后台运行）
start "agent-notify" /B node tools\agent-notify.mjs
rem Excalidraw Canvas Server 启动脚本 (bind 0.0.0.0, port 5001)
set PORT=5001
set HOST=0.0.0.0
set EXCALIDRAW_EXPORT_DIR=D:\projects\excalidraw-workspace\architecture
node node_modules\mcp-excalidraw-server\dist\server.js
