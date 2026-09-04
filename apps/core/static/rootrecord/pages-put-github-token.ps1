# Pipe GITHUB_TOKEN into Cloudflare Pages for /api/weekly-work-log (repo scope for private repos).
# Loads credentials.env walking up from this folder; falls back to `gh auth token` when logged in.
$ErrorActionPreference = "Stop"

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

$probe = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
  foreach ($name in @("credentials.env.txt", "credentials.env")) {
    $full = Join-Path $probe $name
    if (Test-Path -LiteralPath $full) { Import-DotEnvFile $full }
  }
  $parent = Split-Path $probe -Parent
  if (-not $parent -or $parent -eq $probe) { break }
  $probe = $parent
}

if ($env:CLOUDFLARE_GLOBAL_API_KEY -and -not $env:CLOUDFLARE_API_KEY) {
  Set-Item -Path "Env:CLOUDFLARE_API_KEY" -Value $env:CLOUDFLARE_GLOBAL_API_KEY
}

$token = [string]$env:GITHUB_TOKEN
if (-not $token -or $token.Length -lt 20) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    $token = (& gh auth token 2>$null | Out-String).Trim()
  }
}
if (-not $token -or $token.Length -lt 20) {
  throw "Set GITHUB_TOKEN in credentials.env (repo scope PAT) or run `gh auth login`, then re-run."
}

Set-Location $PSScriptRoot
$token | npx wrangler pages secret put GITHUB_TOKEN --project-name=rootrecord-website @args
Write-Host "Pages secret GITHUB_TOKEN updated for project rootrecord-website."
