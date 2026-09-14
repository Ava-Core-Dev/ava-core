# Deploy Webstat HTTPS proxy (claims.rootmc.net / towny.rootmc.net).
$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
    throw "Set CLOUDFLARE_ACCOUNT_ID in RootMC Workspace\.env"
}

Set-Location $PSScriptRoot
Write-Host "Deploying rootmc-webstat-proxy ..."
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done. Custom domains: https://claims.rootmc.net  https://towny.rootmc.net"
