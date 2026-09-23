@echo off
rem ============================================================
rem  ship.bat - release helper wrapper
rem    DEV -> push origin/DEV -> merge into master -> back to DEV
rem  Logic lives in tools/ship.sh (single source of truth).
rem  Usage:  ship.bat -m "feat: xxx"
rem          ship.bat -m "xxx" --dry-run
rem  NOTE: keep this file ASCII-only with CRLF line endings.
rem ============================================================
setlocal
cd /d "%~dp0"

set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo [FAIL] Git Bash not found. Run this inside Git Bash instead:
  echo        bash tools/ship.sh %*
  exit /b 1
)

"%BASH%" -c "bash tools/ship.sh %*"
exit /b %ERRORLEVEL%
