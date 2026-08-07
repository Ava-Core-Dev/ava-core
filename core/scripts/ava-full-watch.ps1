# Ava Ivy full live watch - shows her posted responses in full
$ErrorActionPreference = "SilentlyContinue"
$Host.UI.RawUI.WindowTitle = "Ava Ivy - FULL live watch (responses)"
try {
  $Host.UI.RawUI.BufferSize = New-Object Management.Automation.Host.Size(240, 8000)
} catch {}

$data = "D:\.1 Work Stations\RootMC\Server Handoffs\Ava Ivy\data"
$consoleLog = Join-Path $data "ava-console.log"
$consoleErr = Join-Path $data "ava-console.err"
$events = Join-Path $data "status-events.jsonl"
$turns = Join-Path $data "conversations\turns.jsonl"
$hbPath = Join-Path $data "heartbeat.json"

$channelNames = @{
  "1516108586307158088" = "#general"
  "1516121832493678612" = "#admins"
  "1516389376198840421" = "#memes"
  "1520665313631408251" = "#updates"
  "1522406451413385317" = "#governance"
  "1522413185364398090" = "#voting"
  "1522406019152478210" = "#constitution"
  "1526664180491358419" = "#proposals"
  "1532929974154166522" = "#development"
  "1532904783030128790" = "DM:Melee"
}

function Get-ChannelLabel([string]$id) {
  if (-not $id) { return "?" }
  if ($channelNames.ContainsKey($id)) { return $channelNames[$id] }
  return "ch:$id"
}

function Get-TailLines([string]$path, [int]$n) {
  if (-not (Test-Path $path)) { return @() }
  return @(Get-Content -Path $path -Tail $n -Encoding UTF8)
}

function Write-ResponseCard($t, [bool]$isLive = $false) {
  $when = "??:??:??"
  try {
    $when = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$t.at).LocalDateTime.ToString("HH:mm:ss")
  } catch {}
  $ch = Get-ChannelLabel ([string]$t.channelId)
  $tag = if ($isLive) { "NEW POST" } else { "POST" }
  $who = [string]$t.authorName
  Write-Host ""
  Write-Host ("======== {0} {1} | {2} | from {3} ========" -f $tag, $when, $ch, $who) -ForegroundColor Magenta
  Write-Host "THEY SAID:" -ForegroundColor DarkYellow
  Write-Host ([string]$t.question)
  Write-Host ""
  Write-Host "AVA REPLIED:" -ForegroundColor Cyan
  Write-Host ([string]$t.answer) -ForegroundColor White
  Write-Host ("======== end intent={0} ========" -f $t.intent) -ForegroundColor DarkGray
  Write-Host ""
}

Write-Host "Ava FULL watch - responses in full. Ctrl+C to stop." -ForegroundColor Cyan
Write-Host "If this window is behind others, check the taskbar for: Ava Ivy - FULL live watch" -ForegroundColor DarkGray
Write-Host ""

$consolePos = 0
if (Test-Path $consoleLog) { $consolePos = (Get-Item $consoleLog).Length }
$errPos = 0
if (Test-Path $consoleErr) { $errPos = (Get-Item $consoleErr).Length }
$lastTurnLen = 0
if (Test-Path $turns) { $lastTurnLen = (Get-Item $turns).Length }
$lastEventLen = 0
if (Test-Path $events) { $lastEventLen = (Get-Item $events).Length }

Write-Host "=== HER LAST POSTED RESPONSES (newest last) ===" -ForegroundColor Cyan
foreach ($line in (Get-TailLines $turns 8)) {
  try {
    Write-ResponseCard ($line | ConvertFrom-Json) $false
  } catch {}
}
Write-Host "Listening for new replies..." -ForegroundColor DarkGray
Write-Host ""

$tick = 0
while ($true) {
  $tick++

  if (($tick % 30) -eq 1) {
    Write-Host ("--- status {0} ---" -f (Get-Date -Format "HH:mm:ss")) -ForegroundColor Yellow
    $procs = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object {
      $_.CommandLine -match 'rootmc-ava|src/(index|poller|server)\.mjs'
    })
    $kinds = @($procs | ForEach-Object {
      if ($_.CommandLine -match 'poller') { 'poller' }
      elseif ($_.CommandLine -match 'server') { 'server' }
      elseif ($_.CommandLine -match 'index') { 'index' }
      else { 'other' }
    }) -join ","
    Write-Host ("  procs={0} [{1}]" -f $procs.Count, $kinds)
    if (Test-Path $hbPath) {
      $h = Get-Content $hbPath -Raw -Encoding UTF8 | ConvertFrom-Json
      Write-Host ("  live={0} mode={1} queue={2} lastAsk={3}" -f $h.live, $h.mode, $h.queueDepth, $h.lastAsk)
    }
  }

  if (Test-Path $turns) {
    $tl = (Get-Item $turns).Length
    if ($tl -lt $lastTurnLen) { $lastTurnLen = 0 }
    if ($tl -gt $lastTurnLen) {
      $fs = [System.IO.File]::Open($turns, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      try {
        [void]$fs.Seek($lastTurnLen, [System.IO.SeekOrigin]::Begin)
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        while ($null -ne ($line = $sr.ReadLine())) {
          if (-not $line.Trim()) { continue }
          try {
            Write-ResponseCard ($line | ConvertFrom-Json) $true
          } catch {
            Write-Host ("[TURN raw] {0}" -f $line) -ForegroundColor Green
          }
        }
        $lastTurnLen = $fs.Position
        $sr.Dispose()
      } finally {
        $fs.Close()
      }
    }
  }

  if (Test-Path $events) {
    $el = (Get-Item $events).Length
    if ($el -lt $lastEventLen) { $lastEventLen = 0 }
    if ($el -gt $lastEventLen) {
      $fs = [System.IO.File]::Open($events, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      try {
        [void]$fs.Seek($lastEventLen, [System.IO.SeekOrigin]::Begin)
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        while ($null -ne ($line = $sr.ReadLine())) {
          if ($line -match 'answered|ask |boot post|gateway|cooldown') {
            Write-Host ("[EVT] {0}" -f $line) -ForegroundColor DarkYellow
          }
        }
        $lastEventLen = $fs.Position
        $sr.Dispose()
      } finally {
        $fs.Close()
      }
    }
  }

  foreach ($pair in @(
    @{ Path = $consoleLog; Pos = [ref]$consolePos; Color = "DarkGray"; Tag = "OUT" },
    @{ Path = $consoleErr; Pos = [ref]$errPos; Color = "Red"; Tag = "ERR" }
  )) {
    if (-not (Test-Path $pair.Path)) { continue }
    $len = (Get-Item $pair.Path).Length
    if ($len -lt $pair.Pos.Value) { $pair.Pos.Value = 0 }
    if ($len -gt $pair.Pos.Value) {
      $fs = [System.IO.File]::Open($pair.Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      try {
        [void]$fs.Seek($pair.Pos.Value, [System.IO.SeekOrigin]::Begin)
        $sr = New-Object System.IO.StreamReader($fs)
        while ($null -ne ($line = $sr.ReadLine())) {
          Write-Host ("[{0}] {1}" -f $pair.Tag, $line) -ForegroundColor $pair.Color
        }
        $pair.Pos.Value = $fs.Position
        $sr.Dispose()
      } finally {
        $fs.Close()
      }
    }
  }

  Start-Sleep -Milliseconds 400
}
