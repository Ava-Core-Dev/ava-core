# Dry-run or live native SOL sweep: all custodial wallets -> destination (operator).
# Loads RR_PUSH_ADMIN_SECRET from repo-root credentials.env (never commit secrets).
# Default destination = public treasury wallet (same default as Solana Tools tokenomics / ecosystem constants).
#
# Usage:
#   .\scripts\sweep-custodial-sol.ps1              # dry run
#   .\scripts\sweep-custodial-sol.ps1 -Live      # REAL chain transfers
#   .\scripts\sweep-custodial-sol.ps1 -Destination "OtherPubkey..."
#
param(
  [string] $Destination = "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ",
  [switch] $Live
)

$ErrorActionPreference = "Stop"

$repoRoot = $null
$probe = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
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
  throw "credentials.env not found (walk parents from $($PSScriptRoot))."
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
  throw "RR_PUSH_ADMIN_SECRET missing from credentials.env (or too short)."
}

$api = [string]$env:ROOTRECORD_ACCOUNT_API
if (-not $api) { $api = "https://rootrecord-api-account.rootrecord.workers.dev" }
$api = $api.Trim().TrimEnd("/")
$uri = "$api/api/internal/sweep-custodial-sol-all"
$headers = @{
  "X-RR-Push-Admin-Key" = $admin
}
$bodyObj = @{
  destination        = $Destination
  dry_run            = -not $Live
  respect_rent_floor = $false
}

Write-Host "POST $uri"
Write-Host "destination=$Destination dry_run=$(-not $Live) respect_rent_floor=false"

try {
  $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body ($bodyObj | ConvertTo-Json -Compress)
  $response | ConvertTo-Json -Depth 20
} catch {
  $r = $_.ErrorDetails.Message
  if ($r) { Write-Host $r }
  else { throw $_ }
}
