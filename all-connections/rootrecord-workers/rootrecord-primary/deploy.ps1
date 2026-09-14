# Load credentials.env (walk up from this script until repo-root credentials.env is found), then optional Web/main/.env
# (main dev folder), then D1 migrate + deploy.
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$repoRoot = $null
$probe = $PSScriptRoot
for ($i = 0; $i -le 12; $i++) {
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
$mainDevEnv = Join-Path $repoRoot "Web\main\.env"
if (Test-Path -LiteralPath $mainDevEnv) {
    Get-Content $mainDevEnv | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $p = $line.IndexOf("=")
        if ($p -gt 0) {
            $k = $line.Substring(0, $p).Trim()
            $v = $line.Substring($p + 1).Trim()
            Set-Item -Path "Env:$k" -Value $v
        }
    }
}
# Wrangler global key auth uses CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL (see Cloudflare system env docs).
if ($env:CLOUDFLARE_GLOBAL_API_KEY -and -not $env:CLOUDFLARE_API_KEY) {
    Set-Item -Path "Env:CLOUDFLARE_API_KEY" -Value $env:CLOUDFLARE_GLOBAL_API_KEY
}
Set-Location $PSScriptRoot
$wranglerToml = Get-Content -LiteralPath (Join-Path $PSScriptRoot "wrangler.toml") -Raw
if ($wranglerToml -notmatch 'database_name\s*=\s*"root-record"') {
    throw "wrangler.toml must set database_name = `"root-record`" only."
}
$expectId = [string]$env:D1_DATABASE_ID
if ($expectId.Length -ge 32 -and $wranglerToml -notmatch [regex]::Escape($expectId)) {
    throw "wrangler.toml database_id must match D1_DATABASE_ID from credentials.env."
}
$hasToken = $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_API_TOKEN.Length -ge 10
$hasGlobal = $env:CLOUDFLARE_API_KEY -and $env:CLOUDFLARE_API_KEY.Length -ge 10 -and $env:CLOUDFLARE_EMAIL -and $env:CLOUDFLARE_EMAIL.Length -gt 3
if (-not $hasToken -and -not $hasGlobal) {
    Write-Host "Set either CLOUDFLARE_API_TOKEN, or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY (mapped to CLOUDFLARE_API_KEY for Wrangler)."
    exit 1
}

# Ensure deps are present for Wrangler bundling (nodejs_compat + Solana libs).
$needInstall = $false
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) { $needInstall = $true }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules\\jose\\package.json"))) { $needInstall = $true }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules\\@solana\\spl-token\\package.json"))) { $needInstall = $true }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules\\@noble\\hashes\\esm\\sha3.js.map"))) { $needInstall = $true }
if (-not $needInstall) {
    try {
        $map = Get-Item -LiteralPath (Join-Path $PSScriptRoot "node_modules\\@noble\\hashes\\esm\\sha3.js.map")
        if ($map.Length -lt 8) { $needInstall = $true }
    } catch {
        $needInstall = $true
    }
}
if ($needInstall) {
    npm install
}

$jwtFile = Join-Path $PSScriptRoot ".deploy-jwt"
$jwt = [string]$env:ROOTRECORD_PRIMARY_JWT_SECRET
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
    Write-Host "Generated JWT secret in .deploy-jwt (gitignored). Optional: ROOTRECORD_PRIMARY_JWT_SECRET in credentials.env."
}
$jwt | npx --yes wrangler@4.90.1 secret put JWT_SECRET

function Test-InternalWalletEncKeyB64([string]$b64) {
    if (-not $b64) { return $false }
    $s = $b64.Trim()
    if ($s.Length -lt 32) { return $false }
    try {
        $raw = [Convert]::FromBase64String($s)
        return $raw.Length -eq 32
    } catch {
        return $false
    }
}
$encKey = [string]$env:INTERNAL_WALLET_ENC_KEY_B64
$encFile = Join-Path $PSScriptRoot ".deploy-internal-wallet-key"
if (-not (Test-InternalWalletEncKeyB64 $encKey)) {
    if (Test-Path -LiteralPath $encFile) {
        $encKey = (Get-Content -LiteralPath $encFile -Raw).Trim()
    }
}
if (-not (Test-InternalWalletEncKeyB64 $encKey)) {
    $inCi = ($env:GITHUB_ACTIONS -eq "true") -or ($env:CI -eq "true")
    if ($inCi) {
        throw "INTERNAL_WALLET_ENC_KEY_B64 is missing or invalid (must be base64 of exactly 32 bytes). In CI, set it in secrets and export into env before deploy.ps1; do not auto-generate."
    }
    $kb = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($kb)
    $encKey = [Convert]::ToBase64String($kb)
    Set-Content -LiteralPath $encFile -Value $encKey -NoNewline
    Write-Host "Generated INTERNAL_WALLET_ENC_KEY_B64 in .deploy-internal-wallet-key (gitignored). Optional: INTERNAL_WALLET_ENC_KEY_B64 in credentials.env for other machines/CI."
}
$encKey | npx --yes wrangler@4.90.1 secret put INTERNAL_WALLET_ENC_KEY_B64
Write-Host "Uploaded INTERNAL_WALLET_ENC_KEY_B64 (custodial Solana wallet encryption)."

$pushAdmin = [string]$env:RR_PUSH_ADMIN_SECRET
if ($pushAdmin -and $pushAdmin.Length -ge 8) {
  $pushAdmin | npx --yes wrangler@4.90.1 secret put RR_PUSH_ADMIN_SECRET
}

$usageAdmin = [string]$env:RR_USAGE_ADMIN_SECRET
if ($usageAdmin -and $usageAdmin.Length -ge 8) {
  $usageAdmin | npx --yes wrangler@4.90.1 secret put RR_USAGE_ADMIN_SECRET
}

$fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_PATH
if (-not $fcmPath) { $fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_FILE }
if ($fcmPath -and (Test-Path -LiteralPath $fcmPath)) {
  (Get-Content -LiteralPath $fcmPath -Raw) | npx --yes wrangler@4.90.1 secret put FCM_SERVICE_ACCOUNT_JSON
}

$stripeSecret = [string]$env:STRIPE_SECRET_KEY
if ($stripeSecret -match '^sk_(live|test)_' -and $stripeSecret.Length -gt 30) {
  $stripeSecret | npx --yes wrangler@4.90.1 secret put STRIPE_SECRET_KEY
  Write-Host "Uploaded STRIPE_SECRET_KEY to Worker (from credentials.env)."
}

$accuApiKey = [string]$env:ACCUWEATHER_API_KEY
if ($accuApiKey -and $accuApiKey.Length -ge 16) {
  $accuApiKey | npx --yes wrangler@4.90.1 secret put ACCUWEATHER_API_KEY
  Write-Host "Uploaded ACCUWEATHER_API_KEY to Worker (from credentials.env)."
}

$discordFeedback = [string]$env:DISCORD_FEEDBACK_WEBHOOK_URL
if ($discordFeedback -match '^https://discord(app)?\.com/api/webhooks/' -and $discordFeedback.Length -gt 60) {
  $discordFeedback | npx --yes wrangler@4.90.1 secret put DISCORD_FEEDBACK_WEBHOOK_URL
  Write-Host "Uploaded DISCORD_FEEDBACK_WEBHOOK_URL (from credentials.env)."
}

$appSessionWebhook = [string]$env:DISCORD_APP_SESSION_WEBHOOK_URL
if ($appSessionWebhook -match '^https://discord(app)?\.com/api/webhooks/' -and $appSessionWebhook.Length -gt 60) {
  $appSessionWebhook | npx --yes wrangler@4.90.1 secret put DISCORD_APP_SESSION_WEBHOOK_URL
  Write-Host "Uploaded DISCORD_APP_SESSION_WEBHOOK_URL (app session starts → Discord)."
}

npx --yes wrangler@4.90.1 d1 migrations apply root-record --remote
npx --yes wrangler@4.90.1 deploy
