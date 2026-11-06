#!/bin/bash
# PropChain Classroom — start the Hardhat node, deploy demo contracts,
# and start the frontend dev server. One script instead of 3 terminals.
#
#   ./startPropChain.sh              local only   http://localhost:5173 (+ :8545 RPC)
#   ./startPropChain.sh --tunnel     + a Cloudflare quick tunnel for EACH localhost
#                                    above, and prints a ready-to-share student link
#                                    (frontend tunnel URL + ?rpc=<rpc tunnel URL>)
#
# Safe to re-run: anything already up and healthy is left alone (no restart,
# no fresh tunnel URL, no chain wipe). Only what's missing or unhealthy gets
# (re)started.
#
# Env overrides: PC_TUNNEL=1 same as --tunnel ; CLOUDFLARED=/path/to/cloudflared
# Logs + state:  logs/pc_*.log , logs/pc_tunnel_*_url.txt , logs/pc_student_link.txt
# (all git-ignored — delete anything in logs/ whenever you like)

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
BLOCKCHAIN="$ROOT/blockchain"
FRONTEND="$ROOT/frontend"
LOGDIR="$ROOT/logs"
DEPLOYMENT_JSON="$FRONTEND/src/contracts/deployment.json"
mkdir -p "$LOGDIR"
CLOUDFLARED="${CLOUDFLARED:-cloudflared}"

TUNNEL=0
[ "${1:-}" = "--tunnel" ] && TUNNEL=1
[ "$TUNNEL" = "0" ] && [ "${PC_TUNNEL:-0}" = "1" ] && TUNNEL=1

echo ""
echo "  PropChain Classroom — Starting..."
echo ""

check_rpc()  { curl -s -m 5 -X POST -H "Content-Type: application/json" \
                 --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' "$1" \
                 2>/dev/null | grep -q '"result"'; }
check_http() { [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ]; }

# --- 1. Hardhat node (port 8545) ---
echo "  [1/3] Hardhat node (localhost:8545)..."
HARDHAT_FRESH=0
if check_rpc "http://localhost:8545"; then
  echo "        Already running — leaving it alone."
else
  echo "        Not running — clearing port and starting a fresh node..."
  lsof -ti:8545 | xargs kill -9 2>/dev/null
  ( cd "$BLOCKCHAIN" && npm run node:shared > "$LOGDIR/pc_hardhat.log" 2>&1 & )
  HARDHAT_FRESH=1
  for _ in $(seq 1 30); do check_rpc "http://localhost:8545" && break; sleep 1; done
  if ! check_rpc "http://localhost:8545"; then
    echo "        [error] Hardhat node did not come up in time — check $LOGDIR/pc_hardhat.log"
    exit 1
  fi
  echo "        Hardhat node is up (fresh chain)."
fi

# --- 2. Deploy demo contracts (only when needed) ---
NEED_DEPLOY=0
[ "$HARDHAT_FRESH" = "1" ] && NEED_DEPLOY=1
[ -f "$DEPLOYMENT_JSON" ] || NEED_DEPLOY=1
if [ "$NEED_DEPLOY" = "1" ]; then
  echo "  [2/3] Deploying demo contracts..."
  ( cd "$BLOCKCHAIN" && npm run deploy:shared )
else
  echo "  [2/3] Contracts already deployed on the running chain — skipping."
fi

# --- 3. Frontend dev server (port 5173) ---
echo "  [3/3] Frontend dev server (localhost:5173)..."
if check_http "http://localhost:5173"; then
  echo "        Already running — leaving it alone."
else
  echo "        Not running — clearing port and starting Vite..."
  lsof -ti:5173 | xargs kill -9 2>/dev/null
  ( cd "$FRONTEND" && npm run dev -- --host 0.0.0.0 > "$LOGDIR/pc_frontend.log" 2>&1 & )
  for _ in $(seq 1 30); do check_http "http://localhost:5173" && break; sleep 1; done
  if ! check_http "http://localhost:5173"; then
    echo "        [error] Vite did not come up in time — check $LOGDIR/pc_frontend.log"
    exit 1
  fi
  echo "        Frontend is up."
fi

# --- 4. Cloudflare tunnels (optional, one per localhost) ---
RPC_TUN_URL=""
FRONT_TUN_URL=""
ensure_tunnel() {
  local port="$1" mode="$2" base="$3" urlfile checker saved newurl
  urlfile="$LOGDIR/${base}_url.txt"
  [ "$mode" = "rpc" ] && checker=check_rpc || checker=check_http
  if [ -f "$urlfile" ]; then
    saved="$(cat "$urlfile")"
    if [ -n "$saved" ] && $checker "$saved"; then
      echo "        Tunnel for port $port already healthy — leaving it alone."
      echo "$saved"
      return 0
    fi
  fi
  echo "        Starting a fresh tunnel for port $port..." >&2
  pkill -f "cloudflared tunnel.*:$port" 2>/dev/null
  local log="$LOGDIR/${base}.log"
  "$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:$port" > "$log" 2>&1 &
  for _ in $(seq 1 25); do
    newurl=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | head -1)
    [ -n "$newurl" ] && break
    sleep 1
  done
  if [ -n "$newurl" ]; then
    echo "$newurl" > "$urlfile"
    echo "        Public URL: $newurl" >&2
    echo "$newurl"
  else
    echo "        [warn] tunnel URL not detected yet — check $log" >&2
  fi
}

if [ "$TUNNEL" = "1" ]; then
  if ! command -v "$CLOUDFLARED" &>/dev/null; then
    echo "  [warn] cloudflared not found on PATH — set CLOUDFLARED=/path/to/cloudflared — skipping tunnels"
  else
    RPC_TUN_URL="$(ensure_tunnel 8545 rpc  pc_tunnel_rpc)"
    FRONT_TUN_URL="$(ensure_tunnel 5173 http pc_tunnel_front)"
    if [ -n "$RPC_TUN_URL" ] && [ -n "$FRONT_TUN_URL" ]; then
      echo "${FRONT_TUN_URL}?rpc=${RPC_TUN_URL}" > "$LOGDIR/pc_student_link.txt"
    fi
  fi
fi

echo ""
echo "  -----------------------------------------------------------"
echo "   Hardhat RPC:   http://localhost:8545"
echo "   Frontend:      http://localhost:5173"
[ -n "$RPC_TUN_URL" ]   && echo "   RPC tunnel:    $RPC_TUN_URL"
[ -n "$FRONT_TUN_URL" ] && echo "   App tunnel:    $FRONT_TUN_URL"
if [ -f "$LOGDIR/pc_student_link.txt" ]; then
  echo ""
  echo "   Student link (copy/paste — works from any remote browser):"
  cat "$LOGDIR/pc_student_link.txt"
fi
echo "  -----------------------------------------------------------"
echo "  Logs: $LOGDIR"
echo "  Run ./stopPropChain.sh to shut everything down."
echo ""
