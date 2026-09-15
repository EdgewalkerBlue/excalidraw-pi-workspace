@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  Excalidraw workspace one-click launcher
rem    :5001  Canvas Server -- mcp-excalidraw-server, collaboration anchor
rem    :5010  agent-notify service (Send to Agent / Approve / Reject)
rem    :5002  workspace UI (npm run dev / preview), no conflict with 5001
rem  NOTE: keep rem-comment lines ASCII-only. UTF-8 Chinese comments make
rem  cmd.exe lose its parse position under "chcp 65001" and execute random
rem  line fragments as commands (e.g. "'Canvas' is not recognized").
rem ============================================================

rem ---- 0) port pre-check: 5001 (Canvas Server) ----
netstat -ano | findstr /r /c:":5001 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [错误] 端口 5001 已被占用，Canvas Server 无法启动！
  echo        占用进程如下：
  netstat -ano | findstr /r /c:":5001 .*LISTENING"
  echo.
  echo        请先结束占用进程后重试，例如：
  echo          taskkill /PID 进程PID /F
  echo        注意：npm run dev / preview 使用 5002，不会与 5001 冲突。
  echo.
  pause
  exit /b 1
)

rem ---- 1) i18n patch (default EN + zh-CN switch; idempotent) ----
node tools\patch-i18n.mjs
if errorlevel 1 (
  echo [警告] i18n 补丁执行失败（可手动运行: node tools\patch-i18n.mjs）
)
rem ---- 1b) canvas server persist/backup patch (anti-overwrite; idempotent) ----
node tools\patch-server.mjs
if errorlevel 1 (
  echo [警告] server 补丁执行失败（可手动运行: node tools\patch-server.mjs）
)

rem ---- 2) agent-notify (background, :5010; skipped if already running) ----
netstat -ano | findstr /r /c:":5010 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [提示] 端口 5010 已有服务在运行，跳过 agent-notify 启动。
) else (
  echo [启动] Agent 通知服务 ^(agent-notify :5010^) ...
  start "agent-notify" /B node tools\agent-notify.mjs
)

rem ---- 3) Canvas Server (foreground, 0.0.0.0:5001) ----
set PORT=5001
set HOST=0.0.0.0
set EXCALIDRAW_EXPORT_DIR=D:\projects\excalidraw-workspace\architecture
echo [启动] Excalidraw Canvas Server :5001 ...
echo        本机访问:  http://localhost:5001
echo        局域网访问: http://^<本机LAN-IP^>:5001  （Ctrl+C 停止服务）
node node_modules\mcp-excalidraw-server\dist\server.js
