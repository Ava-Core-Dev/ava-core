# Attach rootmc.net: Cloudflare Dashboard > Pages > rootmc-web > Custom domains
# Also attach developer.rootmc.net to the same project (developer portal at /developer/).
# Preview: https://rootmc-web.pages.dev
# Deploy: powershell -File deploy.ps1
# After deploy: open https://rootmc.net/developer/register/ (or https://developer.rootmc.net/developer/register/)
# API routes: POST /api/developer/auth/discord/start, GET /api/developer/me (via api.rootmc.net)
$ErrorActionPreference = "Stop"
# npx may write npm notices to stderr; do not treat them as terminating errors.
$PrevNativeErr = $ErrorActionPreference

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

if (-not $env:CLOUDFLARE_API_TOKEN -or $env:CLOUDFLARE_API_TOKEN.Length -lt 20) {
    throw "Set CLOUDFLARE_API_TOKEN in RootMC Workspace\.env"
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
    throw "Set CLOUDFLARE_ACCOUNT_ID in RootMC Workspace\.env"
}

Set-Location $PSScriptRoot
node scripts/build.mjs

$project = "rootmc-web"
Write-Host "Deploying Pages project $project to RootMC account ..."

$ErrorActionPreference = "Continue"
$projList = (npx wrangler pages project list 2>&1) | Out-String
$ErrorActionPreference = $PrevNativeErr
if ($projList -notmatch $project) {
    Write-Host "Creating Pages project $project ..."
    npx wrangler pages project create $project --production-branch main 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$ErrorActionPreference = "Continue"
npx wrangler pages deploy build `
    --project-name $project `
    --branch main `
    --commit-dirty=true 2>&1 | Out-Host
$ErrorActionPreference = $PrevNativeErr
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Attach custom domains in Cloudflare Dashboard: Pages > rootmc-web > Custom domains:"
Write-Host "  - rootmc.net"
Write-Host "  - developer.rootmc.net  (developer portal; paths under /developer/)"
Write-Host "  - slack.rootmc.net  (302 -> rootmcworkspace.slack.com; or run scripts/setup-slack-subdomain.ps1)"
Write-Host "Developer register: https://rootmc.net/developer/register/ (or developer.rootmc.net/developer/register/)"
Write-Host "Deploy API separately: Web Files/rootmc-api/deploy.ps1 (required for Discord OAuth)."
