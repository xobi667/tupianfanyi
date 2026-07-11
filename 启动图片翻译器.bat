@echo off
chcp 65001 >nul
setlocal
title xobi 图片翻译器启动器

rem 隔离 PowerShell 7 继承的模块路径，避免 Windows PowerShell 5.1 误加载 PS7 模块。
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%ProgramFiles%\WindowsPowerShell\Modules"

set "APP_DIR=%~dp0project"
set "APP_PORT=3006"
set "APP_URL=http://127.0.0.1:%APP_PORT%"

cd /d "%APP_DIR%" || goto :dir_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :npm_error
where powershell >nul 2>nul || goto :powershell_error
if not exist package-lock.json goto :lock_error

rem 健康服务已经存在时只打开浏览器，绝不重启或强杀在途生图。
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%APP_URL%'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match 'xobi|图片翻译') { Start-Process $u; exit 0 } } catch {}; exit 1"
if not errorlevel 1 exit /b 0

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)" || goto :node_version_error

echo.
echo [1/4] 检查依赖...
set "NEEDS_INSTALL=0"
if not exist node_modules set "NEEDS_INSTALL=1"
if exist node_modules (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lock=(Get-FileHash -Algorithm SHA256 -LiteralPath 'package-lock.json').Hash; $marker=Join-Path 'node_modules' '.xobi-package-lock.sha256'; if (!(Test-Path -LiteralPath $marker) -or ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $lock)) { exit 1 }"
  if errorlevel 1 set "NEEDS_INSTALL=1"
)

if "%NEEDS_INSTALL%"=="1" (
  echo 正在按 package-lock.json 安装依赖...
  call npm ci || goto :install_error
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lock=(Get-FileHash -Algorithm SHA256 -LiteralPath 'package-lock.json').Hash; Set-Content -LiteralPath (Join-Path 'node_modules' '.xobi-package-lock.sha256') -Value $lock -Encoding Ascii" || goto :install_error
) else (
  echo 依赖已匹配。
)

echo [2/4] 检查生产构建...
set "NEEDS_BUILD=0"
if not exist .next\standalone\server.js set "NEEDS_BUILD=1"
if "%NEEDS_BUILD%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $build=(Get-Item -LiteralPath '.next\standalone\server.js').LastWriteTimeUtc; $files=@(Get-ChildItem -Path @('app','lib','public','scripts') -Recurse -File -ErrorAction SilentlyContinue); $files += @(Get-Item -Path @('package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs') -ErrorAction SilentlyContinue); if ($files | Where-Object { $_.LastWriteTimeUtc -gt $build } | Select-Object -First 1) { exit 1 }"
  if errorlevel 1 set "NEEDS_BUILD=1"
)

if "%NEEDS_BUILD%"=="1" (
  echo 检测到源码更新，正在构建稳定版...
  call npm run build || goto :build_error
) else (
  echo 生产构建已是最新。
)

echo [3/4] 安全检查端口并启动本地服务...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\scripts\launch-local.ps1" -AppDir "%APP_DIR%" -Port %APP_PORT%
if errorlevel 1 goto :start_error

echo [4/4] 浏览器已打开。
exit /b 0

:dir_error
echo 无法进入项目目录：%APP_DIR%
goto :failed

:node_error
echo 未找到 Node.js，请先安装 Node.js 20.9 或更高版本。
goto :failed

:node_version_error
echo Node.js 版本过低，需要 20.9 或更高版本。
goto :failed

:npm_error
echo 未找到 npm，请检查 Node.js 安装。
goto :failed

:powershell_error
echo 未找到 PowerShell。
goto :failed

:lock_error
echo 缺少 package-lock.json，已停止启动，避免安装不确定版本。
goto :failed

:install_error
echo 依赖安装失败，请检查网络和权限。
goto :failed

:build_error
echo 生产构建失败，请查看上方错误信息。
goto :failed

:start_error
echo xobi 启动失败。为保护可能仍在运行的付费任务，启动器没有强制结束任何未知进程。

:failed
echo.
pause
exit /b 1
