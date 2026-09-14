# Apply rootmc-live D1 schema (remote). Never touches D1 rootmc.

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

$manifest = Join-Path $PSScriptRoot "migrations-live\MANIFEST.txt"
$migrationsDir = Join-Path $PSScriptRoot "migrations-live"
if (-not (Test-Path $manifest)) { throw "Missing $manifest" }

$appliedFile = Join-Path $PSScriptRoot "migrations-live\.d1-applied-remote.txt"
$applied = @{}
if (Test-Path $appliedFile) {
    Get-Content $appliedFile | ForEach-Object { if ($_.Trim()) { $applied[$_.Trim()] = $true } }
}

foreach ($line in Get-Content $manifest) {
    $file = $line.Trim()
    if (-not $file -or $file.StartsWith("#")) { continue }
    if ($applied.ContainsKey($file)) {
        Write-Host "Skip (already applied): $file"
        continue
    }
    $path = Join-Path $migrationsDir $file
    if (-not (Test-Path $path)) { throw "Migration not found: $path" }
    Write-Host "Applying $file to rootmc-live ..."
    npx wrangler d1 execute rootmc-live --remote --file="$path"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Add-Content -LiteralPath $appliedFile -Value $file
}

Write-Host "rootmc-live D1 migrations complete."
exit 0
