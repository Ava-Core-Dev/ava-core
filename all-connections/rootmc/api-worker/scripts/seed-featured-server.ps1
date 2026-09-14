# Insert featured RootMC server row into rootmc D1 (same server_id/secret as live cloud.yml).
# Run after d1-apply-remote.ps1. Idempotent (INSERT OR REPLACE).
$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
. (Join-Path $workspaceRoot "scripts\load-rootmc-env.ps1")

$cloudCandidates = @(
    (Join-Path $workspaceRoot "2. RootMC - Towny\plugins\RootMC\cloud.yml"),
    (Join-Path $workspaceRoot "1. RootMC - Claims\plugins\RootMC\cloud.yml"),
    (Join-Path $workspaceRoot "Server Handoffs\2. RootMC - Towny\plugins\RootMC\cloud.yml"),
    (Join-Path $workspaceRoot "Plugin Building\Minecraft\server\plugins\RootMC\cloud.yml")
)
$cloudYml = $cloudCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudYml) { throw "cloud.yml not found - set server-id and server-secret under 2. RootMC - Towny\plugins\RootMC\cloud.yml" }

$serverId = $null
$serverSecret = $null
Get-Content $cloudYml | ForEach-Object {
    if ($_ -match '^\s*server-id:\s*"?([^"#]+)"?') { $serverId = $Matches[1].Trim() }
    if ($_ -match '^\s*server-secret:\s*"?([^"#]+)"?') { $serverSecret = $Matches[1].Trim() }
}
if (-not $serverId -or -not $serverSecret) { throw "server-id / server-secret missing in $cloudYml" }

$hash = [BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($serverSecret))
).Replace("-", "").ToLower()

$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$sql = @"
INSERT INTO rootstat_servers (
  server_id, server_name, server_secret_hash, owner_account_id,
  created_at, updated_at, server_address, default_world_name,
  map_url, game_version, featured
) VALUES (
  '$serverId',
  'RootMC',
  '$hash',
  '',
  '$now',
  '$now',
  'play.rootmc.net',
  'RootMC',
  'https://map.rootmc.net/',
  '26.2',
  1
) ON CONFLICT(server_id) DO UPDATE SET
  server_secret_hash = excluded.server_secret_hash,
  server_name = excluded.server_name,
  server_address = excluded.server_address,
  default_world_name = excluded.default_world_name,
  map_url = excluded.map_url,
  game_version = excluded.game_version,
  featured = excluded.featured,
  updated_at = excluded.updated_at;
"@

$tmp = Join-Path $env:TEMP "rootmc-seed-server.sql"
Set-Content -LiteralPath $tmp -Value $sql -Encoding UTF8

Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "Seeding rootstat_servers server_id=$serverId ..."
npx wrangler d1 execute rootmc --remote --file="$tmp"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Featured server row ready (auth uses existing cloud.yml secret)."
