#!/usr/bin/env bash
# Runs every attack-lab scenario against the local two-anvil world and exits with the tally.
# Same setup as local-lab.sh, minus the API server, so it terminates and can run in CI.
set -euo pipefail
cd "$(dirname "$0")/.."
export WORKER_STATE_FILE=state.scenarios.json
export STEWARD_LOG_FILE=steward.scenarios.json
rm -f worker/state.scenarios.json worker/steward.scenarios.json
trap 'pkill -x anvil 2>/dev/null || true' EXIT
pkill -x anvil 2>/dev/null || true
source scripts/local-setup.sh

# The attestor network catches up with the source chain; the steward will not prove an unattested block.
attest() { cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" 0x0000000000000000000000000000000000000fD3 \
  "setAttestedHeight(uint64,uint64)" "$SOURCE_CHAIN_KEY" "$1" >/dev/null; }

echo "== circle + round 0, proven in one batch"
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 40
pnpm -s demo contribute
attest "$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")"
pnpm -s worker --once

echo "== attack lab: all scenarios"
attest "$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")"
RESULTS=()
FAILED=0
for s in replay wrongChain revertedTx late spoofEmitter stealFromSteward fireTheAgent poisonReasoning; do
  attest "$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")"
  if pnpm -s scenario "$s"; then RESULTS+=("PASS $s"); else RESULTS+=("FAIL $s"); FAILED=$((FAILED + 1)); fi
done
echo; echo "== results"; printf '  %s\n' "${RESULTS[@]}"
echo "== ${#RESULTS[@]} scenarios, $FAILED failed"
exit $FAILED
