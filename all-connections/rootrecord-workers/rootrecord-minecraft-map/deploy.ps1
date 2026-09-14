# Deploy rootrecord-minecraft-map Worker (HTTPS proxy for BlueMap).
param(
    [switch]$RootMc
)
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
        if ($RootMc -and $k -match '^CLOUDFLARE_|^ROOTMC_CLOUDFLARE_') { return }
        Set-Item -Path "Env:$k" -Value $v
    }
}
if ($RootMc) {
    $rootMcWorkspaceEnv = "C:\Users\store\Desktop\Projects\RootMC Workspace\.env"
    foreach ($envPath in @($rootMcWorkspaceEnv)) {
        if (-not (Test-Path -LiteralPath $envPath)) { continue }
        Get-Content -LiteralPath $envPath | ForEach-Object {
            $line = $_.Trim()
            if (-not $line -or $line.StartsWith("#")) { return }
            $p = $line.IndexOf("=")
            if ($p -gt 0) {
                $k = $line.Substring(0, $p).Trim()
                $v = $line.Substring($p + 1).Trim()
                if ($k -and $v) { Set-Item -Path "Env:$k" -Value $v }
            }
        }
    }
    Remove-Item Env:CLOUDFLARE_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:CLOUDFLARE_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:CLOUDFLARE_GLOBAL_API_KEY -ErrorAction SilentlyContinue
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
& "$PSScriptRoot\ensure-r2-bucket.ps1"
$wranglerConfig = if ($RootMc) { "wrangler.rootmc.toml" } else { "wrangler.toml" }
npx wrangler deploy -c $wranglerConfig
if ($RootMc) {
    Write-Host "Done. RootMC BlueMap: https://map.rootmc.net/"
} else {
    Write-Host "Done. BlueMap: https://map.rootrecord.info/ (R2 hybrid - see BLUEMAP-R2.md)"
}
