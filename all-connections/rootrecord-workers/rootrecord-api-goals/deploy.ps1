# Load credentials.env, upload JWT + Grok secret, apply D1 migrations, deploy Worker.
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

$shardLeaf = Split-Path $PSScriptRoot -Leaf

if ($shardLeaf -eq "rootrecord-api-goals") {
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
    if ($grokChat.Trim().Length -ge 12) {
        $grokChat.Trim() | npx wrangler secret put GROK_API_BEARER_TOKEN
        Write-Host "Uploaded GROK_API_BEARER_TOKEN to $shardLeaf (Grok chat completions)."
    } else {
        Write-Warning "No Grok chat key for goal plans. Add GROK_API_BEARER_TOKEN (console.x.ai) to credentials.env. GROK_X_* is for X/social only, not api.x.ai chat."
        npx wrangler secret delete GROK_API_BEARER_TOKEN 2>$null
        Write-Host "Removed stale GROK_API_BEARER_TOKEN from worker (was not a valid Grok chat key)."
    }

    foreach ($grokSecretName in @(
        "GROK_X_BEARER_TOKEN",
        "GROK_X_V1_CONSUMER_KEY",
        "GROK_X_V1_CONSUMER_KEY_SECRET",
        "GROK_X_V2_CLIENT_ID",
        "GROK_X_V2_CLIENT_SECRET"
    )) {
        $grokSecretValue = [string](Get-Item -Path "Env:$grokSecretName" -ErrorAction SilentlyContinue).Value
        if ($grokSecretValue.Trim().Length -ge 12) {
            $grokSecretValue.Trim() | npx wrangler secret put $grokSecretName
            Write-Host "Uploaded $grokSecretName to $shardLeaf (same Grok values as Kilauea Worker)."
        }
    }
}

$rootmcBot = [string]$env:DISCORD_ROOTMC_BOT_TOKEN
if (-not $rootmcBot) { $rootmcBot = [string]$env:DISCORD_BOT_TOKEN }
$rootmcBot = $rootmcBot.Trim()
if ($rootmcBot -match '^(?i)bot\s+') {
    $rootmcBot = ($rootmcBot -replace '^(?i)bot\s+', '').Trim()
}
if ($rootmcBot.Length -ge 45 -and $rootmcBot.Contains(".")) {
    $rootmcBot | npx wrangler secret put DISCORD_ROOTMC_BOT_TOKEN
    Write-Host "Uploaded DISCORD_ROOTMC_BOT_TOKEN (Goals Discord: app session and AI posts)."
}

# App session Discord posts use DISCORD_ROOTMC_BOT_TOKEN + DISCORD_APP_SESSION_CHANNEL_ID in wrangler.toml (same as BlockNotes).

npx wrangler d1 migrations apply root-record --remote
npx wrangler deploy
