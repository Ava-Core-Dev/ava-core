# Register rootmc-api cron triggers via Cloudflare API (wrangler deploy can fail on invalid cron weekday).
# Reads crons from wrangler.toml [triggers]. Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
$ErrorActionPreference = "Stop"

$apiDir = Split-Path $PSScriptRoot -Parent
$tomlPath = Join-Path $apiDir "wrangler.toml"
$tomlLines = Get-Content -LiteralPath $tomlPath

$workerName = "rootmc-api"
foreach ($line in $tomlLines) {
    if ($line -match '^\s*name\s*=\s*"([^"]+)"') {
        $workerName = $Matches[1]
        break
    }
}

$cronsLine = ($tomlLines | Where-Object { $_ -match '^\s*crons\s*=' } | Select-Object -First 1)
if (-not $cronsLine) {
    Write-Warning "No crons = line in wrangler.toml - skipping schedule sync."
    exit 0
}

$inner = ($cronsLine -replace '^\s*crons\s*=\s*\[', '' -replace '\]\s*$', '')
$crons = @($inner -split ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })

$token = [string]$env:CLOUDFLARE_API_TOKEN
$acct = [string]$env:CLOUDFLARE_ACCOUNT_ID
if (-not $token -or $token.Length -lt 20) {
    throw "CLOUDFLARE_API_TOKEN required for schedule sync."
}
if (-not $acct) {
    throw "CLOUDFLARE_ACCOUNT_ID required for schedule sync."
}

$payload = @($crons | ForEach-Object { @{ cron = $_ } })
$bodyJson = if ($payload.Count -gt 0) {
    ConvertTo-Json -InputObject $payload -Compress
} else {
    "[]"
}

$headers = @{
    Authorization  = "Bearer $token"
    "Content-Type" = "application/json"
}
$uri = "https://api.cloudflare.com/client/v4/accounts/$acct/workers/scripts/$workerName/schedules"

Write-Host "Syncing $($crons.Count) cron schedule(s) on $workerName ..."
$resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method PUT -Body $bodyJson -TimeoutSec 60
if (-not $resp.success) {
    throw "Cron schedule PUT returned errors: $($resp.errors | ConvertTo-Json -Compress)"
}

$verify = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET -TimeoutSec 60
$listed = @($verify.result.schedules | ForEach-Object { $_.cron })
Write-Host "Registered crons: $($listed -join ', ')"

$missing = @($crons | Where-Object { $listed -notcontains $_ })
if ($missing.Count -gt 0) {
    throw "Schedule sync incomplete - missing: $($missing -join ', ')"
}
