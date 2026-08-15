@echo off
rem Keep this file ASCII-only: cmd.exe mis-parses multi-byte text after chcp 65001.
chcp 65001 >nul
cd /d "%~dp0"
setlocal

set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=%LOCALAPPDATA%\nodejs\node.exe"
if not exist "%NODE_EXE%" if "%NODE_EXE%" neq "node" (
  echo [X] Node.js not found - run start.cmd first.
  pause
  exit /b 1
)

"%NODE_EXE%" scripts\serve.mjs stop
echo.
pause
