param(
  [Parameter(Mandatory = $true)]
  [string]$AppDir,
  [int]$Port = 3006,
  [switch]$NoBrowser
)

# Windows PowerShell can inherit PowerShell 7's PSModulePath from a parent
# terminal. Keep this launcher on the inbox Windows module set in that case.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = @(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
  ) -join [IO.Path]::PathSeparator
}

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath $AppDir).Path
$workspaceRoot = Split-Path -Parent $projectRoot
$resourceDir = Join-Path $workspaceRoot '资源'
$logDir = Join-Path $resourceDir '系统日志'
$pidFile = Join-Path $logDir 'xobi-server.pid'
$serverScript = Join-Path $projectRoot 'scripts\start-standalone-local.mjs'
$url = "http://127.0.0.1:$Port"

function Test-XobiHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match 'xobi|图片翻译'
  } catch {
    return $false
  }
}

function Get-ListeningProcessIds {
  return @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Test-XobiHealthy) {
  if (!$NoBrowser) { Start-Process $url }
  Write-Host "xobi 已经在运行，不会重启服务。"
  exit 0
}

$listeners = Get-ListeningProcessIds
if ($listeners.Count -gt 0) {
  $pidText = $listeners -join ', '
  throw "端口 $Port 已被进程 $pidText 占用，但没有返回健康的 xobi 页面。为保护可能仍在运行的付费生图任务，启动器不会强制结束它。"
}

if (Test-Path -LiteralPath $pidFile) {
  $savedPid = 0
  [void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$savedPid)
  $savedProcess = if ($savedPid -gt 0) {
    Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
  } else {
    $null
  }
  if ($savedProcess) {
    $savedCommandLine = [string]$savedProcess.CommandLine
    if ($savedCommandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      throw "检测到旧 xobi 进程 $savedPid 仍存在。为保护在途生图，启动器不会自动结束它；请先确认任务状态。"
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (!(Test-Path -LiteralPath $serverScript)) {
  throw "缺少本地启动脚本：$serverScript"
}
if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.next\standalone\server.js'))) {
  throw '缺少生产构建，请先运行 npm run build。'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDir "xobi-server-$timestamp.out.log"
$stderrLog = Join-Path $logDir "xobi-server-$timestamp.err.log"
$node = (Get-Command node -ErrorAction Stop).Source

$previousPort = $env:PORT
$previousHostname = $env:HOSTNAME
$serverArgument = '"' + $serverScript + '"'
$env:PORT = [string]$Port
$env:HOSTNAME = '127.0.0.1'
try {
  $process = Start-Process -FilePath $node `
    -ArgumentList $serverArgument `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
} finally {
  $env:PORT = $previousPort
  $env:HOSTNAME = $previousHostname
}

Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding UTF8

$deadline = [DateTime]::UtcNow.AddSeconds(75)
while ([DateTime]::UtcNow -lt $deadline) {
  $process.Refresh()
  if ($process.HasExited) {
    $errorTail = if (Test-Path -LiteralPath $stderrLog) {
      (Get-Content -LiteralPath $stderrLog -Tail 12 -Encoding UTF8) -join [Environment]::NewLine
    } else {
      '没有错误日志。'
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "xobi 服务启动失败（退出码 $($process.ExitCode)）。$([Environment]::NewLine)$errorTail"
  }

  if (Test-XobiHealthy) {
    if (!$NoBrowser) { Start-Process $url }
    Write-Host "xobi 已启动：$url"
    Write-Host "服务日志：$stdoutLog"
    exit 0
  }

  Start-Sleep -Milliseconds 600
}

if (!$process.HasExited) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
throw "xobi 在 75 秒内没有通过健康检查。请查看日志：$stderrLog"


