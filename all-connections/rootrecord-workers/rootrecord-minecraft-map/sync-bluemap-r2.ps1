# Sync plugins/BlueMap/bluemap/web/ to R2 bucket rootmc-bluemap.
# Prefers rclone when R2_* keys are in repo-root credentials.env; else wrangler per file.
#
# Usage (from repo root or this folder):
#   powershell -File Web\cloudflare\rootrecord-minecraft-map\sync-bluemap-r2.ps1
#   powershell -File sync-bluemap-r2.ps1 -Source "D:\RootMC\plugins\BlueMap\bluemap\web"
#   powershell -File sync-bluemap-r2.ps1 -DryRun

param(
    [string]$Source = "",
    [string]$Bucket = "rootmc-bluemap",
    [string]$RcloneExe = "",
    [switch]$DryRun,
    [switch]$ExcludeMaps
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Find-RepoRoot {
    $probe = $PSScriptRoot
    for ($i = 0; $i -le 16; $i++) {
        if (Test-Path (Join-Path $probe "credentials.env")) { return $probe }
        $parent = Split-Path $probe -Parent
        if (-not $parent -or $parent -eq $probe) { break }
        $probe = $parent
    }
    return $null
}

function Load-DotEnvFile([string]$LiteralPath) {
    if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
    Get-Content -LiteralPath $LiteralPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $p = $line.IndexOf("=")
        if ($p -gt 0) {
            Set-Item -Path ("Env:" + $line.Substring(0, $p).Trim()) -Value $line.Substring($p + 1).Trim()
        }
    }
}

function Load-CredentialsEnv($repoRoot) {
    if (-not $repoRoot) { return }
    Load-DotEnvFile (Join-Path $repoRoot "credentials.env")
}

function Ensure-R2S3Credentials([string]$accountId) {
    if ($env:R2_ACCESS_KEY_ID -and $env:R2_SECRET_ACCESS_KEY) { return }
    Write-Host "No R2_ACCESS_KEY_ID in .env - using wrangler upload (create keys in Cloudflare Dashboard > R2 > Manage API tokens)."
}

function Resolve-BlueMapWebRoot {
    param([string]$Explicit)
    if ($Explicit -and (Test-Path (Join-Path $Explicit "index.html"))) {
        return (Resolve-Path $Explicit).Path
    }
    $handoff = "C:\Users\store\Desktop\Projects\RootMC Workspace\Server Files (Handoff Off)"
    $candidates = @(
        (Join-Path $handoff "bluemap\web"),
        (Join-Path $handoff "plugins\BlueMap\bluemap-staging\web"),
        (Join-Path $handoff "plugins\BlueMap\bluemap\web"),
        (Join-Path $env:USERPROFILE "Desktop\RootMC - Current\bluemap\web"),
        (Join-Path $env:USERPROFILE "Desktop\RootMC - Current\plugins\BlueMap\bluemap-staging\web"),
        (Join-Path $env:USERPROFILE "Desktop\RootMC - Current\plugins\BlueMap\bluemap\web"),
        (Join-Path (Find-RepoRoot) "Minecraft\server\plugins\BlueMap\bluemap\web")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c "index.html"))) {
            return (Resolve-Path $c).Path
        }
    }
    return $null
}

function Resolve-RcloneExe {
    param([string]$Explicit)
    if ($Explicit -and (Test-Path -LiteralPath $Explicit)) {
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    if ($env:RCLONE_EXE -and (Test-Path -LiteralPath $env:RCLONE_EXE)) {
        return (Resolve-Path -LiteralPath $env:RCLONE_EXE).Path
    }
    $onPath = Get-Command rclone -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $desktop = Join-Path $env:USERPROFILE "Desktop"
    if (Test-Path $desktop) {
        $bundled = Get-ChildItem -Path $desktop -Filter "rclone.exe" -Recurse -Depth 2 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($bundled) { return $bundled.FullName }
    }
    return $null
}

$repoRoot = Find-RepoRoot
$rootMcEnv = "C:\Users\store\Desktop\Projects\RootMC Workspace\.env"
# RootMC map bucket: use RootMC Workspace\.env (RootRecord credentials.env is a different account).
if (-not (Test-Path $rootMcEnv)) {
    Load-CredentialsEnv $repoRoot
} else {
    Load-DotEnvFile $rootMcEnv
    Remove-Item Env:CLOUDFLARE_API_KEY, Env:CLOUDFLARE_EMAIL -ErrorAction SilentlyContinue
}

$Source = Resolve-BlueMapWebRoot $Source
if (-not $Source) {
    throw "BlueMap web root not found. Pass -Source to bluemap/web (must contain index.html)."
}

if ($DryRun) {
    $files = Get-ChildItem -Path $Source -Recurse -File
    Write-Host "[dry-run] Would sync $($files.Count) file(s) from $Source"
    $files | Select-Object -First 20 | ForEach-Object {
        $rel = $_.FullName.Substring($Source.Length).TrimStart('\').Replace('\', '/')
        Write-Host "  $rel"
    }
    if ($files.Count -gt 20) { Write-Host "  ..." }
    exit 0
}

$account = if ($Bucket -eq "rootmc-bluemap") {
    if ($env:ROOTMC_CLOUDFLARE_ACCOUNT_ID) { $env:ROOTMC_CLOUDFLARE_ACCOUNT_ID }
    elseif ($env:CLOUDFLARE_ACCOUNT_ID) { $env:CLOUDFLARE_ACCOUNT_ID }
    else { "f3372b30093435bacc35b69972abeb2e" }
} else {
    $env:CLOUDFLARE_ACCOUNT_ID
}
Ensure-R2S3Credentials $account
$key = $env:R2_ACCESS_KEY_ID
$secret = $env:R2_SECRET_ACCESS_KEY
$rclonePath = Resolve-RcloneExe $RcloneExe

if ($rclonePath -and $account -and $key -and $secret) {
    $conf = Join-Path $env:TEMP "rootmc-bluemap-rclone.conf"
    @"
[$Bucket]
type = s3
provider = Cloudflare
access_key_id = $key
secret_access_key = $secret
endpoint = https://${account}.r2.cloudflarestorage.com
acl = private
"@ | Set-Content -Path $conf -Encoding UTF8

    Write-Host "Syncing via rclone ($rclonePath) to $Bucket from $Source ..."
    $extra = @()
    if ($ExcludeMaps) { $extra += "--exclude"; $extra += "maps/**" }
    & $rclonePath sync $Source "${Bucket}:" --config $conf --progress --stats-one-line @extra
    if ($LASTEXITCODE -ne 0) { throw "rclone sync failed (exit $LASTEXITCODE)" }
    Remove-Item $conf -Force -ErrorAction SilentlyContinue
    Write-Host "R2 sync complete (rclone)."
    exit 0
}

if (-not $account -or -not $key -or -not $secret) {
    Write-Host "Tip: add R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID to credentials.env for fast rclone sync."
}

if (-not (Test-Path "node_modules")) { npm install }

$files = Get-ChildItem -Path $Source -Recurse -File
if ($ExcludeMaps) {
    $files = $files | Where-Object {
        $rel = $_.FullName.Substring($Source.TrimEnd('\').Length).TrimStart('\').Replace('\', '/')
        -not $rel.StartsWith("maps/")
    }
}
$total = $files.Count
$n = 0
$srcRoot = $Source.TrimEnd('\')

Write-Host "Syncing $total file(s) via wrangler from $Source ..."

foreach ($f in $files) {
    $n++
    $rel = $f.FullName.Substring($srcRoot.Length).TrimStart('\').Replace('\', '/')
    if ($n % 250 -eq 0 -or $n -eq 1 -or $n -eq $total) {
        Write-Host "[$n/$total] $rel"
    }
    $wrArgs = @("r2", "object", "put", "$Bucket/$rel", "--file=$($f.FullName)", "--remote")
    if ($Bucket -eq "rootmc-bluemap") {
        & npx wrangler -c wrangler.rootmc.toml @wrArgs 2>&1 | Out-Null
    } else {
        & npx wrangler @wrArgs 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw "Failed upload: $rel" }
}

Write-Host "R2 sync complete (wrangler)."
