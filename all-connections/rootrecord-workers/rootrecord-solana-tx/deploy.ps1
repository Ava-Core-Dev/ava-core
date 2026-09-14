# Deploy rootrecord-solana-tx + upload secrets from repo credentials.env / credentials.env.txt / Web/credentials.env.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$repoRoot = (Resolve-Path (Join-Path $here "..\..\..\")).Path
$credRoot = Join-Path $repoRoot "credentials.env"
$credTxt = Join-Path $repoRoot "credentials.env.txt"
$credEnv = Join-Path $repoRoot "Web\credentials.env"

function Import-DotEnvFile([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { return }
  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^\s*#' -or $line -eq "") { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    if ($k) { Set-Item -Path "Env:$k" -Value $v }
  }
}

Import-DotEnvFile $credRoot
Import-DotEnvFile $credTxt
Import-DotEnvFile $credEnv

if ($env:CLOUDFLARE_ACCOUNT_ID) { $env:CLOUDFLARE_ACCOUNT_ID = $env:CLOUDFLARE_ACCOUNT_ID.Trim() }
$apiKey = [string]$env:CLOUDFLARE_API_KEY
if (-not $apiKey) { $apiKey = [string]$env:CLOUDFLARE_GLOBAL_API_KEY }
if ($apiKey) {
  $env:CLOUDFLARE_API_KEY = $apiKey
  Write-Host "Using CLOUDFLARE_API_KEY for Wrangler."
}

function Put-SecretIf([string]$name, [string]$val) {
  $t = ([string]$val).Trim()
  if ($t.Length -lt 8) {
    Write-Host "Skip secret $name (missing or too short in env files)."
    return
  }
  $t | npx wrangler secret put $name
  Write-Host "Uploaded secret $name"
}

Put-SecretIf "RR_PUSH_ADMIN_SECRET" $env:RR_PUSH_ADMIN_SECRET
Put-SecretIf "ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58" $env:ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58
Put-SecretIf "SOLANA_RPC_URL" $env:SOLANA_RPC_URL
Put-SecretIf "DISCORD_WEBHOOK_SOLANA_TOOLS" $env:DISCORD_WEBHOOK_SOLANA_TOOLS
Put-SecretIf "TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58" $env:TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58

npx wrangler deploy
Write-Host "Done. Point rootrecord-primary var ROOTRECORD_SOLANA_TX_URL at this Worker URL (workers.dev or custom)."
