#!/usr/bin/env bash
# Local end-to-end run: two anvils stand in for Sepolia (8545) and Creditcoin (8546). The Attestcoin
# precompiles are mocked at 0x0FD2/0x0FD3 with anvil_setCode; everything else — the vault, the
# ledger, the worker, the SDK tx encoding — is the real code. Use it to rehearse the demo offline.
set -euo pipefail
cd "$(dirname "$0")/.."
export KITTY_MODE=local
export SEPOLIA_RPC_URL=http://127.0.0.1:8545
export CREDITCOIN_RPC_URL=http://127.0.0.1:8546
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0
export SOURCE_CHAIN_KEY=1
export WORKER_STATE_FILE=state.e2e.json
rm -f worker/state.e2e.json

pkill -f "anvil --port 854[56]" 2>/dev/null || true
anvil --port 8545 --chain-id 11155111 --block-time 1 --silent &
anvil --port 8546 --chain-id 102031 --block-time 1 --silent &
trap 'pkill -f "anvil --port 854[56]" 2>/dev/null || true' EXIT
sleep 2

echo "== deploy"
forge build >/dev/null
USD=$(forge create src/source/TestUSD.sol:TestUSD --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3)
OP=$(cast wallet address --private-key $PRIVATE_KEY)
VAULT=$(forge create src/source/KittyVault.sol:KittyVault --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --constructor-args "$USD" "$OP" | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3)
FAKE=$(forge create src/source/FakeVault.sol:FakeVault --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3)
LEDGER=$(forge create src/asc/KittyLedger.sol:KittyLedger --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY --broadcast --constructor-args 1 | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3)
VIEWER=$(forge create src/asc/KittyViewer.sol:KittyViewer --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY --broadcast --constructor-args "$LEDGER" | grep -oE 'Deployed to: 0x[0-9a-fA-F]+' | cut -d' ' -f3)
export TEST_USD_ADDRESS=$USD KITTY_VAULT_ADDRESS=$VAULT FAKE_VAULT_ADDRESS=$FAKE KITTY_LEDGER_ADDRESS=$LEDGER KITTY_VIEWER_ADDRESS=$VIEWER
echo "TestUSD $USD · KittyVault $VAULT · FakeVault $FAKE · KittyLedger $LEDGER · KittyViewer $VIEWER"

echo "== mock precompiles on the Creditcoin anvil"
VCODE=$(forge inspect MockVerifier deployedBytecode)
CCODE=$(forge inspect MockChainInfo deployedBytecode)
cast rpc --rpc-url $CREDITCOIN_RPC_URL anvil_setCode 0x0000000000000000000000000000000000000FD2 "$VCODE" >/dev/null
cast rpc --rpc-url $CREDITCOIN_RPC_URL anvil_setCode 0x0000000000000000000000000000000000000fD3 "$CCODE" >/dev/null
cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000FD2 "setAccept(bool)" true >/dev/null

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
echo "== e2e done"
