@echo off
setlocal enabledelayedexpansion
REM ===================================================================
REM  PropChain Classroom - start the Hardhat node, deploy demo contracts,
REM  and start the frontend dev server. One script instead of 3 terminals.
REM
REM    startPropChain.bat              local only   http://localhost:5173 (+ :8545 RPC)
REM    startPropChain.bat --tunnel     + a Cloudflare quick tunnel for EACH
REM                                    localhost above, and prints a
REM                                    ready-to-share student link
REM                                    (frontend tunnel URL + ?rpc=<rpc tunnel URL>)
REM
REM  Safe to re-run: anything already up and healthy is left alone (no
REM  restart, no fresh tunnel URL, no chain wipe). Only what's missing or
REM  unhealthy gets (re)started.
REM
REM  Env overrides: PC_TUNNEL=1 same as --tunnel ; CLOUDFLARED=path\to\cloudflared.exe
REM  Logs + state:  logs\pc_*.log , logs\pc_tunnel_*_url.txt , logs\pc_student_link.txt
REM  (all git-ignored - delete anything in logs\ whenever you like)
REM ===================================================================

set "ROOT=%~dp0"
set "BLOCKCHAIN=%ROOT%blockchain"
set "FRONTEND=%ROOT%frontend"
set "TOOLS=%ROOT%tools"
set "LOGDIR=%ROOT%logs"
set "DEPLOYMENT_JSON=%FRONTEND%\src\contracts\deployment.json"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not defined CLOUDFLARED set "CLOUDFLARED=cloudflared"

set "TUNNEL=0"
if /i "%~1"=="--tunnel" set "TUNNEL=1"
if "%TUNNEL%"=="0" if "%PC_TUNNEL%"=="1" set "TUNNEL=1"

echo.
echo   PropChain Classroom - Starting...
echo.

REM ---------------------------------------------------------------
REM 1. Hardhat node (port 8545)
REM ---------------------------------------------------------------
echo   [1/3] Hardhat node (localhost:8545)...
set "HARDHAT_FRESH=0"
powershell -NoProfile -File "%TOOLS%\pc-check.ps1" -Url "http://localhost:8545" -Mode rpc
if not errorlevel 1 goto hardhat_ok
goto hardhat_start

:hardhat_ok
echo         Already running - leaving it alone.
goto hardhat_done

:hardhat_start
echo         Not running - clearing port and starting a fresh node...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8545 "') do taskkill /f /pid %%a >nul 2>&1
> "%LOGDIR%\run_hardhat.bat" echo @echo off
>> "%LOGDIR%\run_hardhat.bat" echo cd /d "%BLOCKCHAIN%"
>> "%LOGDIR%\run_hardhat.bat" echo npm run node:shared ^> "%LOGDIR%\pc_hardhat.log" 2^>^&1
start "PropChain Hardhat Node" /min "%LOGDIR%\run_hardhat.bat"
set "HARDHAT_FRESH=1"
set "RPC_UP="
for /l %%i in (1,1,30) do call :poll_rpc_8545
if defined RPC_UP goto hardhat_started_ok
echo         [error] Hardhat node did not come up in time - check "%LOGDIR%\pc_hardhat.log"
exit /b 1

:poll_rpc_8545
if defined RPC_UP goto :eof
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -File "%TOOLS%\pc-check.ps1" -Url "http://localhost:8545" -Mode rpc
if not errorlevel 1 set "RPC_UP=1"
goto :eof

:hardhat_started_ok
echo         Hardhat node is up (fresh chain).
:hardhat_done

REM ---------------------------------------------------------------
REM 2. Deploy demo contracts (only when needed)
REM ---------------------------------------------------------------
set "NEED_DEPLOY=0"
if "%HARDHAT_FRESH%"=="1" set "NEED_DEPLOY=1"
if not exist "%DEPLOYMENT_JSON%" set "NEED_DEPLOY=1"
if "%NEED_DEPLOY%"=="0" goto deploy_skip
echo   [2/3] Deploying demo contracts...
pushd "%BLOCKCHAIN%"
call npm run deploy:shared
popd
goto deploy_done
:deploy_skip
echo   [2/3] Contracts already deployed on the running chain - skipping.
:deploy_done

REM ---------------------------------------------------------------
REM 3. Frontend dev server (port 5173)
REM ---------------------------------------------------------------
echo   [3/3] Frontend dev server (localhost:5173)...
powershell -NoProfile -File "%TOOLS%\pc-check.ps1" -Url "http://localhost:5173" -Mode http
if not errorlevel 1 goto vite_ok
goto vite_start

:vite_ok
echo         Already running - leaving it alone.
goto vite_done

:vite_start
echo         Not running - clearing port and starting Vite...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do taskkill /f /pid %%a >nul 2>&1
> "%LOGDIR%\run_frontend.bat" echo @echo off
>> "%LOGDIR%\run_frontend.bat" echo cd /d "%FRONTEND%"
>> "%LOGDIR%\run_frontend.bat" echo npm run dev -- --host 0.0.0.0 ^> "%LOGDIR%\pc_frontend.log" 2^>^&1
start "PropChain Frontend" /min "%LOGDIR%\run_frontend.bat"
set "VITE_UP="
for /l %%i in (1,1,30) do call :poll_http_5173
if defined VITE_UP goto vite_started_ok
echo         [error] Vite did not come up in time - check "%LOGDIR%\pc_frontend.log"
exit /b 1

:poll_http_5173
if defined VITE_UP goto :eof
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -File "%TOOLS%\pc-check.ps1" -Url "http://localhost:5173" -Mode http
if not errorlevel 1 set "VITE_UP=1"
goto :eof

:vite_started_ok
echo         Frontend is up.
:vite_done

REM ---------------------------------------------------------------
REM 4. Cloudflare tunnels (optional, one per localhost)
REM ---------------------------------------------------------------
set "RPC_TUN_URL="
set "FRONT_TUN_URL="
if not "%TUNNEL%"=="1" goto tunnels_done
where "%CLOUDFLARED%" >nul 2>&1
if not errorlevel 1 goto tunnels_available
echo   [warn] cloudflared not found on PATH - set CLOUDFLARED=C:\path\to\cloudflared.exe - skipping tunnels
goto tunnels_done

:tunnels_available
call :ensure_tunnel 8545 rpc  pc_tunnel_rpc
call :ensure_tunnel 5173 http pc_tunnel_front
if not defined RPC_TUN_URL goto tunnels_done
if not defined FRONT_TUN_URL goto tunnels_done
> "%LOGDIR%\pc_student_link.txt" echo !FRONT_TUN_URL!?rpc=!RPC_TUN_URL!
:tunnels_done

echo.
echo   -----------------------------------------------------------
echo    Hardhat RPC:   http://localhost:8545
echo    Frontend:      http://localhost:5173
if defined RPC_TUN_URL   echo    RPC tunnel:    !RPC_TUN_URL!
if defined FRONT_TUN_URL echo    App tunnel:    !FRONT_TUN_URL!
if exist "%LOGDIR%\pc_student_link.txt" (
  echo.
  echo    Student link ^(copy/paste - works from any remote browser^):
  type "%LOGDIR%\pc_student_link.txt"
)
echo   -----------------------------------------------------------
echo   Logs: %LOGDIR%
echo   Run stopPropChain.bat to shut everything down.
echo.
goto :eof

REM ===================================================================
REM :ensure_tunnel <port> <check-mode: rpc|http> <log-basename>
REM Leaves a healthy existing tunnel alone; restarts only if unhealthy.
REM ===================================================================
:ensure_tunnel
set "_PORT=%~1"
set "_MODE=%~2"
set "_BASE=%~3"
set "_URLFILE=%LOGDIR%\%_BASE%_url.txt"
set "_SAVEDURL="
set "_HEALTHY="
if not exist "%_URLFILE%" goto tunnel_start
set /p _SAVEDURL=<"%_URLFILE%"
if not defined _SAVEDURL goto tunnel_start
powershell -NoProfile -File "%TOOLS%\pc-check.ps1" -Url "!_SAVEDURL!" -Mode %_MODE%
if not errorlevel 1 set "_HEALTHY=1"
if not defined _HEALTHY goto tunnel_start

echo         Tunnel for port %_PORT% already healthy - leaving it alone.
if "%_PORT%"=="8545" set "RPC_TUN_URL=!_SAVEDURL!"
if "%_PORT%"=="5173" set "FRONT_TUN_URL=!_SAVEDURL!"
goto :eof

:tunnel_start
echo         Starting a fresh tunnel for port %_PORT%...
powershell -NoProfile -File "%TOOLS%\pc-kill-tunnel.ps1" -Port %_PORT%
set "_LOG=%LOGDIR%\%_BASE%.log"
> "%LOGDIR%\run_tunnel_%_PORT%.bat" echo @echo off
>> "%LOGDIR%\run_tunnel_%_PORT%.bat" echo "%CLOUDFLARED%" tunnel --no-autoupdate --url http://localhost:%_PORT% ^> "%_LOG%" 2^>^&1
start "PropChain Tunnel %_PORT%" /min "%LOGDIR%\run_tunnel_%_PORT%.bat"
set "_NEWURL="
for /l %%i in (1,1,25) do call :poll_tunnel_url "%_LOG%"
if not defined _NEWURL (
  echo         [warn] tunnel URL not detected yet - check "%_LOG%"
  goto :eof
)
> "%_URLFILE%" echo !_NEWURL!
echo         Public URL: !_NEWURL!
if "%_PORT%"=="8545" set "RPC_TUN_URL=!_NEWURL!"
if "%_PORT%"=="5173" set "FRONT_TUN_URL=!_NEWURL!"
goto :eof

:poll_tunnel_url
if defined _NEWURL goto :eof
ping -n 2 127.0.0.1 >nul
for /f "delims=" %%u in ('powershell -NoProfile -Command "(Select-String -Path %1 -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1).Matches.Value"') do set "_NEWURL=%%u"
goto :eof
