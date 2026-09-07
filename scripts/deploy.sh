#!/usr/bin/env bash
# Deploys TestUSD + KittyVault (+ FakeVault) to Sepolia and KittyLedger + KittyViewer to Creditcoin CC3
# Testnet, then writes the addresses into .env, web/.env and deployments.json. Requires a funded
# PRIVATE_KEY (Sepolia ETH + tCTC). Idempotent for Sepolia: if KITTY_VAULT_ADDRESS is already set in
# .env, TestUSD/KittyVault are NOT redeployed (only FakeVault is).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

upsert() { # file key value
  if grep -q "^$2=" "$1" 2>/dev/null; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}
addr_from() { # output regex-prefix   → first 0x… address after the prefix
  echo "$1" | grep -oE "$2 ?0x[0-9a-fA-F]{40}" | head -1 | grep -oE '0x[0-9a-fA-F]{40}'
}

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "deployer: $DEPLOYER"
echo "sepolia balance:    $(cast balance --ether "$DEPLOYER" --rpc-url "$SEPOLIA_RPC_URL") ETH"
echo "creditcoin balance: $(cast balance --ether "$DEPLOYER" --rpc-url "$CREDITCOIN_RPC_URL") tCTC"

# ───────────── Sepolia ─────────────
if [ -n "${KITTY_VAULT_ADDRESS:-}" ] && [ -n "${TEST_USD_ADDRESS:-}" ]; then
  echo "== Sepolia: TestUSD + KittyVault already deployed (KITTY_VAULT_ADDRESS set) — skipping"
  USD=$TEST_USD_ADDRESS
  VAULT=$KITTY_VAULT_ADDRESS
else
  echo "== Sepolia: TestUSD + KittyVault"
  OUT=$(forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --skip-simulation 2>&1 | tee /dev/stderr)
  USD=$(addr_from "$OUT" 'TEST_USD_ADDRESS=')
  VAULT=$(addr_from "$OUT" 'KITTY_VAULT_ADDRESS=')
fi

echo "== Sepolia: FakeVault (demo spoof emitter)"
OUTF=$(forge script script/DeployFakeVault.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --skip-simulation 2>&1 | tee /dev/stderr)
FAKE=$(addr_from "$OUTF" 'FAKE_VAULT_ADDRESS=')

# ───────────── Creditcoin ─────────────
# forge script's fork simulation rejects Creditcoin headers ("prevrandao not set"); forge create sends directly.
# NOTE: --constructor-args must be LAST — forge create consumes every argument after it.
echo "== Creditcoin: KittyLedger"
OUT2=$(forge create src/asc/KittyLedger.sol:KittyLedger --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --legacy --constructor-args "${SOURCE_CHAIN_KEY:-1}" 2>&1 | tee /dev/stderr)
LEDGER=$(addr_from "$OUT2" 'Deployed to:')
LEDGER_BLOCK=$(cast block-number --rpc-url "$CREDITCOIN_RPC_URL")

echo "== Creditcoin: KittyViewer"
OUT3=$(forge create src/asc/KittyViewer.sol:KittyViewer --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --legacy --constructor-args "$LEDGER" 2>&1 | tee /dev/stderr)
VIEWER=$(addr_from "$OUT3" 'Deployed to:')

for v in USD VAULT FAKE LEDGER VIEWER; do
  [ -n "${!v}" ] || { echo "failed to capture $v address" >&2; exit 1; }
done

# ───────────── write env files ─────────────
upsert .env TEST_USD_ADDRESS "$USD"
upsert .env KITTY_VAULT_ADDRESS "$VAULT"
upsert .env FAKE_VAULT_ADDRESS "$FAKE"
upsert .env KITTY_LEDGER_ADDRESS "$LEDGER"
upsert .env KITTY_VIEWER_ADDRESS "$VIEWER"
touch web/.env
upsert web/.env VITE_TEST_USD_ADDRESS "$USD"
upsert web/.env VITE_KITTY_VAULT_ADDRESS "$VAULT"
upsert web/.env VITE_FAKE_VAULT_ADDRESS "$FAKE"
upsert web/.env VITE_KITTY_LEDGER_ADDRESS "$LEDGER"
upsert web/.env VITE_KITTY_VIEWER_ADDRESS "$VIEWER"
upsert web/.env VITE_LEDGER_DEPLOY_BLOCK "$LEDGER_BLOCK"
upsert web/.env VITE_SOURCE_CHAIN_KEY "${SOURCE_CHAIN_KEY:-1}"

cat > deployments.json <<JSON
{
  "sepolia": { "chainId": 11155111, "TestUSD": "$USD", "KittyVault": "$VAULT", "FakeVault": "$FAKE" },
  "creditcoinTestnet": { "chainId": 102031, "KittyLedger": "$LEDGER", "KittyViewer": "$VIEWER", "deployBlock": $LEDGER_BLOCK,
    "BlockProverPrecompile": "0x0000000000000000000000000000000000000FD2",
    "ChainInfoPrecompile": "0x0000000000000000000000000000000000000fD3" },
  "sourceChainKey": ${SOURCE_CHAIN_KEY:-1}
}
JSON
echo; echo "written .env, web/.env, deployments.json"; cat deployments.json
