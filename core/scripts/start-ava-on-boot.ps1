# Start Ava Ivy on workstation boot / login (sleep-aware).
# Install: powershell -File "Web Files\rootmc-ava\scripts\install-ava-autostart.ps1"

$ErrorActionPreference = "SilentlyContinue"
$avaRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $avaRoot "package.json"))) {
  $avaRoot = "D:\.1 Work Stations\RootMC\Web Files\rootmc-ava"
}
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { exit 1 }

# Already running?
$alive = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -match 'rootmc-ava\\src\\(index|server|poller)\.mjs'
}
if ($alive) {
  Write-Host "Ava already running"
  exit 0
}

$env:AVA_NO_STATUS_WINDOW = "1"
Start-Process -FilePath $node -ArgumentList "src/index.mjs" -WorkingDirectory $avaRoot -WindowStyle Hidden
Write-Host "Ava started from $avaRoot"
