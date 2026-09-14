@echo off
setlocal EnableExtensions
rem Open all RootMC listing vote pages (from root-play root-rewards.yml).
rem Prefer one new Edge/Chrome window with every URL as a tab.

set "U1=https://minecraft-mp.com/server/359724/vote/"
set "U2=https://minecraftservers.org/vote/689134"
set "U3=https://minecraft-server-list.com/server/521165/vote/"
set "U4=https://minecraft.buzz/vote/21857"
set "U5=https://topminecraftservers.org/vote/43816"
set "U6=https://www.minerank.com/rootmc-top-tier-economy-server/vote"
set "U7=https://minecraftlist.org/vote/34144"
set "U8=https://www.planetminecraft.com/server/rootmc/vote/"

where msedge >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" msedge --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

where chrome >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" chrome --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --new-window "%U1%" "%U2%" "%U3%" "%U4%" "%U5%" "%U6%" "%U7%" "%U8%"
  exit /b 0
)

rem Fallback: default browser (often separate windows/tabs).
start "" "%U1%"
start "" "%U2%"
start "" "%U3%"
start "" "%U4%"
start "" "%U5%"
start "" "%U6%"
start "" "%U7%"
start "" "%U8%"
exit /b 0
