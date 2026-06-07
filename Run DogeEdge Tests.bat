@echo off
setlocal
cd /d "%~dp0"

echo.
echo === DogeEdge Tests ===
echo.

if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

call npm test
if errorlevel 1 goto failed

call npm run lint
if errorlevel 1 goto failed

call npm run build
if errorlevel 1 goto failed

echo.
echo DogeEdge tests, lint, and web build passed.
echo.
pause
exit /b 0

:failed
echo.
echo DogeEdge validation failed.
echo.
pause
exit /b 1
