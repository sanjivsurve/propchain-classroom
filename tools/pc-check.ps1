# PropChain Classroom helper: health-check a local service or tunnel URL.
# Exit 0 = healthy, exit 1 = not reachable / not healthy.
#   pc-check.ps1 -Url http://localhost:8545 -Mode rpc    (POSTs eth_chainId, expects a result)
#   pc-check.ps1 -Url http://localhost:5173 -Mode http   (GETs, expects HTTP 200)
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [string]$Mode = "http",
  [int]$TimeoutSec = 5
)
try {
  if ($Mode -eq "rpc") {
    $body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
    $r = Invoke-RestMethod -Uri $Url -Method Post -Body $body -ContentType "application/json" -TimeoutSec $TimeoutSec
    if ($r.result) { exit 0 } else { exit 1 }
  } else {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
    if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 }
  }
} catch {
  exit 1
}
