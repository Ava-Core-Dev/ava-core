# Apply D1 migrations to remote `root-record`. Loads env from repo-root `credentials.env` and `Web/main/.env` (main dev).
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Import-DotEnvFile {
    param([string]$LiteralPath)
    if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
    Get-Content -LiteralPath $LiteralPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $p = $line.IndexOf("=")
        if ($p -gt 0) {
            $k = $line.Substring(0, $p).Trim()
            $v = $line.Substring($p + 1).Trim()
            if ($k) { Set-Item -Path "Env:$k" -Value $v }
        }
    }
}

$repoRoot = $null
$probe = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
    $tryCred = Join-Path $probe "credentials.env"
    $tryMainDevEnv = Join-Path $probe "Web\main\.env"
    if (Test-Path -LiteralPath $tryCred) {
        $repoRoot = $probe
        break
    }
    if (Test-Path -LiteralPath $tryMainDevEnv) {
        $repoRoot = $probe
        break
    }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
}
if (-not $repoRoot) {
    throw "Could not find repo root (looked for credentials.env or Web\main\.env in parents of $PSScriptRoot)."
}

# Same order as deploy.ps1: credentials first, then main dev `.env` (overrides / adds CLOUDFLARE_* etc.).
Import-DotEnvFile -LiteralPath (Join-Path $repoRoot "credentials.env")
Import-DotEnvFile -LiteralPath (Join-Path $repoRoot "Web\main\.env")

if ($env:CLOUDFLARE_GLOBAL_API_KEY -and -not $env:CLOUDFLARE_API_KEY) {
    Set-Item -Path "Env:CLOUDFLARE_API_KEY" -Value $env:CLOUDFLARE_GLOBAL_API_KEY
}

$hasToken = $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_API_TOKEN.Length -ge 10
$hasGlobal = $env:CLOUDFLARE_API_KEY -and $env:CLOUDFLARE_API_KEY.Length -ge 10 -and $env:CLOUDFLARE_EMAIL -and $env:CLOUDFLARE_EMAIL.Length -gt 3
if (-not $hasToken -and -not $hasGlobal) {
    Write-Host "Set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY) in credentials.env and/or Web\main\.env."
    exit 1
}

Set-Location $PSScriptRoot
$wranglerToml = Get-Content -LiteralPath (Join-Path $PSScriptRoot "wrangler.toml") -Raw
if ($wranglerToml -notmatch 'database_name\s*=\s*"root-record"') {
    throw "wrangler.toml must set database_name = `"root-record`" only."
}
$expectId = [string]$env:D1_DATABASE_ID
if ($expectId.Length -ge 32 -and $wranglerToml -notmatch [regex]::Escape($expectId)) {
    throw "wrangler.toml database_id must match D1_DATABASE_ID from env."
}

npx wrangler d1 migrations apply root-record --remote
