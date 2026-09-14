# Deploy auth Worker — loads credentials.env by walking parents from this folder (same as rootrecord-primary).
# Hard rule: this project uses ONLY the D1 database named `root-record` (same UUID as rootrecord-primary).
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
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
    throw "credentials.env not found (searched parents of $PSScriptRoot). Place it at your Web clone root or any ancestor folder."
}
$rootCred = Join-Path $repoRoot "credentials.env"
Get-Content $rootCred | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $p = $line.IndexOf("=")
    if ($p -gt 0) {
        $k = $line.Substring(0, $p).Trim()
        $v = $line.Substring($p + 1).Trim()
        Set-Item -Path "Env:$k" -Value $v
    }
}
if ($env:CLOUDFLARE_GLOBAL_API_KEY -and -not $env:CLOUDFLARE_API_KEY) {
    Set-Item -Path "Env:CLOUDFLARE_API_KEY" -Value $env:CLOUDFLARE_GLOBAL_API_KEY
}
$hasToken = $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_API_TOKEN.Length -ge 10
$hasGlobal = $env:CLOUDFLARE_API_KEY -and $env:CLOUDFLARE_API_KEY.Length -ge 10 -and $env:CLOUDFLARE_EMAIL -and $env:CLOUDFLARE_EMAIL.Length -gt 3
if (-not $hasToken -and -not $hasGlobal) {
    Write-Host "Set either CLOUDFLARE_API_TOKEN, or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY in credentials.env."
    exit 1
}
Set-Location $PSScriptRoot
$wranglerToml = Get-Content -LiteralPath (Join-Path $PSScriptRoot "wrangler.toml") -Raw
if ($wranglerToml -notmatch 'database_name\s*=\s*"root-record"') {
    throw "wrangler.toml must set database_name = `"root-record`" only. No other D1 database."
}
$expectId = [string]$env:D1_DATABASE_ID
if ($expectId.Length -ge 32 -and $wranglerToml -notmatch [regex]::Escape($expectId)) {
    throw "wrangler.toml database_id must match D1_DATABASE_ID from credentials.env ($expectId)."
}
if (-not (Test-Path "node_modules")) { npm install }

$jwtFile = Join-Path $PSScriptRoot ".deploy-jwt"
$jwt = [string]$env:ROOTRECORD_LICENSE_JWT_SECRET
if (-not $jwt -or $jwt.Length -lt 16) {
    if (Test-Path -LiteralPath $jwtFile) {
        $jwt = (Get-Content -LiteralPath $jwtFile -Raw).Trim()
    }
}
if (-not $jwt -or $jwt.Length -lt 16) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "").Replace("/", "")
    Set-Content -LiteralPath $jwtFile -Value $jwt -NoNewline
    Write-Host "Generated signing secret in .deploy-jwt (gitignored). Optional: set ROOTRECORD_LICENSE_JWT_SECRET in credentials.env to the same value."
}

npx wrangler d1 migrations apply root-record --remote
$jwt | npx wrangler secret put JWT_SECRET

$stripeSecret = [string]$env:STRIPE_SECRET_KEY
if ($stripeSecret -match '^sk_(live|test)_' -and $stripeSecret.Length -gt 30) {
  $stripeSecret | npx wrangler secret put STRIPE_SECRET_KEY
  Write-Host "Uploaded STRIPE_SECRET_KEY to rootrecord-license (webhook subscription/invoice handlers)."
}

$stripeWh = [string]$env:STRIPE_WEBHOOK_SECRET
if ($stripeWh -match '^whsec_' -and $stripeWh.Length -gt 20) {
  $stripeWh | npx wrangler secret put STRIPE_WEBHOOK_SECRET
  Write-Host "Uploaded STRIPE_WEBHOOK_SECRET. Stripe webhook: https://rootrecord-license.rootrecord.workers.dev/v1/billing/webhook"
}

npx wrangler deploy
Write-Host "Done. rootrecord-license: https://rootrecord-license.rootrecord.workers.dev"
