# Reset host metrics + presence data before an HST cutoff (startup baseline).
# Usage:
#   powershell -File scripts\reset-host-startup-baseline.ps1
#   powershell -File scripts\reset-host-startup-baseline.ps1 -CutoffHst "2026-07-10T10:00:00"
param(
    [string]$CutoffHst = ""
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}

if (-not $CutoffHst) {
    $hstNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "Hawaiian Standard Time")
    $CutoffHst = $hstNow.ToString("yyyy-MM-dd") + "T10:00:00"
}

$cutoffUtc = [DateTime]::Parse($CutoffHst + "-10:00", $null, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToString("o")
Write-Host "Resetting host startup data before HST cutoff $CutoffHst (-10:00) = UTC $cutoffUtc"

$sql = @"
-- Host health startup baseline reset (metrics + presence uptime)
DELETE FROM rootmc_host_metrics_minute WHERE minute_ts < '$cutoffUtc';
DELETE FROM rootmc_host_presence_session WHERE started_at < '$cutoffUtc';
DELETE FROM rootmc_host_metrics_lifetime;
INSERT INTO rootmc_host_metrics_lifetime (
  host_key, host_kind, host_label,
  cpu_sum, ram_sum, disk_sum, tps_sum, sample_total, minute_count,
  first_minute_ts, last_minute_ts, updated_at
)
SELECT
  host_key,
  MAX(host_kind),
  MAX(host_label),
  SUM(cpu_avg_pct * sample_count),
  SUM(ram_avg_pct * sample_count),
  SUM(disk_used_pct * sample_count),
  SUM(COALESCE(tps_avg, 0) * sample_count),
  SUM(sample_count),
  COUNT(*),
  MIN(minute_ts),
  MAX(minute_ts),
  datetime('now')
FROM rootmc_host_metrics_minute
GROUP BY host_key;
UPDATE rootmc_dev_workstation SET timeout_notified_at = NULL WHERE timeout_notified_at IS NOT NULL;
"@

$tmp = Join-Path $env:TEMP ("rootmc-host-baseline-" + [Guid]::NewGuid().ToString("n") + ".sql")
Set-Content -LiteralPath $tmp -Value $sql -Encoding UTF8

Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "Executing on remote D1 rootmc ..."
npx wrangler d1 execute rootmc --remote --file="$tmp"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
Write-Host "Done. Uptime + metrics collection baseline is now $CutoffHst HST."
