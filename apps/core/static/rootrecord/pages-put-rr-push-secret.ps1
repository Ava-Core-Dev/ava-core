# Pipe RR_PUSH_ADMIN_SECRET into Cloudflare Pages (same name as Weather Worker secret).
# Loads credentials.env / credentials.env.txt walking up from this folder (same merge as pages-deploy.ps1).
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

$v = [string]$env:RR_PUSH_ADMIN_SECRET
if (-not $v -or $v.Length -lt 4) {
  throw "RR_PUSH_ADMIN_SECRET is not set (add it to credentials.env merged by this script, or set the env var), then re-run."
}

$v | npx wrangler pages secret put RR_PUSH_ADMIN_SECRET --project-name=rootrecord-website @args
Write-Host "Pages secret RR_PUSH_ADMIN_SECRET updated for project rootrecord-website."
