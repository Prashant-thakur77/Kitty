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

echo "== circle + round 0 (everyone pays, proven in one batch, round 1 opens)"
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 40
pnpm -s demo contribute
pnpm -s worker --once
pnpm -s demo status

echo "== attack lab"
RESULTS=()
for s in replay wrongChain revertedTx late spoofEmitter; do
  echo "-- $s"
  if pnpm -s scenario "$s"; then RESULTS+=("PASS $s"); else RESULTS+=("FAIL $s"); fi
done
echo "== lab results"; printf '  %s\n' "${RESULTS[@]}"

echo "== lab api on :$PORT (anvils stay up; Ctrl-C to stop everything)"
pnpm lab:api
