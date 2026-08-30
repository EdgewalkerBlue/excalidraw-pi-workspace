@echo off
rem Excalidraw Canvas Server 启动脚本 (bind 0.0.0.0, port 5001)
set PORT=5001
set HOST=0.0.0.0
set EXCALIDRAW_EXPORT_DIR=D:\projects\excalidraw-workspace\canvas
node node_modules\mcp-excalidraw-server\dist\server.js
