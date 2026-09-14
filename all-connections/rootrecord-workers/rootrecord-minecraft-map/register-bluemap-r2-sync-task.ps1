# Optional: register nightly BlueMap → R2 sync on the machine that has bluemap/web (e.g. after FileZilla sync).
# Run once from elevated PowerShell:
#   powershell -File Web\cloudflare\rootrecord-minecraft-map\register-bluemap-r2-sync-task.ps1
#
# Task runs daily at 04:30 local time. Edit $Source if your web root differs.

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
    if (Test-Path (Join-Path $repoRoot "credentials.env")) { break }
    $repoRoot = Split-Path $repoRoot -Parent
}

$script = Join-Path $PSScriptRoot "sync-bluemap-r2.ps1"
if (-not (Test-Path $script)) { throw "Missing $script" }

$taskName = "RootMC-BlueMap-R2-Sync"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At "04:30"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $taskName (daily 04:30)"
