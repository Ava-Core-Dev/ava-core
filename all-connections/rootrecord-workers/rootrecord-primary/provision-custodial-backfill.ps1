# POST /api/internal/provision-custodial-wallets-missing in batches until no accounts lack custodial rows.
# Requires RR_PUSH_ADMIN_SECRET (same as push-broadcast). Loads credentials.env like deploy.ps1.
$ErrorActionPreference = "Stop"
$repoRoot = $null
$probe = $PSScriptRoot
for ($i = 0; $i -le 14; $i++) {
    $tryCred = Join-Path $probe "credentials.env"
    if (Test-Path -LiteralPath $tryCred) {
        $repoRoot = $probe
        break
    }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
}
if (-not $repoRoot) {
    throw "credentials.env not found (searched parents of $PSScriptRoot)."
}
Get-Content (Join-Path $repoRoot "credentials.env") | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $p = $line.IndexOf("=")
    if ($p -gt 0) {
        $k = $line.Substring(0, $p).Trim()
        $v = $line.Substring($p + 1).Trim()
        Set-Item -Path "Env:$k" -Value $v
    }
}

$admin = [string]$env:RR_PUSH_ADMIN_SECRET
if (-not $admin -or $admin.Length -lt 8) {
    throw "RR_PUSH_ADMIN_SECRET missing or too short in credentials.env."
}

$api = [string]$env:ROOTRECORD_PRIMARY_API
if (-not $api) { $api = [string]$env:WEATHER_API_PUBLIC_URL }
if (-not $api) { $api = "https://api.rootrecord.info" }
$api = $api.TrimEnd("/")

$uri = "$api/api/internal/provision-custodial-wallets-missing"
$headers = @{
    "X-RR-Push-Admin-Key" = $admin
    "Content-Type"        = "application/json"
}

$batch = 300
$round = 0
$totalProvisioned = 0
Write-Host "Backfill custodial wallets -> $uri (batches of $batch)"

while ($true) {
    $round++
    $body = "{`"limit`":$batch}"
    try {
        $r = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body -TimeoutSec 120
    } catch {
        Write-Error "Request failed: $($_.Exception.Message)"
        throw
    }
    if (-not $r.ok) {
        throw "API error: $($r.detail)"
    }
    $p = [int]$r.provisioned
    $e = [int]$r.examined
    $rem = [int]$r.remaining_without_wallet
    $totalProvisioned += $p
    Write-Host "Batch $round : examined=$e provisioned=$p remaining_without_wallet=$rem"
    if (-not $r.more_batches_suggested) { break }
    if ($e -eq 0 -and $p -eq 0) { break }
}

Write-Host "Done. Total provisioned this run: $totalProvisioned"
