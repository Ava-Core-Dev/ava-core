# Create R2 S3 API token for rclone sync; appends keys to credentials.env if missing.
$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
for ($i = 0; $i -le 16; $i++) {
    if (Test-Path (Join-Path $repoRoot "credentials.env")) { break }
    $repoRoot = Split-Path $repoRoot -Parent
}
$credPath = Join-Path $repoRoot "credentials.env"
if (-not (Test-Path $credPath)) { throw "credentials.env not found" }

$credText = Get-Content $credPath -Raw
if ($credText.Contains("R2_ACCESS_KEY_ID=")) {
    Write-Host "R2_ACCESS_KEY_ID already set in credentials.env - skipping."
    exit 0
}

Get-Content $credPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $p = $line.IndexOf("=")
    if ($p -gt 0) {
        Set-Item -Path ("Env:" + $line.Substring(0, $p).Trim()) -Value $line.Substring($p + 1).Trim()
    }
}

$account = $env:CLOUDFLARE_ACCOUNT_ID
$email = $env:CLOUDFLARE_EMAIL
$key = $env:CLOUDFLARE_API_KEY
if (-not $account -or -not $email -or -not $key) {
    throw "Need CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL, CLOUDFLARE_API_KEY in credentials.env"
}

$body = @{
    name = "rootrecord-bluemap-sync"
    policies = @(
        @{
            effect = "allow"
            permission_groups = @(
                @{ id = "82e64a83756745bbbb1c9c2701bf816b" }
            )
            resources = @{
                "com.cloudflare.api.account.$account" = "*"
            }
        }
    )
} | ConvertTo-Json -Depth 6

$resp = Invoke-RestMethod -Method Post `
    -Uri "https://api.cloudflare.com/client/v4/accounts/$account/r2/tokens" `
    -Headers @{ "X-Auth-Email" = $email; "X-Auth-Key" = $key; "Content-Type" = "application/json" } `
    -Body $body

if (-not $resp.success) {
    throw "Cloudflare R2 token API failed: $($resp.errors | ConvertTo-Json -Compress)"
}

$accessId = $resp.result.id
$secret = $resp.result.secret
if (-not $accessId -or -not $secret) {
    throw "Unexpected R2 token response shape"
}

Add-Content -Path $credPath -Value ""
Add-Content -Path $credPath -Value "# R2 S3 sync (rootrecord-bluemap) - created by create-r2-sync-token.ps1"
Add-Content -Path $credPath -Value "R2_ACCESS_KEY_ID=$accessId"
Add-Content -Path $credPath -Value "R2_SECRET_ACCESS_KEY=$secret"
Write-Host "Added R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to credentials.env"
