@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  Excalidraw 工作区 一键启动
rem    :5001  Canvas Server (mcp-excalidraw-server, 协作闭环锚点)
rem    :5010  Agent 通知服务 (Send to Agent / Approve / Reject)
rem  工作区 UI (npm run dev) 使用 :5002，不会与 Canvas Server 冲突
rem ============================================================

rem ---- 0) 端口预检：5001（Canvas Server）----
netstat -ano | findstr /r /c:":5001 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [错误] 端口 5001 已被占用，Canvas Server 无法启动！
  echo        占用进程如下：
  netstat -ano | findstr /r /c:":5001 .*LISTENING"
  echo.
  echo        请先结束占用进程后重试，例如：
  echo          taskkill /PID <占用PID> /F
  echo        注意：npm run dev / preview 使用 5002，不会与 5001 冲突。
  echo.
  pause
  exit /b 1
)

rem ---- 1) i18n 补丁（默认中文 + 语言切换器同步；幂等）----
node tools\patch-i18n.mjs
if errorlevel 1 (
  echo [警告] i18n 补丁执行失败，界面可能不是中文（可手动运行: node tools\patch-i18n.mjs）
)

rem ---- 2) Agent 通知服务（后台，5010；已运行则跳过）----
netstat -ano | findstr /r /c:":5010 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [提示] 端口 5010 已有服务在运行，跳过 agent-notify 启动。
) else (
  echo [启动] Agent 通知服务 (agent-notify :5010) ...
  start "agent-notify" /B node tools\agent-notify.mjs
)

rem ---- 2) Canvas Server（前台，0.0.0.0:5001）----
set PORT=5001
set HOST=0.0.0.0
set EXCALIDRAW_EXPORT_DIR=D:\projects\excalidraw-workspace\architecture
echo [启动] Excalidraw Canvas Server :5001 ...
echo        本机访问:  http://localhost:5001
echo        局域网访问: http://<本机LAN-IP>:5001  （Ctrl+C 停止服务）
node node_modules\mcp-excalidraw-server\dist\server.js
