#!/usr/bin/env bash
# Local end-to-end run: two anvils stand in for Sepolia (8545) and Creditcoin (8546). The Attestcoin
# precompiles are mocked at 0x0FD2/0x0FD3 with anvil_setCode; everything else — the vault, the
# ledger, the worker, the SDK tx encoding — is the real code. Use it to rehearse the demo offline.
set -euo pipefail
cd "$(dirname "$0")/.."
export WORKER_STATE_FILE=state.e2e.json
rm -f worker/state.e2e.json
trap 'pkill -f "anvil --port 854[56]" 2>/dev/null || true' EXIT
source scripts/local-setup.sh

echo "== circle + round 0 (everyone pays)"
pnpm -s demo fund --members 3
pnpm -s demo create --members 3 --round-blocks 40
pnpm -s demo contribute
pnpm -s worker --once
pnpm -s demo status

echo "== round 1 (member 2 misses; deadline passes on the source chain)"
pnpm -s demo contribute --skip 2
DL=$(cast call --rpc-url $CREDITCOIN_RPC_URL $LEDGER "deadlineHeight(uint256,uint32)(uint64)" 1 1)
cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" 1 "$DL" >/dev/null
pnpm -s worker --once
pnpm -s demo status

echo "== replay attack: re-submitting an already-proven contribution must revert"
pnpm -s tsx worker/src/attack.ts || true

echo "== credit line smoke check: the Kitty Score is *used*, not just displayed"
M0=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # member 0 (anvil #1): 2 on-time
M2=0x90F79bf6EB2c4f870365E785982E1f101E93b906   # member 2 (anvil #3): 1 on-time, 1 missed
LIMIT0=$(cast call --rpc-url $CREDITCOIN_RPC_URL $CREDIT "creditLimit(address)(uint256)" $M0 | cut -d' ' -f1)
LIMIT2=$(cast call --rpc-url $CREDITCOIN_RPC_URL $CREDIT "creditLimit(address)(uint256)" $M2 | cut -d' ' -f1)
echo "member 0 $M0 creditLimit = $LIMIT0 (kUSD, 6 dp)"
echo "  $(cast call --rpc-url $CREDITCOIN_RPC_URL $CREDIT "underwrite(address)(uint16,string,uint256,string)" $M0 | tr '\n' ' ')"
echo "member 2 $M2 creditLimit = $LIMIT2 (kUSD, 6 dp)"
echo "  $(cast call --rpc-url $CREDITCOIN_RPC_URL $CREDIT "underwrite(address)(uint16,string,uint256,string)" $M2 | tr '\n' ' ')"
[ "$LIMIT0" -gt 0 ] || { echo "expected member 0 to have credit" >&2; exit 1; }
echo "== e2e done"
