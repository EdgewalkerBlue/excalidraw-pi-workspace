@echo off
rem Excalidraw MCP CLI bridge (Pi Agent drives the canvas via this command)
set EXPRESS_SERVER_URL=http://127.0.0.1:5001
npx mcp-excalidraw-server %*
