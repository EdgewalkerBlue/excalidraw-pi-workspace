@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem  Excalidraw workspace one-click startup (silent background)
rem    :5001  Canvas Server (mcp-excalidraw-server)
rem    :5010  Agent notify service (Send to Agent / Approve / Reject)
rem    Logs:  logs\canvas.log / logs\notify.log
rem    Stop:  stop-canvas.bat
rem  NOTE: keep this file ASCII-only with CRLF line endings.
rem        Non-ASCII chars or LF endings break cmd parsing.
rem        Avoid unescaped ) inside echo lines in ( ) blocks.
rem ============================================================

cd /d "%~dp0"
if not exist logs mkdir logs

rem ---- 0) Port pre-check :5001 ----
netstat -ano | findstr /r /c:":5001 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Canvas already running on :5001 - http://localhost:5001
  start http://localhost:5001
  timeout /t 2 /nobreak >nul
  exit /b 0
)

rem ---- 1) Canvas server patch (idempotent, survives node_modules updates) ----
rem     NOTE: patch-i18n / patch-pwa were retired 2026-09-23 (legacy/):
rem     i18n is handled by the official `lang` prop, PWA assets ship in canvas-web/public.
node tools\patch-server.mjs >nul 2>&1

rem ---- 2) Agent notify service (hidden background, :5010) ----
netstat -ano | findstr /r /c:":5010 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Notify service already running on :5010, skip.
) else (
  powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'tools\agent-notify.mjs' -WorkingDirectory '%cd%' -WindowStyle Hidden" >nul 2>&1
  echo [START] Agent notify service :5010 - background
)

rem ---- 2.5) Save bridge (hidden background, 127.0.0.1:5011) ----
rem      Handles WebDAV uploads and cloud-drive OAuth (tokens stay local, see .save-targets.json).
netstat -ano | findstr /r /c:":5011 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Save bridge already running on :5011, skip.
) else (
  powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'tools\save-bridge.mjs' -WorkingDirectory '%cd%' -WindowStyle Hidden" >nul 2>&1
  echo [START] Save bridge :5011 - background
)

rem ---- 3) Canvas server (hidden background, 0.0.0.0:5001) ----
set PORT=5001
set HOST=0.0.0.0
set EXCALIDRAW_EXPORT_DIR=%cd%\architecture
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'node_modules\mcp-excalidraw-server\dist\server.js' -WorkingDirectory '%cd%' -WindowStyle Hidden -RedirectStandardOutput 'logs\canvas.log' -RedirectStandardError 'logs\canvas-err.log'" >nul 2>&1
echo [START] Excalidraw Canvas Server :5001 - background...

rem ---- 4) Probe up to 30s, open browser on success ----
set OK=0
for /l %%i in (1,1,30) do (
  if "!OK!"=="0" (
    timeout /t 1 /nobreak >nul
    curl -s -m 3 -o nul http://127.0.0.1:5001/ && set OK=1
  )
)
if "!OK!"=="1" (
  echo [OK] Canvas running: http://localhost:5001 - opening browser...
  echo        Stop: stop-canvas.bat ^| Logs: logs\
  start http://localhost:5001
) else (
  echo [FAIL] Canvas not responding, see logs\canvas-err.log
)
timeout /t 3 /nobreak >nul
endlocal
