#!/usr/bin/env bash
# Local attack lab: the same two-anvil setup as scripts/local-e2e.sh (Sepolia on 8545, Creditcoin on
# 8546, Attestcoin precompiles mocked with anvil_setCode), one circle with round 0 fully proven, then
# every attack scenario is run once (PASS/FAIL printed) and the lab API (pnpm lab:api, :8790) is kept
# in the foreground for the /lab page until Ctrl-C. The anvils stay up for as long as the API runs.
set -euo pipefail
cd "$(dirname "$0")/.."
export WORKER_STATE_FILE=state.lab.json
rm -f worker/state.lab.json
cleanup() { pkill -f "tsx worker/src/api.ts" 2>/dev/null || true; pkill -f "anvil --port 854[56]" 2>/dev/null || true; }
pkill -f "tsx worker/src/api.ts" 2>/dev/null || true   # a stale lab API from an earlier run would hold the port
trap cleanup EXIT INT TERM
source scripts/local-setup.sh

# The attestor network catches up with the source chain. The steward will not prove a payment whose
# block is not attested yet, so the mocked 0x0FD3 frontier has to move the way the real one does.
attest() { cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 \
  "setAttestedHeight(uint64,uint64)" 1 "$1" >/dev/null; echo "   attested source chain up to block $1"; }

echo "== circle + round 0 (everyone pays, proven in one batch, round 1 opens)"
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 40
pnpm -s demo contribute
attest "$(cast block-number --rpc-url $SEPOLIA_RPC_URL)"
pnpm -s worker --once
pnpm -s demo status

echo "== attack lab"
attest "$(cast block-number --rpc-url $SEPOLIA_RPC_URL)"
RESULTS=()
for s in replay wrongChain revertedTx late spoofEmitter stealFromSteward fireTheAgent poisonReasoning; do
  echo "-- $s"
  if pnpm -s scenario "$s"; then RESULTS+=("PASS $s"); else RESULTS+=("FAIL $s"); fi
done
echo "== lab results"; printf '  %s\n' "${RESULTS[@]}"

echo "== lab api on :$PORT (anvils stay up; Ctrl-C to stop everything)"
pnpm lab:api
