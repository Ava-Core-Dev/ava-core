# Deploy rootmc-api to the RootMC Cloudflare account (api.rootmc.net).
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

$mainDevEnv = Join-Path (Split-Path $workspaceRoot -Parent) "Web\cloudflare\main\.env"
if (-not (Test-Path $mainDevEnv)) {
    $mainDevEnv = "D:\Web\cloudflare\main\.env"
}
if (Test-Path $mainDevEnv) { Import-DotEnvFile $mainDevEnv -SkipCloudflareKeys }

if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
    throw "Set CLOUDFLARE_ACCOUNT_ID in RootMC Workspace\.env"
}

Set-Location $PSScriptRoot
$tomlPath = Join-Path $PSScriptRoot "wrangler.toml"
$toml = Get-Content -LiteralPath $tomlPath -Raw

if ($toml -match 'database_id = "REPLACE_AFTER_D1_CREATE"') {
    Write-Host "Creating D1 database rootmc ..."
    $createOut = npx wrangler d1 create rootmc 2>&1 | Out-String
    if ($createOut -match 'database_id\s*=\s*"([a-f0-9-]+)"') {
        $newId = $Matches[1]
        $toml = $toml -replace 'database_id = "REPLACE_AFTER_D1_CREATE"', "database_id = `"$newId`""
        Set-Content -LiteralPath $tomlPath -Value $toml -NoNewline
        Write-Host "Updated wrangler.toml database_id=$newId"
    } elseif ($createOut -match "already exists") {
        $listJson = npx wrangler d1 list --json 2>&1 | Out-String
        if ($listJson -match '"name":"rootmc"[^}]*"uuid":"([a-f0-9-]+)"') {
            $newId = $Matches[1]
            $toml = $toml -replace 'database_id = "REPLACE_AFTER_D1_CREATE"', "database_id = `"$newId`""
            Set-Content -LiteralPath $tomlPath -Value $toml -NoNewline
            Write-Host "Using existing D1 rootmc id=$newId"
        } else {
            throw "D1 rootmc exists but could not parse id. Set database_id in wrangler.toml manually.`n$createOut"
        }
    } else {
        throw "D1 create failed:`n$createOut"
    }
}

if (-not (Test-Path "node_modules")) { npm install }

Write-Host "Applying D1 migrations (remote) ..."
& "$PSScriptRoot\d1-apply-remote.ps1"
$d1Exit = $LASTEXITCODE
if ($null -ne $d1Exit -and $d1Exit -ne 0) { exit $d1Exit }

Write-Host "Applying webstat D1 migrations (remote) ..."
& "$PSScriptRoot\d1-apply-webstat-remote.ps1"
$wsExit = $LASTEXITCODE
if ($null -ne $wsExit -and $wsExit -ne 0) { exit $wsExit }

Write-Host "Applying live D1 migrations (remote) ..."
& "$PSScriptRoot\d1-apply-live-remote.ps1"
$liveExit = $LASTEXITCODE
if ($null -ne $liveExit -and $liveExit -ne 0) { exit $liveExit }

$jwt = [string]$env:ROOTMC_JWT_SECRET
if (-not $jwt -or $jwt.Length -lt 16) { $jwt = [string]$env:ROOTRECORD_PRIMARY_JWT_SECRET }
if (-not $jwt -or $jwt.Length -lt 16) {
    $jwtFile = Join-Path $PSScriptRoot ".rootmc-deploy-jwt"
    if (Test-Path $jwtFile) { $jwt = (Get-Content $jwtFile -Raw).Trim() }
}
if (-not $jwt -or $jwt.Length -lt 16) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "").Replace("/", "")
    Set-Content -LiteralPath (Join-Path $PSScriptRoot ".rootmc-deploy-jwt") -Value $jwt -NoNewline
}
$jwt | npx wrangler secret put JWT_SECRET

$stripeSecret = [string]$env:STRIPE_SECRET_KEY
if ($stripeSecret.Trim().StartsWith("sk_") -and $stripeSecret.Trim().Length -ge 20) {
    $stripeSecret.Trim() | npx wrangler secret put STRIPE_SECRET_KEY
    Write-Host "Uploaded STRIPE_SECRET_KEY."
} else {
    Write-Warning "No STRIPE_SECRET_KEY in RootMC Workspace\.env - Stripe webhooks / billing disabled."
}

$stripeWhsec = [string]$env:STRIPE_WEBHOOK_SECRET_ROOTMC
if ($stripeWhsec.Trim().StartsWith("whsec_") -and $stripeWhsec.Trim().Length -ge 20) {
    # Shared .env: RootRecord keeps STRIPE_WEBHOOK_SECRET; RootMC uses STRIPE_WEBHOOK_SECRET_ROOTMC only.
    # Worker binding name stays STRIPE_WEBHOOK_SECRET for the shared handler.
    $stripeWhsec.Trim() | npx wrangler secret put STRIPE_WEBHOOK_SECRET
    Write-Host "Uploaded STRIPE_WEBHOOK_SECRET (from STRIPE_WEBHOOK_SECRET_ROOTMC)."
} else {
    Write-Warning "No STRIPE_WEBHOOK_SECRET_ROOTMC in shared .env - create RootMC Stripe webhook endpoint then set whsec_... (do not reuse STRIPE_WEBHOOK_SECRET)."
}

foreach ($priceKey in @("STRIPE_ROOTMC_PRICE_MONTHLY", "STRIPE_ROOTMC_PRICE_ONE_MONTH", "STRIPE_ROOTMC_PRICE_LIFETIME")) {
    $priceVal = [string][Environment]::GetEnvironmentVariable($priceKey, "Process")
    if ($priceVal -and $priceVal.Trim().StartsWith("price_") -and $priceVal.Trim().Length -ge 10) {
        # Price ids live in wrangler [vars]; skip secret put when already bound as vars.
        Write-Host "Using $priceKey from wrangler [vars] / .env (not uploaded as secret)."
    } else {
        Write-Warning "No $priceKey in .env (price_...) - one-time vs sub branching needs Dashboard price ids."
    }
}

$rootmcBot = [string]$env:DISCORD_ROOTMC_BOT_TOKEN
if (-not $rootmcBot) { $rootmcBot = [string]$env:DISCORD_BOT_TOKEN }
$rootmcBot = $rootmcBot.Trim()
if ($rootmcBot -match '^(?i)bot\s+') { $rootmcBot = ($rootmcBot -replace '^(?i)bot\s+', '').Trim() }
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

$avaBot = [string]$env:AVA_DISCORD_BOT_TOKEN
if (-not $avaBot) { $avaBot = [string]$env:SEXI_DISCORD_BOT_TOKEN }
$avaBot = $avaBot.Trim()
if ($avaBot -match '^(?i)bot\s+') { $avaBot = ($avaBot -replace '^(?i)bot\s+', '').Trim() }
if ($avaBot.Length -ge 45 -and $avaBot.Contains(".")) {
    $avaBot | npx wrangler secret put AVA_DISCORD_BOT_TOKEN
    Write-Host "Uploaded AVA_DISCORD_BOT_TOKEN (vote-start reactions)."
}

$mainBot = [string]$env:DISCORD_BOT_TOKEN
$mainBot = $mainBot.Trim()
if ($mainBot -match '^(?i)bot\s+') { $mainBot = ($mainBot -replace '^(?i)bot\s+', '').Trim() }
if ($mainBot.Length -ge 45 -and $mainBot.Contains(".")) {
    $mainBot | npx wrangler secret put DISCORD_BOT_TOKEN
    Write-Host "Uploaded DISCORD_BOT_TOKEN (AI raw archive on business Discord)."
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

$slackFeedbackWebhook = [string]$env:SLACK_FEEDBACK_WEBHOOK_URL
if ($slackFeedbackWebhook -match '^https://hooks\.slack\.com/services/' -and $slackFeedbackWebhook.Length -gt 60) {
    $slackFeedbackWebhook | npx wrangler secret put SLACK_FEEDBACK_WEBHOOK_URL
    Write-Host "Uploaded SLACK_FEEDBACK_WEBHOOK_URL (#feedback Incoming Webhook)."
} else {
    Write-Warning "No SLACK_FEEDBACK_WEBHOOK_URL in .env — in-game /feedback will 503 until set (Slack #feedback)."
}

$slackServerReportsWebhook = [string]$env:SLACK_SERVER_REPORTS_WEBHOOK_URL
if ($slackServerReportsWebhook -match '^https://hooks\.slack\.com/services/' -and $slackServerReportsWebhook.Length -gt 60) {
    $slackServerReportsWebhook | npx wrangler secret put SLACK_SERVER_REPORTS_WEBHOOK_URL
    Write-Host "Uploaded SLACK_SERVER_REPORTS_WEBHOOK_URL (#server-reports Incoming Webhook)."
} else {
    Write-Warning "No SLACK_SERVER_REPORTS_WEBHOOK_URL in .env — Discord report Slack copies skipped until set (#server-reports)."
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
    Write-Host "Uploaded GROK_API_BEARER_TOKEN (console.x.ai chat, not GROK_X_* social keys)."
} else {
    Write-Warning "No valid Grok chat key (xai-...) in RootMC Workspace\.env or MonoRepo\credentials.env."
}

$grokRootAsk = [string]$env:GROK_ROOT_ASK_BEARER_TOKEN
if ($grokRootAsk.Trim().Length -ge 12 -and $grokRootAsk.Trim().StartsWith("xai-")) {
    $grokRootAsk.Trim() | npx wrangler secret put GROK_ROOT_ASK_BEARER_TOKEN
    Write-Host "Uploaded GROK_ROOT_ASK_BEARER_TOKEN (in-game /ask - xAI key root-ask)."
} else {
    Write-Warning "No GROK_ROOT_ASK_BEARER_TOKEN in credentials.env - /ask will fall back to GROK_API_BEARER_TOKEN."
}

$fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_PATH
if (-not $fcmPath) { $fcmPath = [string]$env:FCM_SERVICE_ACCOUNT_JSON_FILE }
if ($fcmPath -and (Test-Path -LiteralPath $fcmPath)) {
    (Get-Content -LiteralPath $fcmPath -Raw) | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
    Write-Host "Uploaded FCM_SERVICE_ACCOUNT_JSON (shop alert push)."
} else {
    Write-Warning "No FCM_SERVICE_ACCOUNT_JSON_PATH - shop alert push disabled until set."
}

$devWorkstationKey = [string]$env:ROOTMC_DEV_WORKSTATION_KEY
if ($devWorkstationKey.Trim().Length -ge 16) {
    $devWorkstationKey.Trim() | npx wrangler secret put ROOTMC_DEV_WORKSTATION_KEY
    Write-Host "Uploaded ROOTMC_DEV_WORKSTATION_KEY (dev workstation heartbeat)."
} else {
    Write-Warning "No ROOTMC_DEV_WORKSTATION_KEY in RootMC Workspace\.env - dev workstation cron line stays Offline."
}

$edgeSign = [string]$env:ROOTMC_EDGE_SIGNING_KEY
if ($edgeSign.Trim().Length -ge 16) {
    $edgeSign.Trim() | npx wrangler secret put ROOTMC_EDGE_SIGNING_KEY
    Write-Host "Uploaded ROOTMC_EDGE_SIGNING_KEY (cache response HMAC)."
} else {
    Write-Host "No ROOTMC_EDGE_SIGNING_KEY - cache signature headers skipped."
}

$tunnelHealth = [string]$env:ROOTMC_TUNNEL_HEALTH_URL
if ($tunnelHealth.Trim().Length -gt 8) {
    $tunnelHealth.Trim() | npx wrangler secret put ROOTMC_TUNNEL_HEALTH_URL
    Write-Host "Uploaded ROOTMC_TUNNEL_HEALTH_URL (edge preference watchdog)."
} else {
    Write-Host "No ROOTMC_TUNNEL_HEALTH_URL - CF watchdog will not flip preference on tunnel failure."
}

& "$PSScriptRoot\scripts\seed-featured-server.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx wrangler deploy
Write-Host ""
Write-Host "RootMC API: https://api.rootmc.net/"

Write-Host "Syncing cron schedules (Cloudflare API) ..."
& "$PSScriptRoot\scripts\sync-cron-schedules.ps1"
if (-not $?) { exit 1 }

Write-Host "Registering RootMC Discord slash commands ..."
$registerScript = Join-Path (Split-Path $PSScriptRoot -Parent) "rootmc-realm-api\scripts\discord-register-rootmc-commands.mjs"
if (Test-Path $registerScript) {
    $env:ROOTMC_API_URL = "https://api.rootmc.net"
    node $registerScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Discord interactions: https://api.rootmc.net/v1/discord/rootmc/interactions"
