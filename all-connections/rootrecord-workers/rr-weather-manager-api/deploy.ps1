# Deploy rr-weather-manager-api Worker (USER_DATA_DB D1 + push-token endpoint).
# Same credentials.env-walking pattern as rootrecord-license/deploy.ps1 so this Worker uses
# CLOUDFLARE_API_TOKEN (or CLOUDFLARE_GLOBAL_API_KEY + CLOUDFLARE_EMAIL) instead of falling
# back to an OAuth browser flow when called from cloudflare-update-workers.bat.
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
if (-not (Test-Path "node_modules")) { npm install }

# D1 migrations for USER_DATA_DB (separate D1 binding from the main `root-record` DB).
npx wrangler d1 migrations apply USER_DATA_DB --remote

# Optional FCM / push admin secrets — uploaded only when present in credentials.env.
$adminSecret = [string]$env:RR_PUSH_ADMIN_SECRET
if ($adminSecret -and $adminSecret.Length -ge 16) {
    $adminSecret | npx wrangler secret put RR_PUSH_ADMIN_SECRET
    Write-Host "Uploaded RR_PUSH_ADMIN_SECRET to rr-weather-manager-api."
}
$fcmProject = [string]$env:FCM_PROJECT_ID
if ($fcmProject -and $fcmProject.Length -gt 3) {
    $fcmProject | npx wrangler secret put FCM_PROJECT_ID
    Write-Host "Uploaded FCM_PROJECT_ID to rr-weather-manager-api."
}
$fcmEmail = [string]$env:FCM_CLIENT_EMAIL
if ($fcmEmail -match '@' -and $fcmEmail.Length -gt 8) {
    $fcmEmail | npx wrangler secret put FCM_CLIENT_EMAIL
    Write-Host "Uploaded FCM_CLIENT_EMAIL to rr-weather-manager-api."
}
$fcmKey = [string]$env:FCM_PRIVATE_KEY
if ($fcmKey -match 'BEGIN PRIVATE KEY' -and $fcmKey.Length -gt 200) {
    $fcmKey | npx wrangler secret put FCM_PRIVATE_KEY
    Write-Host "Uploaded FCM_PRIVATE_KEY to rr-weather-manager-api."
}

npx wrangler deploy
Write-Host "Done. rr-weather-manager-api: https://rr-weather-manager-api.rootrecord.workers.dev"
