@echo off
setlocal
cd /d "%~dp0"

echo.
echo === DogeEdge Desktop Dev ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required.
  pause
  exit /b 1
)

if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo is required for the desktop shell.
  echo Install Rust from https://rustup.rs/ and install Microsoft C++ Build Tools.
  echo You can still run "Run DogeEdge PC Preview.bat" without Rust.
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

echo Starting DogeEdge local worker for factory data capture...
start "DogeEdge Local Worker" /b node scripts\dogeedge-local-worker.mjs

call npm run tauri -- dev
