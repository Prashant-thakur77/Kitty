#!/usr/bin/env bash
# Brings up the two-anvil world with one proven round and LEAVES IT RUNNING (for the dashboard or screenshots).
# Stop it with: pkill -x anvil
set -euo pipefail
cd "$(dirname "$0")/.."
export WORKER_STATE_FILE=state.world.json STEWARD_LOG_FILE=steward.world.json
rm -f worker/state.world.json worker/steward.world.json
pkill -x anvil 2>/dev/null || true
source scripts/local-setup.sh
attest() { cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" "$SOURCE_CHAIN_KEY" "$1" >/dev/null; }
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 60 --rotation score
pnpm -s demo contribute
attest "$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")"
pnpm -s worker --once
pnpm -s demo contribute --skip 2   # round 1: member 2 misses, so the page shows pending + a late/missed state
attest "$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")"
pnpm -s worker --once
echo "== world up (anvils stay running) =="
