# Ava GitHub push (end of dig phase)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
$msg = $args -join " "
if ($msg) {
  node scripts/ava-github-push.mjs $msg
} else {
  node scripts/ava-github-push.mjs
}
