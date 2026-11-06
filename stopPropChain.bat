@echo off
setlocal enabledelayedexpansion
REM ===================================================================
REM  PropChain Classroom - stop the Hardhat node, frontend dev server,
REM  and both Cloudflare tunnels started by startPropChain.bat.
REM
REM  Only kills processes bound to ports 8545/5173, and only the
REM  cloudflared.exe tunnels pointed at those ports -- never touches
REM  the separate QuantSave app or its own tunnel on port 8000.
REM ===================================================================

set "ROOT=%~dp0"
set "TOOLS=%ROOT%tools"
set "LOGDIR=%ROOT%logs"

echo   Stopping PropChain Classroom...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8545 "') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do taskkill /f /pid %%a >nul 2>&1

if exist "%TOOLS%\pc-kill-tunnel.ps1" (
  powershell -NoProfile -File "%TOOLS%\pc-kill-tunnel.ps1" -Port 8545
  powershell -NoProfile -File "%TOOLS%\pc-kill-tunnel.ps1" -Port 5173
)

del /q "%LOGDIR%\pc_tunnel_rpc_url.txt" "%LOGDIR%\pc_tunnel_front_url.txt" "%LOGDIR%\pc_student_link.txt" >nul 2>&1

echo   Done. Hardhat node, frontend, and both tunnels are stopped.
pause
endlocal
