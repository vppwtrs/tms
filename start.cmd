@echo off
rem Keep this file ASCII-only: cmd.exe mis-parses multi-byte text after chcp 65001.
rem All Thai messages live in scripts\bootstrap-node.ps1 and scripts\serve.mjs.
chcp 65001 >nul
cd /d "%~dp0"
setlocal

set "NODE_PATH_FILE=%TEMP%\tms-node-path.txt"
if exist "%NODE_PATH_FILE%" del "%NODE_PATH_FILE%" >nul 2>nul

rem Install a portable Node.js first if this machine has none (no admin needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\bootstrap-node.ps1" -OutFile "%NODE_PATH_FILE%"
if errorlevel 1 goto :fail

if not exist "%NODE_PATH_FILE%" goto :fail
set /p NODE_EXE=<"%NODE_PATH_FILE%"
if not exist "%NODE_EXE%" goto :fail

rem Put Node on PATH for this window only, so no restart is needed.
for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%APPDATA%\npm;%PATH%"

"%NODE_EXE%" scripts\serve.mjs start --open
echo.
pause
exit /b 0

:fail
echo.
echo [X] Node.js setup failed - see the message above.
echo.
pause
exit /b 1
