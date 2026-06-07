$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$logDir = Join-Path $repoRoot "tmp"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$startupLog = Join-Path $logDir "startup-runners.log"
$workerOut = Join-Path $logDir "local-worker-startup.out.log"
$workerErr = Join-Path $logDir "local-worker-startup.err.log"

function Write-StartupLog {
  param([string]$Message)
  $timestamp = (Get-Date).ToString("o")
  Add-Content -LiteralPath $startupLog -Value "$timestamp $Message"
}

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )
  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(750, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) {
      $client.Close()
      $client.Dispose()
    }
  }
}

function Start-HiddenCommand {
  param(
    [string]$CommandLine,
    [string]$WorkingDirectory
  )
  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $env:ComSpec
  $processInfo.Arguments = "/d /s /c `"$CommandLine`""
  $processInfo.WorkingDirectory = $WorkingDirectory
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [void][System.Diagnostics.Process]::Start($processInfo)
}

Write-StartupLog "DogeEdge startup runner invoked."

$dataDir = Join-Path $repoRoot "data\local-worker"
if (Test-Path -LiteralPath "D:\") {
  $dataDir = "D:\DogeEdge\data\local-worker"
}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$liveSwitchPath = Join-Path $dataDir "live-switch.json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
if (-not (Test-Path -LiteralPath $liveSwitchPath)) {
  $liveSwitch = [ordered]@{
    enabled = $true
    dryRun = $true
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $liveSwitchJson = $liveSwitch | ConvertTo-Json
  [System.IO.File]::WriteAllText($liveSwitchPath, "$liveSwitchJson`n", $utf8NoBom)
}

$env:DOGEEDGE_DATA_DIR = $dataDir
$env:DOGEEDGE_PERSIST_BACKTEST_TELEMETRY = "1"
$env:DOGEEDGE_PERSIST_PAPER_EVENTS = "1"
$env:DOGEEDGE_PERSIST_SHADOW = "1"
$env:DOGEEDGE_AUTO_SWEEP = "1"
$env:DOGEEDGE_SWEEP_INTERVAL_MS = "43200000"
$env:DOGEEDGE_DEEP_SWEEP_EVERY = "4"
$env:DOGEEDGE_LIVE_SWITCH_ENABLED = "1"
$env:DOGEEDGE_LIVE_TRADING_ENABLED = "1"
$env:DOGEEDGE_LIVE_DRY_RUN = "1"
$env:DOGEEDGE_LIVE_MAX_ORDER_DOLLARS = "10"
$env:DOGEEDGE_LIVE_MAX_EXPOSURE_DOLLARS = "50"
$env:DOGEEDGE_EXECUTION_MIN_EDGE = "0.01"
$env:DOGEEDGE_CONSERVATIVE_MODE = "0"
$env:DOGEEDGE_CONSERVATIVE_MIN_CONFIDENCE = "92"
$env:DOGEEDGE_CONSERVATIVE_MIN_EDGE = "0.06"
$env:DOGEEDGE_CONSERVATIVE_MIN_SIDE_PROBABILITY = "0.90"
$env:DOGEEDGE_CONSERVATIVE_MAX_SPREAD_CENTS = "2"
$env:DOGEEDGE_CONSERVATIVE_MIN_SECONDS_TO_CLOSE = "20"
$env:DOGEEDGE_CONSERVATIVE_MAX_SECONDS_TO_CLOSE = "300"

if (-not (Test-TcpPort -HostName "127.0.0.1" -Port 8787)) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if ($node) {
    $workerCommand = "`"$node`" `"scripts\dogeedge-local-worker.mjs`" 1>>`"$workerOut`" 2>>`"$workerErr`""
    try {
      Start-HiddenCommand -CommandLine $workerCommand -WorkingDirectory $repoRoot
      Write-StartupLog "Started DogeEdge local worker on 127.0.0.1:8787."
    } catch {
      Write-StartupLog "Failed to start DogeEdge local worker: $($_.Exception.Message)"
    }
  } else {
    Write-StartupLog "Node.js was not found; local worker was not started."
  }
} else {
  Write-StartupLog "Local worker already listening on 127.0.0.1:8787."
}

$repoDesktopApp = Join-Path $repoRoot "src-tauri\target\release\dogeedge.exe"
$installedDesktopApp = Join-Path $env:LOCALAPPDATA "DogeEdge\dogeedge.exe"
$desktopApp = if (Test-Path -LiteralPath $repoDesktopApp) { $repoDesktopApp } else { $installedDesktopApp }
$desktopRunning = Get-Process -Name dogeedge -ErrorAction SilentlyContinue

if ((Test-Path -LiteralPath $desktopApp) -and -not $desktopRunning) {
  Start-Process -FilePath $desktopApp -WorkingDirectory (Split-Path -Parent $desktopApp)
  Write-StartupLog "Started DogeEdge desktop app from $desktopApp."
} elseif ($desktopRunning) {
  Write-StartupLog "DogeEdge desktop app already running."
} else {
  Write-StartupLog "DogeEdge desktop app was not found at $desktopApp."
}
