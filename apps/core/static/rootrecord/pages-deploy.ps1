# Deploy Cloudflare Pages — loads credentials like Worker deploy.ps1, but merges multiple
# env files walking up from this folder (e.g. Web/credentials.env then ../credentials.env.txt).
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Import-DotEnvFile([string]$LiteralPath) {
  if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
  Get-Content -LiteralPath $LiteralPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $p = $line.IndexOf("=")
    if ($p -gt 0) {
      $k = $line.Substring(0, $p).Trim()
      $v = $line.Substring($p + 1).Trim()
      if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
      if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

$dirs = @()
$probe = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
  $dirs += $probe
  $parent = Split-Path $probe -Parent
  if (-not $parent -or $parent -eq $probe) { break }
  $probe = $parent
}

$files = @()
foreach ($d in $dirs) {
  foreach ($name in @("credentials.env.txt", "credentials.env")) {
    $full = Join-Path $d $name
    if (Test-Path -LiteralPath $full) { $files += $full }
  }
}

if ($files.Count -eq 0) {
  throw "No credentials.env or credentials.env.txt found walking up from $PSScriptRoot."
}

foreach ($f in $files) {
  Import-DotEnvFile $f
}

if ($env:CLOUDFLARE_GLOBAL_API_KEY -and -not $env:CLOUDFLARE_API_KEY) {
  Set-Item -Path "Env:CLOUDFLARE_API_KEY" -Value $env:CLOUDFLARE_GLOBAL_API_KEY
}

$hasToken = $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_API_TOKEN.Length -ge 10
$hasGlobal = $env:CLOUDFLARE_API_KEY -and $env:CLOUDFLARE_API_KEY.Length -ge 10 -and $env:CLOUDFLARE_EMAIL -and $env:CLOUDFLARE_EMAIL.Length -gt 3
if (-not $hasToken -and -not $hasGlobal) {
  throw "Set CLOUDFLARE_API_TOKEN, or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY in a credentials file (merged from: $($files -join ', '))."
}

$srcRoot = $PSScriptRoot
$marketingTok = [string]$env:CF_WEB_ANALYTICS_TOKEN_MARKETING
$injectScript = Join-Path (Split-Path $srcRoot -Parent) "scripts\inject-cf-web-analytics.ps1"
$staging = $null
try {
  if ($marketingTok -and $marketingTok.Length -ge 8 -and (Test-Path -LiteralPath $injectScript)) {
    $staging = Join-Path $env:TEMP ("rootrecord-website-pages-" + [Guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    robocopy $srcRoot $staging /E /XD node_modules .wrangler /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy to staging failed (exit $LASTEXITCODE)" }
    & $injectScript -BuildRoot $staging -Token $marketingTok
    Set-Location $staging
  } else {
    Set-Location $srcRoot
  }
  # --branch: must match Pages project "Production branch" (usually main) so rootrecord.info updates.
  npx wrangler pages deploy . --project-name=rootrecord-website --branch main @args
} finally {
  Set-Location $srcRoot
  if ($staging -and (Test-Path -LiteralPath $staging)) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}
