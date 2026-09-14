# Workstations and product apps now live on C:\Users\rootr\ava (real folders).
# Do NOT recreate USB junctions to E:\. This script only verifies the C-only layout.
# Media, workstations, plugins (C-local junction into workstations), and apps\* must be real.

$ErrorActionPreference = "Stop"
$Live = "C:\Users\rootr\ava"

function Assert-RealDir([string]$Path, [switch]$AllowLocalJunction) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "missing $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.LinkType -eq "Junction") {
        $target = ($item.Target | Select-Object -First 1)
        if ($target -match '^[DE]:\\') {
            throw "still points at external drive: $Path -> $target"
        }
        if (-not $AllowLocalJunction) {
            throw "expected real directory (not junction): $Path"
        }
        Write-Host "ok local junction $Path -> $target"
        return
    }
    Write-Host "ok real $Path"
}

Assert-RealDir (Join-Path $Live "Media")
Assert-RealDir (Join-Path $Live "workstations")
Assert-RealDir (Join-Path $Live "plugins") -AllowLocalJunction
Assert-RealDir (Join-Path $Live "all-connections")

$apps = @(
    "kilauea-alerts", "rootmc-android", "solana-rootrecord-site",
    "weather-manager-web", "business-manager-web", "kilauea-alerts-web",
    "account-hub-web", "token-manager-web", "root-farms-web",
    "root-farms-mobile-web", "root-goals-web", "visiting-hawaii-web", "realm-web"
)
foreach ($name in $apps) {
    Assert-RealDir (Join-Path $Live "apps\$name")
}

Write-Host "Done. Live tree is on C:. D: and E: are cold archive only."
Write-Host "RootMC API stays at api.rootmc.net. Not Ava origin."
