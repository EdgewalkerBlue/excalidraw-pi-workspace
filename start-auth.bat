@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem ============================================================
rem  公网 / 不可信网络 认证模式一键启动
rem   Canvas Server :5001 (仅绑定 127.0.0.1，不直接对外)
rem   agent-notify  :5010
rem   认证代理      :5003 (Basic Auth + WebSocket 转发，对外入口)
rem  访问: http://<公网IP或域名>:5003 （需管理员放行 5003 / 加 HTTPS 终止）
rem ============================================================

cd /d "%~dp0"

rem ---- 0) 凭据：无 .auth.env 则生成随机强密码 ----
if not exist .auth.env (
  powershell -NoProfile -Command "$p = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_}); Set-Content -Path '.auth.env' -Value ('EXCALIDRAW_AUTH_USER=admin' + [Environment]::NewLine + 'EXCALIDRAW_AUTH_PASS=' + $p) -Encoding UTF8"
  echo [提示] 已生成 .auth.env（用户名 admin，随机强密码）
)
echo [凭据] 请查看根目录 .auth.env（勿提交到 git，已 gitignore）
type .auth.env

rem ---- 1) 端口预检：5003（认证代理）----
netstat -ano | findstr /r /c:":5003 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [错误] 端口 5003 已被占用，无法启动认证代理。
  netstat -ano | findstr /r /c:":5003 .*LISTENING"
  pause
  exit /b 1
)

rem ---- 2) agent-notify（后台，5010）----
netstat -ano | findstr /r /c:":5010 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [提示] 5010 已有服务，跳过 agent-notify
) else (
  start "agent-notify" /B node tools\agent-notify.mjs
)

rem ---- 3) 认证代理（新窗口，5003，读取 .auth.env）----
start "auth-proxy" cmd /c "cd /d %~dp0 && node tools\auth-proxy.mjs"

rem ---- 4) Canvas Server（前台，仅本机 127.0.0.1:5001）----
set PORT=5001
set HOST=127.0.0.1
set EXCALIDRAW_EXPORT_DIR=%cd%\architecture
echo [启动] Canvas Server (仅本机 :5001) ...
echo        对外访问: http://localhost:5003 （需 Basic Auth 凭据）
echo        Ctrl+C 停止服务（同时请关闭 auth-proxy 窗口）
node node_modules\mcp-excalidraw-server\dist\server.js
