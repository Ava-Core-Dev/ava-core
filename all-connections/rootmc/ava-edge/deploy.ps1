# Deploy always-on Ava edge (ava.rootmc.net → ava-origin + KV cache).
$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")
if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}
Set-Location $PSScriptRoot
Write-Host "Deploying rootmc-ava-edge ..."
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done. https://ava.rootmc.net (origin https://ava-origin.rootmc.net)"
