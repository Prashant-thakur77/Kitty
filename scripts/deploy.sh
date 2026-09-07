#!/usr/bin/env bash
# Deploys TestUSD + KittyVault to Sepolia and KittyLedger to Creditcoin CC3 Testnet, then writes the
# addresses into .env and web/.env. Requires a funded PRIVATE_KEY (Sepolia ETH + tCTC).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

echo "deployer: $(cast wallet address --private-key "$PRIVATE_KEY")"
echo "sepolia balance:    $(cast balance --ether "$(cast wallet address --private-key "$PRIVATE_KEY")" --rpc-url "$SEPOLIA_RPC_URL") ETH"
echo "creditcoin balance: $(cast balance --ether "$(cast wallet address --private-key "$PRIVATE_KEY")" --rpc-url "$CREDITCOIN_RPC_URL") tCTC"

echo "== Sepolia: TestUSD + KittyVault"
OUT=$(forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --skip-simulation 2>&1 | tee /dev/stderr)
USD=$(echo "$OUT" | grep -oE 'TEST_USD_ADDRESS=0x[0-9a-fA-F]{40}' | cut -d= -f2)
VAULT=$(echo "$OUT" | grep -oE 'KITTY_VAULT_ADDRESS=0x[0-9a-fA-F]{40}' | cut -d= -f2)

echo "== Creditcoin: KittyLedger"
# forge script's fork simulation rejects Creditcoin headers ("prevrandao not set"); forge create sends directly.
OUT2=$(forge create src/asc/KittyLedger.sol:KittyLedger --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --legacy --constructor-args "${SOURCE_CHAIN_KEY:-1}" 2>&1 | tee /dev/stderr)
LEDGER=$(echo "$OUT2" | grep -oE 'Deployed to: 0x[0-9a-fA-F]{40}' | cut -d' ' -f3)
LEDGER_BLOCK=$(cast block-number --rpc-url "$CREDITCOIN_RPC_URL")

upsert() { # file key value
  if grep -q "^$2=" "$1" 2>/dev/null; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}
upsert .env TEST_USD_ADDRESS "$USD"
upsert .env KITTY_VAULT_ADDRESS "$VAULT"
upsert .env KITTY_LEDGER_ADDRESS "$LEDGER"
touch web/.env
upsert web/.env VITE_TEST_USD_ADDRESS "$USD"
upsert web/.env VITE_KITTY_VAULT_ADDRESS "$VAULT"
upsert web/.env VITE_KITTY_LEDGER_ADDRESS "$LEDGER"
upsert web/.env VITE_LEDGER_DEPLOY_BLOCK "$LEDGER_BLOCK"
upsert web/.env VITE_SOURCE_CHAIN_KEY "${SOURCE_CHAIN_KEY:-1}"

cat > deployments.json <<JSON
{
  "sepolia": { "chainId": 11155111, "TestUSD": "$USD", "KittyVault": "$VAULT" },
  "creditcoinTestnet": { "chainId": 102031, "KittyLedger": "$LEDGER", "deployBlock": $LEDGER_BLOCK,
    "BlockProverPrecompile": "0x0000000000000000000000000000000000000FD2",
    "ChainInfoPrecompile": "0x0000000000000000000000000000000000000fD3" },
  "sourceChainKey": ${SOURCE_CHAIN_KEY:-1}
}
JSON
echo; echo "written .env, web/.env, deployments.json"; cat deployments.json
