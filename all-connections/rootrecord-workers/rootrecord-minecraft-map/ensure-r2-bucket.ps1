# Create rootrecord-bluemap R2 bucket if missing (idempotent).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules")) { npm install }
$out = npx wrangler r2 bucket create rootrecord-bluemap 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -and $out -notmatch "already exists|AlreadyExists|409") {
    Write-Error $out
}
Write-Host "R2 bucket rootrecord-bluemap ready."
