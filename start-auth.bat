@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem ============================================================
rem  Public / untrusted-network auth-mode launcher
rem    :5001  Canvas Server -- binds 127.0.0.1 only, never exposed directly
rem    :5010  agent-notify service
rem    :5003  auth proxy -- Basic Auth + WebSocket forwarding, public entry
rem    access via http://host:5003 (firewall-open 5003 / terminate HTTPS upstream)
rem  NOTE: keep rem-comment lines ASCII-only. UTF-8 Chinese comments make
rem  cmd.exe lose its parse position under "chcp 65001" and execute random
rem  line fragments as commands. Same rule as start-canvas.bat.
rem ============================================================

cd /d "%~dp0"

rem ---- 0.5) canvas server patch (idempotent; same as start-canvas.bat) ----
rem      NOTE: patch-i18n retired 2026-09-23 (legacy/) - i18n now uses the official langCode prop.
node tools\patch-server.mjs
if errorlevel 1 (
  echo [警告] server 补丁执行失败（可手动运行: node tools\patch-server.mjs）
)

rem ---- 0) credentials: generate random strong password if .auth.env missing ----
if not exist .auth.env (
  powershell -NoProfile -Command "$p = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_}); Set-Content -Path '.auth.env' -Value ('EXCALIDRAW_AUTH_USER=admin' + [Environment]::NewLine + 'EXCALIDRAW_AUTH_PASS=' + $p) -Encoding UTF8"
  echo [提示] 已生成 .auth.env（用户名 admin，随机强密码）
)
echo [凭据] 请查看根目录 .auth.env（勿提交到 git，已 gitignore）
type .auth.env

rem ---- 1) port pre-check: 5003 (auth proxy) ----
netstat -ano | findstr /r /c:":5003 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [错误] 端口 5003 已被占用，无法启动认证代理。
  netstat -ano | findstr /r /c:":5003 .*LISTENING"
  pause
  exit /b 1
)

rem ---- 2) agent-notify (background, :5010) ----
netstat -ano | findstr /r /c:":5010 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [提示] 5010 已有服务，跳过 agent-notify
) else (
  start "agent-notify" /B node tools\agent-notify.mjs
)

rem ---- 3) auth proxy (new window, :5003, reads .auth.env) ----
start "auth-proxy" cmd /c "cd /d %~dp0 && node tools\auth-proxy.mjs"

rem ---- 4) Canvas Server (foreground, local-only 127.0.0.1:5001) ----
set PORT=5001
set HOST=127.0.0.1
set EXCALIDRAW_EXPORT_DIR=%cd%\architecture
echo [启动] Canvas Server (仅本机 :5001) ...
echo        对外访问: http://localhost:5003 （需 Basic Auth 凭据）
echo        Ctrl+C 停止服务（同时请关闭 auth-proxy 窗口）
node node_modules\mcp-excalidraw-server\dist\server.js
