@echo off
setlocal
title Image Translator Launcher

set "APP_DIR=%~dp0project"
set "APP_PORT=3006"

cd /d "%APP_DIR%" || goto :dir_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :npm_error

echo.
if exist node_modules (
  echo [1/5] Using existing dependencies...
) else (
  echo [1/5] Installing dependencies...
  call npm install || goto :install_error
)

echo [2/5] Starting dev server in a new window on port %APP_PORT%...
start "Image Translator Dev Server" cmd /k "cd /d ""%APP_DIR%"" && npm run dev -- --port %APP_PORT%"

echo [3/5] Waiting for server startup...
timeout /t 8 /nobreak >nul

echo [4/5] Opening browser...
start "" "http://localhost:%APP_PORT%"

echo [5/5] Done.
echo If the page opens too early, wait a few seconds and refresh it manually.
echo.
pause
exit /b 0

:dir_error
echo Failed to enter project directory: %APP_DIR%
pause
exit /b 1

:node_error
echo Node.js was not found. Please install Node.js first.
pause
exit /b 1

:npm_error
echo npm was not found. Please make sure Node.js is installed correctly.
pause
exit /b 1

:install_error
echo Dependency installation failed. Please check network, permissions, or npm config.
pause
exit /b 1
