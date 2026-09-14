@echo off
rem Local Node + Helius/SOLANA_RPC_URL only — no Cloudflare Workers.
rem Double-click: LIVE watch loop (sends FreezeAccount txs). Ctrl+C to stop.
rem Scan only (no txs):  scripts\freeze-new-token-accounts.bat --dry
rem One live pass then exit:  scripts\freeze-new-token-accounts.bat --once
setlocal
cd /d "%~dp0.."
if not exist "node_modules" (
  echo No node_modules in %CD%
  echo Run: npm ci
  pause
  exit /b 1
)
echo *** LIVE on-chain freeze loop ***  ^(add --dry for scan-only^)
echo Running: node scripts\freeze-new-token-accounts.mjs --watch --live %*
echo.
node scripts\freeze-new-token-accounts.mjs --watch --live %*
echo.
pause
