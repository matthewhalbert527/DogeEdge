@echo off
setlocal
cd /d "%~dp0"

echo.
echo === DogeEdge Windows Desktop Build ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo is required to build the Windows desktop installer.
  echo Install Rust from https://rustup.rs/ and Microsoft C++ Build Tools, then rerun this file.
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

call npm test
if errorlevel 1 (
  echo Tests failed. Build stopped.
  pause
  exit /b 1
)

call npm run lint
if errorlevel 1 (
  echo Lint failed. Build stopped.
  pause
  exit /b 1
)

call npm run tauri -- build
if errorlevel 1 (
  echo Tauri build failed.
  pause
  exit /b 1
)

echo.
echo Build finished.
echo Check src-tauri\target\release\bundle for the Windows installer.
echo.
pause
