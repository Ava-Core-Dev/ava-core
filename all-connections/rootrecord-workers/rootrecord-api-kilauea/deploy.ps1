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

$primaryDir = Join-Path (Split-Path $PSScriptRoot -Parent) "rootrecord-primary"
$jwtFile = Join-Path $primaryDir ".deploy-jwt"
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
$jwt | npx wrangler secret put JWT_SECRET

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
$encFile = Join-Path $primaryDir ".deploy-internal-wallet-key"
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
$encKey | npx wrangler secret put INTERNAL_WALLET_ENC_KEY_B64
Write-Host "Uploaded INTERNAL_WALLET_ENC_KEY_B64 (custodial Solana wallet encryption)."

$pushAdmin = [string]$env:RR_PUSH_ADMIN_SECRET
if ($pushAdmin -and $pushAdmin.Length -ge 8) {
  $pushAdmin | npx wrangler secret put RR_PUSH_ADMIN_SECRET
}

# RR_USAGE_ADMIN_SECRET upload removed: only consumer was `/internal/usage/accuweather`,
# which was deleted from every shard. Re-add here if a new admin route revives it.

$fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_PATH
if (-not $fcmPath) { $fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_FILE }
if ($fcmPath -and (Test-Path -LiteralPath $fcmPath)) {
  (Get-Content -LiteralPath $fcmPath -Raw) | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
}

$stripeSecret = [string]$env:STRIPE_SECRET_KEY
if ($stripeSecret -match '^sk_(live|test)_' -and $stripeSecret.Length -gt 30) {
  $stripeSecret | npx wrangler secret put STRIPE_SECRET_KEY
  Write-Host "Uploaded STRIPE_SECRET_KEY to Worker (from credentials.env)."
}

$treasurySk = [string]$env:RRTT_TREASURY_SECRET_KEY_B58
if ($treasurySk.Length -ge 64) {
  $treasurySk | npx wrangler secret put RRTT_TREASURY_SECRET_KEY_B58
  Write-Host "Uploaded RRTT_TREASURY_SECRET_KEY_B58 (Roots treasury signer)."
}

# AccuWeather secret only goes to weather + kilauea shards. Token/business/account/primary do not
# carry weather code anymore (see router.ts: "Weather/forecast/natural-disaster modules removed").
$shardLeaf = Split-Path $PSScriptRoot -Leaf
$accuApiKey = [string]$env:ACCUWEATHER_API_KEY
if (($shardLeaf -eq 'rootrecord-api-weather' -or $shardLeaf -eq 'rootrecord-api-kilauea') -and $accuApiKey -and $accuApiKey.Length -ge 16) {
  $accuApiKey | npx wrangler secret put ACCUWEATHER_API_KEY
  Write-Host "Uploaded ACCUWEATHER_API_KEY to $shardLeaf (from credentials.env)."
}

# USGS earthquakes → Discord #kilauea-alerts webhook. Consumed by `runUsgsKilaueaDiscordCron`
# in api-kilauea on the */10 cron; pointless on other shards.
$kilaueaUsgsWebhook = [string]$env:DISCORD_KILAUEA_USGS_WEBHOOK_URL
if ($shardLeaf -eq 'rootrecord-api-kilauea' -and $kilaueaUsgsWebhook -match '^https://discord(?:app)?\.com/api/webhooks/' -and $kilaueaUsgsWebhook.Length -gt 60) {
  $kilaueaUsgsWebhook | npx wrangler secret put DISCORD_KILAUEA_USGS_WEBHOOK_URL
  Write-Host "Uploaded DISCORD_KILAUEA_USGS_WEBHOOK_URL to $shardLeaf (from credentials.env)."
}

foreach ($grokSecretName in @(
  "GROK_X_BEARER_TOKEN",
  "GROK_X_V1_CONSUMER_KEY",
  "GROK_X_V1_CONSUMER_KEY_SECRET",
  "GROK_X_V2_CLIENT_ID",
  "GROK_X_V2_CLIENT_SECRET",
  "GROK_API_BEARER_TOKEN"
)) {
  $grokSecretValue = [string](Get-Item -Path "Env:$grokSecretName" -ErrorAction SilentlyContinue).Value
  if ($shardLeaf -eq 'rootrecord-api-kilauea' -and $grokSecretValue.Trim().Length -ge 12) {
    $grokSecretValue.Trim() | npx wrangler secret put $grokSecretName
    Write-Host "Uploaded $grokSecretName to $shardLeaf (same Grok values as account Worker)."
  }
}

$grokChatAliases = @("XAI_API_KEY", "X_AI_API_KEY", "GROK_API_KEY")
foreach ($aliasName in $grokChatAliases) {
  $aliasValue = [string](Get-Item -Path "Env:$aliasName" -ErrorAction SilentlyContinue).Value
  if ($shardLeaf -eq 'rootrecord-api-kilauea' -and $aliasValue.Trim().Length -ge 12) {
    $aliasValue.Trim() | npx wrangler secret put GROK_API_BEARER_TOKEN
    Write-Host "Uploaded GROK_API_BEARER_TOKEN to $shardLeaf from $aliasName."
    break
  }
}

$discordKilaueaBot = [string]$env:DISCORD_KILAUEA_BOT_TOKEN
$discordKilaueaBot = $discordKilaueaBot.Trim()
if ($discordKilaueaBot -match '^(?i)bot\s+') {
  $discordKilaueaBot = ($discordKilaueaBot -replace '^(?i)bot\s+', '').Trim()
}
if ($shardLeaf -eq 'rootrecord-api-kilauea' -and $discordKilaueaBot.Length -ge 45 -and $discordKilaueaBot.Contains(".")) {
  $discordKilaueaBot | npx wrangler secret put DISCORD_KILAUEA_BOT_TOKEN
  Write-Host "Uploaded DISCORD_KILAUEA_BOT_TOKEN to $shardLeaf."
}

$discordBot = [string]$env:DISCORD_BOT_TOKEN
$discordBot = $discordBot.Trim()
if ($discordBot -match '^(?i)bot\s+') {
  $discordBot = ($discordBot -replace '^(?i)bot\s+', '').Trim()
}
if ($shardLeaf -eq 'rootrecord-api-kilauea' -and $discordBot.Length -ge 45 -and $discordBot.Contains(".")) {
  $discordBot | npx wrangler secret put DISCORD_BOT_TOKEN
  Write-Host "Uploaded DISCORD_BOT_TOKEN to $shardLeaf (Kilauea AI raw archive channel)."
}

$discordFeedback = [string]$env:DISCORD_FEEDBACK_WEBHOOK_URL
if ($discordFeedback -match '^https://discord(app)?\.com/api/webhooks/' -and $discordFeedback.Length -gt 60) {
  $discordFeedback | npx wrangler secret put DISCORD_FEEDBACK_WEBHOOK_URL
  Write-Host "Uploaded DISCORD_FEEDBACK_WEBHOOK_URL (from credentials.env)."
}

$appSessionWebhook = [string]$env:DISCORD_APP_SESSION_WEBHOOK_URL
if ($appSessionWebhook -match '^https://discord(app)?\.com/api/webhooks/' -and $appSessionWebhook.Length -gt 60) {
  $appSessionWebhook | npx wrangler secret put DISCORD_APP_SESSION_WEBHOOK_URL
  Write-Host "Uploaded DISCORD_APP_SESSION_WEBHOOK_URL (app session starts → Discord)."
}

npx wrangler d1 migrations apply root-record --remote
npx wrangler deploy
