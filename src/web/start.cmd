@echo off
rem Starts the woslicer-dx offline web build: serves this folder on
rem http://127.0.0.1 and opens the default browser (Node.js required).
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local server. See README for alternatives.
  pause
  exit /b 1
)
node server.mjs
endlocal
