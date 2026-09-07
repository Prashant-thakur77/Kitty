#!/usr/bin/env bash
# Deploys TestUSD + KittyVault (+ FakeVault) to Sepolia and KittyLedger + KittyViewer + KittyUSD +
# KittyCreditLine (seeded with 50,000 kUSD) + KittyBadge to Creditcoin CC3 Testnet, registers the vault
# as trusted on the ledger, and writes every address to .env, web/.env, web/.env.production and
# deployments.json. Requires a funded PRIVATE_KEY (Sepolia ETH + tCTC).
# Idempotent: every address is persisted to .env the moment it is captured, and any contract whose
# address is already in .env is skipped — rerun after a failure and it picks up where it stopped.
# Use `FORCE_REDEPLOY=ledger scripts/deploy.sh` (comma list of: usd,vault,fake,ledger,viewer,kusd,credit,badge) to redeploy.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
FORCE=",${FORCE_REDEPLOY:-},"

upsert() { # file key value
  if grep -q "^$2=" "$1" 2>/dev/null; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}
addr_from() { echo "$1" | grep -oE "$2 ?0x[0-9a-fA-F]{40}" | head -1 | grep -oE '0x[0-9a-fA-F]{40}'; }
have() { # name key → true if .env already has it and no force
  local key=$2; [[ "$FORCE" == *",$1,"* ]] && return 1; [ -n "${!key:-}" ]
}
cc_create() { # <path:Contract> [constructor args…]   (--constructor-args must be LAST for forge create)
  local target=$1; shift
  local out; out=$(forge create "$target" --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --legacy ${1+--constructor-args "$@"} 2>&1 | tee /dev/stderr)
  addr_from "$out" 'Deployed to:'
}
sep_create() {
  local target=$1; shift
  local out; out=$(forge create "$target" --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast ${1+--constructor-args "$@"} 2>&1 | tee /dev/stderr)
  addr_from "$out" 'Deployed to:'
}
persist() { # KEY value  → .env now, so a later failure loses nothing
  [ -n "$2" ] || { echo "failed to capture $1" >&2; exit 1; }
  upsert .env "$1" "$2"; export "$1=$2"; echo "   $1=$2"
}

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "deployer: $DEPLOYER"
echo "sepolia balance:    $(cast balance --ether "$DEPLOYER" --rpc-url "$SEPOLIA_RPC_URL") ETH"
echo "creditcoin balance: $(cast balance --ether "$DEPLOYER" --rpc-url "$CREDITCOIN_RPC_URL") tCTC"

# ───────────── Sepolia ─────────────
if have usd TEST_USD_ADDRESS; then echo "== TestUSD present: $TEST_USD_ADDRESS"; else
  echo "== Sepolia: TestUSD"; persist TEST_USD_ADDRESS "$(sep_create src/source/TestUSD.sol:TestUSD)"; fi
if have vault KITTY_VAULT_ADDRESS; then echo "== KittyVault present: $KITTY_VAULT_ADDRESS"; else
  echo "== Sepolia: KittyVault (operator = ${OPERATOR_ADDRESS:-$DEPLOYER})"
  persist KITTY_VAULT_ADDRESS "$(sep_create src/source/KittyVault.sol:KittyVault "$TEST_USD_ADDRESS" "${OPERATOR_ADDRESS:-$DEPLOYER}")"; fi
if have fake FAKE_VAULT_ADDRESS; then echo "== FakeVault present: $FAKE_VAULT_ADDRESS"; else
  echo "== Sepolia: FakeVault (demo spoof emitter)"; persist FAKE_VAULT_ADDRESS "$(sep_create src/source/FakeVault.sol:FakeVault)"; fi

# ───────────── Creditcoin ─────────────
# forge script's fork simulation rejects Creditcoin headers ("prevrandao not set"); forge create sends directly.
if have ledger KITTY_LEDGER_ADDRESS; then echo "== KittyLedger present: $KITTY_LEDGER_ADDRESS"; else
  echo "== Creditcoin: KittyLedger"; persist KITTY_LEDGER_ADDRESS "$(cc_create src/asc/KittyLedger.sol:KittyLedger "${SOURCE_CHAIN_KEY:-1}")"
  persist LEDGER_DEPLOY_BLOCK "$(cast block-number --rpc-url "$CREDITCOIN_RPC_URL")"; fi
LEDGER_BLOCK=${LEDGER_DEPLOY_BLOCK:-0}

echo "== Creditcoin: trust the Sepolia vault on the ledger (owner-only allowlist)"
if [ "$(cast call --rpc-url "$CREDITCOIN_RPC_URL" "$KITTY_LEDGER_ADDRESS" "trustedVault(address)(bool)" "$KITTY_VAULT_ADDRESS")" = "true" ]; then echo "   already trusted"; else
  cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --legacy "$KITTY_LEDGER_ADDRESS" "setTrustedVault(address,bool)" "$KITTY_VAULT_ADDRESS" true >/dev/null; echo "   trusted $KITTY_VAULT_ADDRESS"; fi

if have viewer KITTY_VIEWER_ADDRESS; then echo "== KittyViewer present: $KITTY_VIEWER_ADDRESS"; else
  echo "== Creditcoin: KittyViewer"; persist KITTY_VIEWER_ADDRESS "$(cc_create src/asc/KittyViewer.sol:KittyViewer "$KITTY_LEDGER_ADDRESS")"; fi
if have kusd KITTY_USD_ADDRESS; then echo "== KittyUSD present: $KITTY_USD_ADDRESS"; else
  echo "== Creditcoin: KittyUSD (demo liquidity token)"; persist KITTY_USD_ADDRESS "$(cc_create src/asc/KittyUSD.sol:KittyUSD)"; fi
if have credit KITTY_CREDIT_ADDRESS; then echo "== KittyCreditLine present: $KITTY_CREDIT_ADDRESS"; else
  echo "== Creditcoin: KittyCreditLine"; persist KITTY_CREDIT_ADDRESS "$(cc_create src/asc/KittyCreditLine.sol:KittyCreditLine "$KITTY_LEDGER_ADDRESS" "$KITTY_USD_ADDRESS")"
  echo "== Creditcoin: mint 100,000 kUSD to deployer, seed the credit pool with 50,000"
  cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --legacy "$KITTY_USD_ADDRESS" "mint(address,uint256)" "$DEPLOYER" 100000000000 >/dev/null
  cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --legacy "$KITTY_USD_ADDRESS" "approve(address,uint256)" "$KITTY_CREDIT_ADDRESS" 50000000000 >/dev/null
  cast send --rpc-url "$CREDITCOIN_RPC_URL" --private-key "$PRIVATE_KEY" --legacy "$KITTY_CREDIT_ADDRESS" "deposit(uint256)" 50000000000 >/dev/null; fi
echo "credit pool liquidity: $(cast call --rpc-url "$CREDITCOIN_RPC_URL" "$KITTY_CREDIT_ADDRESS" "liquidity()(uint256)") (6 dp)"
if have badge KITTY_BADGE_ADDRESS; then echo "== KittyBadge present: $KITTY_BADGE_ADDRESS"; else
  echo "== Creditcoin: KittyBadge"; persist KITTY_BADGE_ADDRESS "$(cc_create src/asc/KittyBadge.sol:KittyBadge "$KITTY_LEDGER_ADDRESS")"; fi

# ───────────── web env (dev + the committed production file the Pages build uses) ─────────────
for f in web/.env web/.env.production; do
  touch "$f"
  upsert "$f" VITE_TEST_USD_ADDRESS "$TEST_USD_ADDRESS"
  upsert "$f" VITE_KITTY_VAULT_ADDRESS "$KITTY_VAULT_ADDRESS"
  upsert "$f" VITE_FAKE_VAULT_ADDRESS "$FAKE_VAULT_ADDRESS"
  upsert "$f" VITE_KITTY_LEDGER_ADDRESS "$KITTY_LEDGER_ADDRESS"
  upsert "$f" VITE_KITTY_VIEWER_ADDRESS "$KITTY_VIEWER_ADDRESS"
  upsert "$f" VITE_KITTY_USD_ADDRESS "$KITTY_USD_ADDRESS"
  upsert "$f" VITE_KITTY_CREDIT_ADDRESS "$KITTY_CREDIT_ADDRESS"
  upsert "$f" VITE_KITTY_BADGE_ADDRESS "$KITTY_BADGE_ADDRESS"
  upsert "$f" VITE_LEDGER_DEPLOY_BLOCK "$LEDGER_BLOCK"
  upsert "$f" VITE_SOURCE_CHAIN_KEY "${SOURCE_CHAIN_KEY:-1}"
done

cat > deployments.json <<JSON
{
  "sepolia": { "chainId": 11155111, "TestUSD": "$TEST_USD_ADDRESS", "KittyVault": "$KITTY_VAULT_ADDRESS", "FakeVault": "$FAKE_VAULT_ADDRESS" },
  "creditcoinTestnet": { "chainId": 102031, "KittyLedger": "$KITTY_LEDGER_ADDRESS", "KittyViewer": "$KITTY_VIEWER_ADDRESS",
    "KittyUSD": "$KITTY_USD_ADDRESS", "KittyCreditLine": "$KITTY_CREDIT_ADDRESS", "KittyBadge": "$KITTY_BADGE_ADDRESS", "deployBlock": $LEDGER_BLOCK,
    "BlockProverPrecompile": "0x0000000000000000000000000000000000000FD2",
    "ChainInfoPrecompile": "0x0000000000000000000000000000000000000fD3" },
  "sourceChainKey": ${SOURCE_CHAIN_KEY:-1}
}
JSON
echo; echo "written .env, web/.env, web/.env.production, deployments.json — commit web/.env.production + deployments.json"; cat deployments.json
