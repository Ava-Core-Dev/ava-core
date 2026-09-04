# AVA-CORE Windows tasks. Never launch powershell.exe (it flashes a console).
# Do not name a parameter $Args — PowerShell's automatic $args wipes XML <Arguments>.

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Pythonw = Join-Path $Repo ".venv\Scripts\pythonw.exe"
if (-not (Test-Path -LiteralPath $Pythonw)) { throw "missing $Pythonw" }

function Register-SilentPythonw {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [int]$Minutes = 0,
    [int]$Seconds = 0,
    [int]$TimeoutMinutes = 1
  )
  if ($Seconds -le 0 -and $Minutes -le 0) { throw "Minutes or Seconds required for $Name" }
  $interval = if ($Seconds -gt 0) { "PT${Seconds}S" } else { "PT${Minutes}M" }
  $xmlPath = Join-Path $Repo "windows\$Name.xml"
  $start = (Get-Date).AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:ss")
  $cmdEsc = [System.Security.SecurityElement]::Escape($Pythonw)
  $argEsc = [System.Security.SecurityElement]::Escape(('"' + $ScriptPath + '"'))
  $workEsc = [System.Security.SecurityElement]::Escape($Repo)
  $doc = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>AVA-CORE $Name (pythonw, no console)</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>$interval</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$start</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT${TimeoutMinutes}M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$cmdEsc</Command>
      <Arguments>$argEsc</Arguments>
      <WorkingDirectory>$workEsc</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  [System.IO.File]::WriteAllText($xmlPath, $doc, [System.Text.Encoding]::Unicode)
  schtasks /Create /TN "AVA-CORE\$Name" /XML $xmlPath /F | Out-Host
}

Register-SilentPythonw -Name "watchdog" -ScriptPath (Join-Path $Repo "windows\watchdog.py") -Minutes 1 -TimeoutMinutes 1
# Task Scheduler on this Windows build rejects PT30S (min repeat is 1 minute).
# auto-push.py ticks twice inside each minute so edits still hit GitHub in ~30s.
Register-SilentPythonw -Name "auto-push" -ScriptPath (Join-Path $Repo "scripts\auto-push.py") -Minutes 1 -TimeoutMinutes 5
Register-SilentPythonw -Name "auto-pull" -ScriptPath (Join-Path $Repo "scripts\auto-pull.py") -Minutes 10 -TimeoutMinutes 5
Register-SilentPythonw -Name "site-update" -ScriptPath (Join-Path $Repo "scripts\site-update.py") -Minutes 5 -TimeoutMinutes 10
Write-Host "Registered pythonw AVA-CORE\watchdog, auto-push, auto-pull, site-update."
