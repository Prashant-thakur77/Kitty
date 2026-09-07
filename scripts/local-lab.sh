#!/usr/bin/env bash
# Local attack lab: the same two-anvil setup as scripts/local-e2e.sh (Sepolia on 8545, Creditcoin on
# 8546, Attestcoin precompiles mocked with anvil_setCode), one circle with round 0 fully proven, then
# every attack scenario is run once (PASS/FAIL printed) and the lab API (pnpm lab:api, :8790) is kept
# in the foreground for the /lab page until Ctrl-C. The anvils stay up for as long as the API runs.
set -euo pipefail
cd "$(dirname "$0")/.."
export KITTY_MODE=local
export SEPOLIA_RPC_URL=http://127.0.0.1:8545
export CREDITCOIN_RPC_URL=http://127.0.0.1:8546
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0
export SOURCE_CHAIN_KEY=1
export WORKER_STATE_FILE=state.lab.json
export PORT="${PORT:-8790}"
rm -f worker/state.lab.json

cleanup() { pkill -f "tsx worker/src/api.ts" 2>/dev/null || true; pkill -f "anvil --port 854[56]" 2>/dev/null || true; }
pkill -f "anvil --port 854[56]" 2>/dev/null || true
anvil --port 8545 --chain-id 11155111 --block-time 1 --silent &
anvil --port 8546 --chain-id 102031 --block-time 1 --silent &
trap cleanup EXIT INT TERM
sleep 2

deploy() { # <rpc> <path:Contract> [constructor args…]
  local rpc=$1 target=$2; shift 2
  forge create "$target" --rpc-url "$rpc" --private-key "$PRIVATE_KEY" --broadcast ${1+--constructor-args "$@"} 2>/dev/null \
    | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3
}

echo "== deploy"
forge build >/dev/null
USD=$(deploy "$SEPOLIA_RPC_URL" src/source/TestUSD.sol:TestUSD)
OP=$(cast wallet address --private-key "$PRIVATE_KEY")
VAULT=$(deploy "$SEPOLIA_RPC_URL" src/source/KittyVault.sol:KittyVault "$USD" "$OP")
LEDGER=$(deploy "$CREDITCOIN_RPC_URL" src/asc/KittyLedger.sol:KittyLedger 1)
export TEST_USD_ADDRESS=$USD KITTY_VAULT_ADDRESS=$VAULT KITTY_LEDGER_ADDRESS=$LEDGER
echo "TestUSD $USD · KittyVault $VAULT · KittyLedger $LEDGER"

# Optional contracts other engineers are adding; deployed when present in src/.
if [ -f src/asc/KittyViewer.sol ]; then
  VIEWER=$(deploy "$CREDITCOIN_RPC_URL" src/asc/KittyViewer.sol:KittyViewer "$LEDGER" || deploy "$CREDITCOIN_RPC_URL" src/asc/KittyViewer.sol:KittyViewer || true)
  [ -n "${VIEWER:-}" ] && export KITTY_VIEWER_ADDRESS=$VIEWER && echo "KittyViewer $VIEWER" || echo "KittyViewer present but could not deploy (constructor args?) — skipped"
fi
if [ -z "${FAKE_VAULT_ADDRESS:-}" ] && [ -f src/source/FakeVault.sol ]; then
  FAKE=$(deploy "$SEPOLIA_RPC_URL" src/source/FakeVault.sol:FakeVault || deploy "$SEPOLIA_RPC_URL" src/source/FakeVault.sol:FakeVault "$USD" || true)
  [ -n "${FAKE:-}" ] && export FAKE_VAULT_ADDRESS=$FAKE && echo "FakeVault $FAKE" || echo "FakeVault present but could not deploy — spoofEmitter skipped"
fi

echo "== mock precompiles on the Creditcoin anvil"
VCODE=$(forge inspect MockVerifier deployedBytecode)
CCODE=$(forge inspect MockChainInfo deployedBytecode)
cast rpc --rpc-url "$CREDITCOIN_RPC_URL" anvil_setCode 0x0000000000000000000000000000000000000FD2 "$VCODE" >/dev/null
cast rpc --rpc-url "$CREDITCOIN_RPC_URL" anvil_setCode 0x0000000000000000000000000000000000000fD3 "$CCODE" >/dev/null
cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" 0x0000000000000000000000000000000000000FD2 "setAccept(bool)" true >/dev/null

echo "== circle + round 0 (everyone pays, proven in one batch, round 1 opens)"
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 40
pnpm -s demo contribute
pnpm -s worker --once
pnpm -s demo status

echo "== attack lab"
RESULTS=()
for s in replay wrongChain revertedTx late ${FAKE_VAULT_ADDRESS:+spoofEmitter}; do
  echo "-- $s"
  if pnpm -s scenario "$s"; then RESULTS+=("PASS $s"); else RESULTS+=("FAIL $s"); fi
done
[ -z "${FAKE_VAULT_ADDRESS:-}" ] && RESULTS+=("SKIP spoofEmitter (no FAKE_VAULT_ADDRESS / src/source/FakeVault.sol)")
echo "== lab results"; printf '  %s\n' "${RESULTS[@]}"

echo "== lab api on :$PORT (anvils stay up; Ctrl-C to stop everything)"
pnpm lab:api
