# One-time Zoho Mail setup for rootrecord-api-account (and deploy.ps1 secret sync).
# You create ONE Zoho API Console app (Self Client is fine). Generate ONE grant code, run this once.
# After that, Worker + scripts use ZOHO_MAIL_REFRESH_TOKEN forever (access tokens refresh automatically).
#
# Usage (from Web/cloudflare/rootrecord-api-account):
#   .\scripts\zoho-mail-setup-once.ps1 -GrantCode "1000.xxxx" -ClientId "1000.xxx" -ClientSecret "xxx"
# Or set ZOHO_MAIL_* in credentials.env first, then: .\scripts\zoho-mail-setup-once.ps1 -UploadSecretsOnly
#
param(
  [string]$GrantCode,
  [string]$ClientId,
  [string]$ClientSecret,
  [string]$From = "RootRecord <root@rootrecord.info>",
  [string]$AccountsBase = "https://accounts.zoho.com",
  [string]$MailApiBase = "https://mail.zoho.com",
  [switch]$UploadSecretsOnly
)

$ErrorActionPreference = "Stop"

function Find-RepoRoot {
  $probe = $PSScriptRoot
  for ($i = 0; $i -le 14; $i++) {
    if (Test-Path (Join-Path $probe "credentials.env")) { return $probe }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }
  throw "credentials.env not found (walked up from $PSScriptRoot)."
}

function Load-CredentialsEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $p = $line.IndexOf("=")
    if ($p -gt 0) {
      $k = $line.Substring(0, $p).Trim()
      $v = $line.Substring($p + 1).Trim()
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

function Set-CredentialsEnvKeys([string]$Path, [hashtable]$Keys) {
  $lines = @()
  if (Test-Path -LiteralPath $Path) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.AddRange([string[]](Get-Content -LiteralPath $Path))
    $remove = @(
      "ZOHO_MAIL_ACCOUNT_ID", "ZOHO_MAIL_FROM", "ZOHO_MAIL_REFRESH_TOKEN",
      "ZOHO_MAIL_CLIENT_ID", "ZOHO_MAIL_CLIENT_SECRET",
      "ZOHO_ACCOUNTS_BASE_URL", "ZOHO_MAIL_API_BASE_URL", "ZOHO_MAIL_OAUTH_TOKEN"
    )
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      $t = $lines[$i].Trim()
      foreach ($k in $remove) {
        if ($t.StartsWith("$k=")) { $lines.RemoveAt($i); break }
      }
    }
  } else {
    $lines = [System.Collections.Generic.List[string]]::new()
  }
  if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne "") { $lines.Add("") }
  $lines.Add("# Zoho Mail (one-time setup — scripts/zoho-mail-setup-once.ps1)")
  foreach ($entry in $Keys.GetEnumerator() | Sort-Object Name) {
    if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) { continue }
    $lines.Add("$($entry.Key)=$($entry.Value)")
  }
  Set-Content -LiteralPath $Path -Value $lines -Encoding utf8
  Write-Host "Updated $Path"
}

$repoRoot = Find-RepoRoot
$credPath = Join-Path $repoRoot "credentials.env"
Load-CredentialsEnv $credPath

$ClientId = if ($ClientId.Trim().Length -ge 4) { $ClientId.Trim() } else { [string]$env:ZOHO_MAIL_CLIENT_ID }
$ClientSecret = if ($ClientSecret.Trim().Length -ge 4) { $ClientSecret.Trim() } else { [string]$env:ZOHO_MAIL_CLIENT_SECRET }
$refresh = [string]$env:ZOHO_MAIL_REFRESH_TOKEN

if (-not $UploadSecretsOnly) {
  if (-not $refresh.Trim()) {
    $code = if ($GrantCode.Trim().Length -ge 8) { $GrantCode.Trim() } else { [string]$env:ZOHO_MAIL_GRANT_CODE }
    if (-not $code) { throw "Pass -GrantCode (10-min Self Client code) or set ZOHO_MAIL_REFRESH_TOKEN in credentials.env." }
    if (-not $ClientId -or -not $ClientSecret) { throw "Pass -ClientId and -ClientSecret (same Zoho app every time — do not create new clients)." }

    $tokenUri = "$AccountsBase/oauth/v2/token"
    $body = "grant_type=authorization_code&client_id=$([uri]::EscapeDataString($ClientId))&client_secret=$([uri]::EscapeDataString($ClientSecret))&redirect_uri=https://www.zoho.com&code=$([uri]::EscapeDataString($code))"
    $tokenRes = Invoke-RestMethod -Method Post -Uri $tokenUri -ContentType "application/x-www-form-urlencoded" -Body $body
    $refresh = [string]$tokenRes.refresh_token
    if (-not $refresh) { throw "No refresh_token in Zoho response. Use a fresh grant code or check Zoho region ($AccountsBase)." }
    Write-Host "Got long-lived refresh token."
  }

  $accessBody = "refresh_token=$([uri]::EscapeDataString($refresh))&client_id=$([uri]::EscapeDataString($ClientId))&client_secret=$([uri]::EscapeDataString($ClientSecret))&grant_type=refresh_token"
  $accessRes = Invoke-RestMethod -Method Post -Uri "$AccountsBase/oauth/v2/token" -ContentType "application/x-www-form-urlencoded" -Body $accessBody
  $access = [string]$accessRes.access_token
  if (-not $access) { throw "Could not refresh access token." }

  $accounts = Invoke-RestMethod -Method Get -Uri "$MailApiBase/api/accounts" -Headers @{ Authorization = "Zoho-oauthtoken $access" }
  $accountId = [string]($accounts.data[0].accountId)
  if (-not $accountId) { throw "Could not read Zoho Mail accountId." }

  Set-CredentialsEnvKeys $credPath @{
    ZOHO_MAIL_CLIENT_ID       = $ClientId
    ZOHO_MAIL_CLIENT_SECRET   = $ClientSecret
    ZOHO_MAIL_REFRESH_TOKEN   = $refresh
    ZOHO_MAIL_ACCOUNT_ID      = $accountId
    ZOHO_MAIL_FROM            = $From
    ZOHO_ACCOUNTS_BASE_URL    = $AccountsBase
    ZOHO_MAIL_API_BASE_URL    = $MailApiBase
  }
  Load-CredentialsEnv $credPath
}

Set-Location (Join-Path $PSScriptRoot "..")
foreach ($name in @(
  "ZOHO_MAIL_ACCOUNT_ID", "ZOHO_MAIL_FROM", "ZOHO_MAIL_REFRESH_TOKEN",
  "ZOHO_MAIL_CLIENT_ID", "ZOHO_MAIL_CLIENT_SECRET",
  "ZOHO_ACCOUNTS_BASE_URL", "ZOHO_MAIL_API_BASE_URL"
)) {
  $val = [string](Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value
  if ($val.Trim().Length -ge 4) {
    $val.Trim() | npx wrangler secret put $name
    Write-Host "wrangler secret put $name"
  } else {
    Write-Host "Skip $name (missing in credentials.env)"
  }
}

Write-Host ""
Write-Host "Done. Do not generate new Zoho clients or grant codes for routine sends."
Write-Host "Welcome backfill: node scripts/send-first-time-welcome-emails.mjs --execute"
Write-Host "Kilauea 1.0.44: node scripts/send-kilauea-v1044-release-emails.mjs --execute"
