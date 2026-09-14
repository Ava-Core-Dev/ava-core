# Create rootmc-bluemap R2 bucket on RootMC Cloudflare account (idempotent).
$ErrorActionPreference = "Stop"
$envFile = "C:\Users\store\Desktop\Projects\RootMC Workspace\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.+)$') { Set-Item -Path "Env:$($matches[1].Trim())" -Value $matches[2].Trim() }
    }
}
Remove-Item Env:CLOUDFLARE_API_KEY, Env:CLOUDFLARE_EMAIL -ErrorAction SilentlyContinue
Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) { npm ci 2>&1 | Out-Null }
$out = npx wrangler r2 bucket create rootmc-bluemap -c wrangler.rootmc.toml 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -and $out -notmatch "already exists|AlreadyExists|409") {
    Write-Error $out
}
Write-Host "R2 bucket rootmc-bluemap ready (RootMC account)."
