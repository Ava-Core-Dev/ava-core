# Seed R2 from live map (hybrid origin) — web shell + settings + linked assets.
# Full map tiles sync later via sync-bluemap-r2.ps1 when bluemap/web exists locally.
param(
    [string]$BaseUrl = "https://map.rootrecord.info",
    [string]$Bucket = "rootrecord-bluemap",
    [string]$EnvFile = ""
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

function Load-CredentialsEnv($repoRoot) {
    if (-not $repoRoot) { return }
    Get-Content (Join-Path $repoRoot "credentials.env") | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $p = $line.IndexOf("=")
        if ($p -gt 0) {
            Set-Item -Path ("Env:" + $line.Substring(0, $p).Trim()) -Value $line.Substring($p + 1).Trim()
        }
    }
}

function Get-RemoteText([string]$Url) {
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60).Content
}

function Put-R2Object([string]$Key, [string]$FilePath) {
    $cfg = if ($Bucket -eq "rootmc-bluemap") { @("-c", "wrangler.rootmc.toml") } else { @() }
    & npx wrangler @cfg r2 object put "$Bucket/$Key" --file=$FilePath --remote 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "R2 put failed: $Key" }
}

if ($EnvFile -and (Test-Path $EnvFile)) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.+)$') { Set-Item -Path "Env:$($matches[1].Trim())" -Value $matches[2].Trim() }
    }
    Remove-Item Env:CLOUDFLARE_API_KEY, Env:CLOUDFLARE_EMAIL -ErrorAction SilentlyContinue
}

Load-CredentialsEnv (Find-RepoRoot)
if (-not (Test-Path "node_modules")) { npm install }

$base = $BaseUrl.TrimEnd("/")
$staging = Join-Path $env:TEMP "rootmc-bluemap-bootstrap"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

$paths = New-Object System.Collections.Generic.HashSet[string]
[void]$paths.Add("index.html")
[void]$paths.Add("settings.json")

$html = Get-RemoteText "$base/"
$htmlPath = Join-Path $staging "index.html"
[System.IO.File]::WriteAllText($htmlPath, $html)

foreach ($m in [regex]::Matches($html, '(?:src|href)="([^"#?]+)"')) {
    $p = $m.Groups[1].Value.TrimStart("/")
    if ($p -and -not $p.StartsWith("http") -and -not $p.StartsWith("__bluemap-live")) { [void]$paths.Add($p) }
}

$settings = Get-RemoteText "$base/settings.json"
$settingsPath = Join-Path $staging "settings.json"
[System.IO.File]::WriteAllText($settingsPath, $settings)
foreach ($m in [regex]::Matches($settings, '"(/assets/[^"]+)"')) {
    [void]$paths.Add($m.Groups[1].Value.TrimStart("/"))
}
foreach ($m in [regex]::Matches($settings, '"(/maps/[^"]+)"')) {
    [void]$paths.Add($m.Groups[1].Value.TrimStart("/"))
}
foreach ($m in [regex]::Matches($settings, '"(maps/[^"]+)"')) {
    [void]$paths.Add($m.Groups[1].Value.TrimStart("/"))
}

Write-Host "Bootstrapping $($paths.Count) object(s) from $base to R2 bucket $Bucket..."
$n = 0
foreach ($rel in ($paths | Sort-Object)) {
    $n++
    $key = $rel -replace '^\./', ''
    $url = if ($rel.StartsWith("http")) { $rel } else { "$base/$key" }
    $local = Join-Path $staging ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
    $dir = Split-Path $local -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 120 -OutFile $local
    } catch {
        Write-Host "  skip $rel ($($_.Exception.Message))"
        continue
    }
    Put-R2Object $key $local
    Write-Host "  [$n] $key"
}

Write-Host "Bootstrap done. Run sync-bluemap-r2.ps1 after Chunky/BlueMap for full tiles."
