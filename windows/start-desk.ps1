# Legacy. Desktop shortcut uses pythonw windows\start_desk.py.
$ErrorActionPreference = "Stop"
$AvaHome = "C:\Users\rootr\ava"
$pyw = Join-Path $AvaHome ".venv\Scripts\pythonw.exe"
$starter = Join-Path $AvaHome "windows\start_desk.py"
if (-not (Test-Path $pyw)) { throw "pythonw missing: $pyw" }
Start-Process -FilePath $pyw -ArgumentList "`"$starter`"" -WorkingDirectory $AvaHome
