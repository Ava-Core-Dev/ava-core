# Deploy rootmc-minecraft-map (map.rootmc.net BlueMap front door).
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
    throw "Set CLOUDFLARE_ACCOUNT_ID in RootMC Workspace\.env"
}

Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules\wrangler")) {
    Write-Host "npm install ..."
    npm install
}
Write-Host "Deploying rootmc-minecraft-map ..."
npx wrangler deploy
Write-Host "Done. https://map.rootmc.net/"
