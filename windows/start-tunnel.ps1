# Cloudflare Tunnel for Ava origin only.
# Token file: %USERPROFILE%\.cloudflared\origin.token  (create in dashboard; never paste in chat)
# Maps origin.avaivy.cloud → http://127.0.0.1:8787
# Public site is rootrecord.cloud (Worker). That Worker fetches origin.avaivy.cloud.
# origin.rootrecord.cloud CNAME exists; add a published tunnel hostname before using it.
# Do not CNAME rootrecord.info, kilauea.cloud, or rootmc.net to this tunnel.

$ErrorActionPreference = "Stop"
$tokenFile = Join-Path $env:USERPROFILE ".cloudflared\origin.token"
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  foreach ($p in @(
    "${env:ProgramFiles}\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
  )) {
    if (Test-Path -LiteralPath $p) { $cf = [pscustomobject]@{ Source = $p }; break }
  }
}
if (-not $cf) { throw "cloudflared is not installed" }
if (-not (Test-Path -LiteralPath $tokenFile)) {
  throw "Missing token file. Create a named tunnel hostname origin.avaivy.cloud, save the token to $tokenFile"
}
Start-Process -WindowStyle Hidden -FilePath $cf.Source -ArgumentList "tunnel","run","--token-file",$tokenFile
