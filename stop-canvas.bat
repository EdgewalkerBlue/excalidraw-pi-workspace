@echo off
setlocal EnableDelayedExpansion
rem Stop background services: canvas :5001, notify :5010, stray :3000.
rem :3000 is the server's default port - a stray instance there blocks
rem any start attempt that did not receive PORT=5001.
rem NOTE: keep this file ASCII-only with CRLF line endings.

set STOPPED=0
for %%p in (5001 5010 3000) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%%p .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1 && (echo [STOPPED] port %%p ^(PID %%a^) & set STOPPED=1)
  )
)
if "!STOPPED!"=="0" echo [INFO] No running services found.
timeout /t 2 /nobreak >nul
endlocal
