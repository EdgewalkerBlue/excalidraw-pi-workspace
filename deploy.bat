@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem  One-click deploy: install deps -> build canvas -> start services
rem    :5001  Canvas Server (mcp-excalidraw-server)
rem    :5010  Agent notify service
rem  Usage:  deploy.bat
rem  NOTE: keep this file ASCII-only with CRLF line endings.
rem        Non-ASCII chars or LF endings break cmd parsing.
rem ============================================================

cd /d "%~dp0"

echo [1/4] Installing dependencies - npm install ...
call npm install
if errorlevel 1 (
  echo [FAIL] npm install failed - see output above.
  exit /b 1
)

echo [2/4] Building canvas frontend - canvas-web into the Canvas Server static dir ...
call npm run build:canvas
if errorlevel 1 (
  echo [FAIL] npm run build:canvas failed - see output above.
  exit /b 1
)

echo [3/4] Checking upstream base layer (informational, never fails the deploy) ...
call npm run check:upstream

echo [4/4] Starting canvas server :5001 + agent-notify :5010 ...
call start-canvas.bat

endlocal
