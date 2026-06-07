@echo off
setlocal
cd /d "%~dp0"

echo.
echo === DogeEdge dependency install ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required before DogeEdge can run.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS and run this file again.
  pause
  exit /b 1
)

echo Installing JavaScript dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo.
echo Dependencies installed.
echo You can now run "Run DogeEdge PC Preview.bat".
echo.
pause
