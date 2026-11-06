# PropChain Classroom helper: kill only the cloudflared.exe tunnel process
# bound to a specific local port -- never touches cloudflared processes
# belonging to other projects (e.g. QuantSave's own tunnel on port 8000).
#   pc-kill-tunnel.ps1 -Port 8545
param(
  [Parameter(Mandatory=$true)][string]$Port
)
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match [regex]::Escape($Port) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
