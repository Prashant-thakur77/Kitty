#!/usr/bin/env bash
# One command for judges: contract tests → agent unit tests → attack scenarios → local two-anvil
# rehearsal (real worker, real SDK encoding, mocked precompiles) → a real Sepolia proof verified by
# the LIVE 0x0FD2 precompile on CC3 Testnet. Needs no .env; the last step needs internet.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "══ 1/5 forge test"; forge test 2>&1 | grep -E "^Ran .* suites|FAIL"
echo "══ 2/5 agent unit tests (batch policy + citation validator)"; pnpm -s test:agent | grep -E "^# (pass|fail)"
echo "══ 3/5 attack scenarios (~5 min)"; pnpm -s scenarios | tail -3
echo "══ 4/5 local end-to-end rehearsal (~5 min)"; bash scripts/local-e2e.sh 2>&1 | grep -E "✓ verified|✓ round|✓ payout proven|MISSED|PASS replay|creditLimit|e2e done"
echo "══ 5/5 live precompile: real proof → 0x0FD2.verify on Creditcoin CC3 Testnet"
if ! pnpm -s verify:live 0x9e77a48510f253f834af4538b463a127e3d41bbd23f935b3e12d379c0f5680b8 0x693dfb700f563bfbf41647ea73a3e8e50f3fe18bcf005c7185a355664f9924b3 0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d; then
  echo "live check skipped: needs internet (prover.cc3-testnet, rpc.cc3-testnet)"
fi
echo "══ done"
