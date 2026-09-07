# 🐈 Kitty — proof-settled savings circles

**Savings circles where every payment is proven, not promised.**
Rotating savings (chit funds, susu, tandas, chamas) on Ethereum stablecoins, settled and
credit-scored on Creditcoin through the **Attestcoin Protocol** — no treasurer, no oracle operator,
no bridge.

Built for **BUIDL CTC 2026 Fall** (DeFi track). Integration write-up: [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md).

## 60-second version

1. A group creates a circle on Creditcoin: members, installment, round length *in Sepolia blocks*.
2. Each round, members pay the installment into a tiny escrow vault on Ethereum Sepolia.
3. A worker waits for the attestor network to attest those Sepolia blocks, fetches **one batch
   proof** for the whole round from the Attestcoin Proof Builder, and submits it.
4. `KittyLedger` asks the block-prover precompile (`0x0FD2`) to verify all payments in **one call**,
   decodes each receipt/calldata with `EvmV1Decoder`, and records who paid on time, late, or not at all.
5. The round closes when everyone has paid, or when the deadline block is **attested** on
   Creditcoin (`0x0FD3` is the clock). The rotation recipient is deterministic.
6. The vault pays out on Ethereum; that payout is proven back so the round only shows "Paid" for
   money that verifiably moved.
7. Every member accrues a **Kitty Score** built solely from proven transactions and attested
   deadlines — credit history a Creditcoin lender can underwrite against.

```
Sepolia: TestUSD · KittyVault ──Contributed/PaidOut──▶ attestors ──▶ Proof Builder ──▶ worker
Creditcoin: KittyLedger ──verifyAndEmit(batch)──▶ 0x0FD2 · is_height_attested ──▶ 0x0FD3
```

## Live deployment (CC3 Testnet + Sepolia)

See [`deployments.json`](deployments.json) after running `scripts/deploy.sh`.

| | address |
|---|---|
| KittyLedger (Creditcoin CC3 Testnet, 102031) | _fill after deploy_ |
| KittyVault (Sepolia, chainKey 1) | _fill after deploy_ |
| TestUSD (Sepolia) | _fill after deploy_ |

## Quick start

```bash
pnpm install                 # worker + SDK deps (@gluwa/usc-sdk, @gluwa/asc-contracts, ethers)
forge test                   # 27 tests; precompiles mocked at 0x0FD2 / 0x0FD3
pnpm e2e:local               # two anvils, mocked precompiles, real worker + SDK encoding, 2 rounds + replay attack
```

Testnet:

```bash
cp .env.example .env         # fill PRIVATE_KEY (needs Sepolia ETH + tCTC)
scripts/deploy.sh            # deploys both sides, writes .env / web/.env / deployments.json
pnpm demo fund               # give 3 demo members ETH + tUSD
pnpm demo create             # circle on Creditcoin (3 members, 100 tUSD, 60 Sepolia blocks/round)
pnpm demo contribute         # members pay round 0 on Sepolia
pnpm worker                  # waits for attestation → batch proof → recordContributions → closeRound → payout → confirmPayout
pnpm demo status             # ledger view
pnpm web:dev                 # dashboard at http://localhost:5173
```

Faucets: Sepolia ETH — https://www.alchemy.com/faucets/ethereum-sepolia · tCTC — Creditcoin Discord
`#token-faucet` (https://discord.gg/Gu43zTfmtc) or https://thirdweb.com/creditcoin-testnet.

## Repository

```
src/source/KittyVault.sol      Sepolia escrow; emits Contributed / PaidOut (minimal by design)
src/asc/KittyLedger.sol        Creditcoin ASC: batch verify, decode, chain/emitter/calldata binding, deadlines, rotation, score
src/interfaces/IChainInfo.sol  0x0FD3 precompile subset
test/                          Foundry tests + precompile mocks + prover-format tx fixtures
worker/                        TypeScript worker (usc-sdk ProofBuilder), demo driver, replay-attack demo
web/                           Vite + React + wagmi dashboard (proof feed, rotation, scores, contribute/close)
scripts/                       deploy.sh · local-e2e.sh
docs/                          STRATEGY · BUILD_PLAN · SUBMISSION · ATTESTCOIN_INTEGRATION
```

## Security model — what is proven vs. what is operated

| Claim | Backed by |
|---|---|
| Member X paid round R | Proof verified by 0x0FD2; receipt status 1; log from the registered vault; tx `to`=vault, `from`=member |
| Payment was on time | Proven source block height ≤ deadline height |
| Member Y missed round R | Deadline height attested (0x0FD3) and no proven payment |
| Recipient Z was paid | `PaidOut` proven by 0x0FD2 with matching recipient and amount |
| Same proof can't count twice | Query id (chainKey ‖ height ‖ txIndex) + per-(circle, round, member) guard |
| Proof from another chain can't count | `chainKey` pinned at deployment |

The only operated step is *sending* the payout on Ethereum (vault operator key). The ledger never
trusts that it happened — it waits for the proof. Attestcoin writability (Creditcoin → Ethereum) is
the natural replacement once it is audited; the vault already exposes the exact call to wire up.

## Roadmap
Score-gated circle sizes · seat bidding for early payout · ERC-5192 Kitty Score badge · pot cover
via proven-event insurance · Ethereum mainnet chainKey on CC3 mainnet.

## License
MIT
