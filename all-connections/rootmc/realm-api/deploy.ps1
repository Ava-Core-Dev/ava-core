# RETIRED on RootRecord Cloudflare — production deploy is Web Files/rootmc-api/deploy.ps1 (api.rootmc.net).
param([switch]$AllowLegacyRootRecordDeploy)
if (-not $AllowLegacyRootRecordDeploy) {
    throw "rootmc-realm-api deploy.ps1 is retired on RootRecord. Use: powershell -File `"D:\RootMC Workspace\Web Files\rootmc-api\deploy.ps1`""
}

# Load credentials.env, apply D1 migrations (account shard), upload secrets, deploy Worker.
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

$accountD1 = Join-Path (Split-Path $PSScriptRoot -Parent) "rootrecord-api-account\d1-apply-remote.ps1"
if (Test-Path -LiteralPath $accountD1) {
    Write-Host "Applying D1 migrations (0073 rootmc AI, 0074 realm social)..."
    & $accountD1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-Location $PSScriptRoot
} else {
    Write-Host "WARN: d1-apply-remote.ps1 not found; run migrations manually before deploy."
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

$rootmcBot = [string]$env:DISCORD_ROOTMC_BOT_TOKEN
if (-not $rootmcBot) { $rootmcBot = [string]$env:DISCORD_BOT_TOKEN }
$rootmcBot = $rootmcBot.Trim()
if ($rootmcBot -match '^(?i)bot\s+') {
    $rootmcBot = ($rootmcBot -replace '^(?i)bot\s+', '').Trim()
}
if ($rootmcBot.Length -ge 45 -and $rootmcBot.Contains(".")) {
    $rootmcBot | npx wrangler secret put DISCORD_ROOTMC_BOT_TOKEN
    Write-Host "Uploaded DISCORD_ROOTMC_BOT_TOKEN."
    try {
        $headers = @{ Authorization = "Bot $rootmcBot"; "User-Agent" = "RootMCDeploy/1.0" }
        $app = Invoke-RestMethod -Uri "https://discord.com/api/v10/applications/@me" -Headers $headers
        $publicFlag = 256
        if (-not ([int64]$app.flags -band $publicFlag)) {
            $newFlags = [int64]$app.flags -bor $publicFlag
            Invoke-RestMethod -Method Patch -Uri "https://discord.com/api/v10/applications/@me" -Headers $headers -ContentType "application/json" -Body (@{ flags = $newFlags } | ConvertTo-Json -Compress) | Out-Null
            Write-Host "Enabled PUBLIC_OAUTH2_CLIENT on RootMC Discord app."
        }
    } catch {
        Write-Warning "Could not verify PUBLIC_OAUTH2_CLIENT on RootMC Discord app: $_"
    }
}

$mainBot = [string]$env:DISCORD_BOT_TOKEN
$mainBot = $mainBot.Trim()
if ($mainBot -match '^(?i)bot\s+') {
    $mainBot = ($mainBot -replace '^(?i)bot\s+', '').Trim()
}
if ($mainBot.Length -ge 45 -and $mainBot.Contains(".")) {
    $mainBot | npx wrangler secret put DISCORD_BOT_TOKEN
    Write-Host "Uploaded DISCORD_BOT_TOKEN (business Discord AI raw archive channel)."
}

$rootmcClientSecret = [string]$env:DISCORD_ROOTMC_CLIENT_SECRET
if ($rootmcClientSecret.Trim().Length -ge 16) {
    $rootmcClientId = "1511794429986345020"
    $secretOk = $false
    try {
        $testBody = "grant_type=client_credentials&scope=identify&client_id=$rootmcClientId&client_secret=$($rootmcClientSecret.Trim())"
        Invoke-RestMethod -Method Post -Uri "https://discord.com/api/oauth2/token" -ContentType "application/x-www-form-urlencoded" -Body $testBody | Out-Null
        $secretOk = $true
    } catch {
        Write-Warning "DISCORD_ROOTMC_CLIENT_SECRET is invalid for RootMC app $($rootmcClientId); skipping upload (OAuth uses PKCE)."
    }
    if ($secretOk) {
        $rootmcClientSecret.Trim() | npx wrangler secret put DISCORD_ROOTMC_CLIENT_SECRET
        Write-Host "Uploaded DISCORD_ROOTMC_CLIENT_SECRET."
    }
}

$rootmcWebhook = [string]$env:DISCORD_ROOTMC_WEBHOOK_URL
if (-not $rootmcWebhook) { $rootmcWebhook = [string]$env:DISCORD_FEEDBACK_WEBHOOK_URL }
if (-not $rootmcWebhook) { $rootmcWebhook = [string]$env:DISCORD_GROK_WEBHOOK_URL }
if ($rootmcWebhook -match '^https://discord(app)?\.com/api/webhooks/' -and $rootmcWebhook.Length -gt 60) {
    $rootmcWebhook | npx wrangler secret put DISCORD_ROOTMC_WEBHOOK_URL
    Write-Host "Uploaded DISCORD_ROOTMC_WEBHOOK_URL."
}

$grokChat = [string]$env:GROK_API_BEARER_TOKEN
if (-not $grokChat) { $grokChat = [string]$env:GROK_API_KEY }
foreach ($aliasName in @("XAI_API_KEY", "X_AI_API_KEY")) {
    if ($grokChat.Trim().Length -ge 12) { break }
    $aliasValue = [string](Get-Item -Path "Env:$aliasName" -ErrorAction SilentlyContinue).Value
    if ($aliasValue.Trim().Length -ge 12) {
        $grokChat = $aliasValue
        Write-Host "Using $aliasName for Grok chat bearer upload."
        break
    }
}
if ($grokChat.Trim().Length -ge 12 -and $grokChat.Trim().StartsWith("xai-")) {
    $grokChat.Trim() | npx wrangler secret put GROK_API_BEARER_TOKEN
    Write-Host "Uploaded GROK_API_BEARER_TOKEN (console.x.ai chat - not GROK_X_* social keys)."
} else {
    Write-Warning "No valid Grok chat key (xai-...) in credentials.env for rootmc-api."
    npx wrangler secret delete GROK_API_BEARER_TOKEN 2>$null
    Write-Host "Removed stale GROK_API_BEARER_TOKEN from rootmc-api (must not reuse GROK_X_BEARER_TOKEN)."
}

$grokRootAsk = [string]$env:GROK_ROOT_ASK_BEARER_TOKEN
if ($grokRootAsk.Trim().Length -ge 12 -and $grokRootAsk.Trim().StartsWith("xai-")) {
    $grokRootAsk.Trim() | npx wrangler secret put GROK_ROOT_ASK_BEARER_TOKEN
    Write-Host "Uploaded GROK_ROOT_ASK_BEARER_TOKEN (in-game /ask — xAI key root-ask)."
} else {
    Write-Warning "No GROK_ROOT_ASK_BEARER_TOKEN in credentials.env — /ask will fall back to GROK_API_BEARER_TOKEN."
}

# App session Discord posts use DISCORD_ROOTMC_BOT_TOKEN + DISCORD_APP_SESSION_CHANNEL_ID in wrangler.toml (no extra webhook secret).

npx wrangler deploy

Write-Host "Registering RootMC Discord slash commands (guild, instant visibility)..."
node scripts/discord-register-rootmc-commands.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "RootMC Discord commands registered."
