@echo off
rem  TMS Extractor - launcher
rem  Keep this file ASCII-only. Thai text lives in launch.ps1, which forces UTF-8 output.
chcp 65001 >nul
title TMS Extractor

:run
powershell -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0tms-extractor\launch.ps1"

rem  exit code 10 = Node.js was just installed, run again with a fresh PATH
if errorlevel 11 goto done
if errorlevel 10 goto again
goto done

:again
timeout /t 2 /nobreak >nul
goto run

:done
