#!/bin/bash
# PropChain Classroom — stop the Hardhat node, frontend dev server, and
# both Cloudflare tunnels started by startPropChain.sh.
#
# Only kills processes bound to ports 8545/5173, and only the cloudflared
# tunnels pointed at those ports — never touches the separate QuantSave
# app or its own tunnel on port 8000.

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$ROOT/logs"

echo "  Stopping PropChain Classroom..."

lsof -ti:8545 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
pkill -f "cloudflared tunnel.*:8545" 2>/dev/null
pkill -f "cloudflared tunnel.*:5173" 2>/dev/null

rm -f "$LOGDIR/pc_tunnel_rpc_url.txt" "$LOGDIR/pc_tunnel_front_url.txt" "$LOGDIR/pc_student_link.txt"

echo "  ✅ Done. Hardhat node, frontend, and both tunnels are stopped."
