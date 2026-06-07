@echo off
setlocal
cd /d "%~dp0"

echo.
echo === DogeEdge PC Preview ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Run "Install DogeEdge Dependencies.bat" after installing Node.js LTS.
  pause
  exit /b 1
)

if not exist node_modules (
  echo node_modules was not found. Installing dependencies first...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if exist D:\ (
  set "DOGEEDGE_DATA_DIR=D:\DogeEdge\data\local-worker"
)

echo Starting DogeEdge at http://127.0.0.1:1420/
echo The browser will open after the local server is ready.
start "DogeEdge Local Worker" /b node scripts\dogeedge-local-worker.mjs
start "" /b node scripts\open-when-ready.mjs http://127.0.0.1:1420/
call npm run dev -- --host 127.0.0.1 --port 1420 --strictPort
