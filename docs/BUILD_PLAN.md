# Kitty — build plan

## Architecture

```
 Ethereum Sepolia (source chain, chainKey 1 on CC3 Testnet)          Creditcoin CC3 Testnet (chainId 102031)
 ┌──────────────────────────────┐                                   ┌────────────────────────────────────────┐
 │ TestUSD (ERC-20, 6 dp)       │                                   │ KittyLedger (ASC)                      │
 │ KittyVault                   │   Contributed(circle,round,       │  createCircle / closeRound             │
 │   contribute() ── escrow ──▶ │   member,amount)                  │  recordContributions(batch ≤10) ──────┐│
 │   payout()  (operator) ────▶ │   PaidOut(circle,round,           │  confirmPayout(single)                ││
 └──────────────┬───────────────┘   recipient,amount)               │  creditScore()                        ││
                │ events                                            └──────────┬─────────────────┬──────────┘│
                ▼                                                              │                 │           │
        ┌───────────────┐  wait attestation  ┌──────────────────┐   verifyAndEmit(batch)  is_height_attested │
        │ worker (tsx)  │ ─────────────────▶ │ Proof Builder API│   ┌──────────▼───────┐ ┌───────▼────────┐  │
        │ @gluwa/usc-sdk│ ◀── batch proof ── │ prover.cc3-…     │   │ 0x0FD2 BlockProver│ │ 0x0FD3 ChainInfo│  │
        └───────┬───────┘                    └──────────────────┘   └──────────────────┘ └────────────────┘  │
                └──────────── recordContributions / closeRound / payout / confirmPayout ──────────────────────┘
                                                        ▲
                                             React + wagmi dashboard (reads both chains, writes contribute/closeRound)
```

## Folder structure

```
kitty/
├─ foundry.toml               solc 0.8.30, via_ir, remaps @gluwa/asc-contracts + @openzeppelin from node_modules
├─ src/
│  ├─ source/KittyVault.sol   Sepolia escrow + events (minimal by design)
│  ├─ source/TestUSD.sol      6-dp demo stablecoin
│  ├─ asc/KittyLedger.sol     Creditcoin ASC: batch verify, decode, deadlines, rotation, credit score
│  └─ interfaces/IChainInfo.sol   0x0FD3 precompile subset
├─ test/                      27 Foundry tests, precompiles mocked at 0x0FD2 / 0x0FD3 via vm.etch
├─ script/                    DeploySepolia.s.sol, DeployCreditcoin.s.sol
├─ worker/                    TypeScript off-chain worker + demo driver (usc-sdk ProofBuilder)
├─ web/                       Vite + React + wagmi + Tailwind dashboard
├─ scripts/                   deploy.sh, local-e2e.sh (two anvils + mocked precompiles)
└─ docs/                      STRATEGY, BUILD_PLAN, SUBMISSION, ATTESTCOIN_INTEGRATION
```

## Tech choices (reusing what's already on this machine)
- **Foundry 1.7** for contracts/tests/scripts (installed). `@gluwa/asc-contracts@0.2.1` for
  `INativeQueryVerifier` + `EvmV1Decoder`; `@openzeppelin/contracts@5.4.0`.
- **@gluwa/usc-sdk@0.18** + **ethers v6** + **tsx** for the worker (same stack as the official
  examples, so reviewers recognise it instantly).
- **Vite + React + wagmi/viem + Tailwind v4** for the dashboard (matches prior projects: tapflow/gdg).
- **pnpm** workspace-less: root package.json for worker deps, `web/` has its own.

## Feature list

**MVP (must work end to end)**
1. Create circle (members, installment, round length in Sepolia blocks, vault binding).
2. Members contribute on Sepolia → events.
3. Worker: group by (circle, round) → wait attestation → **batch proof** → `recordContributions`.
4. Ledger: verify via 0x0FD2, decode receipt + calldata, bind emitter/member/amount/round, flag
   on-time vs late by source height, replay-protect by query id.
5. `closeRound`: early when full, else after deadline height attested (0x0FD3); missed → record;
   deterministic rotation recipient.
6. Operator payout on Sepolia → `PaidOut` proven back → `confirmPayout`.
7. Kitty Score view + dashboard showing all of the above with attestation lag.
8. README + ATTESTCOIN_INTEGRATION docs; testnet deployment addresses.

**Nice-to-have**
- Member self-service "prove my payment" button in the UI (calls proof builder from the browser).
- Score-gated circle size (members with tier A may join larger circles).
- Bidding for early payout (Saving Circles feature) — deterministic highest-bid rotation.
- Soulbound Kitty Score badge (ERC-5192).

**Demo-only**
- "Spoof attack" button: replays a proof / submits a fake emitter and shows the revert reason.
- Local two-anvil mode with mocked precompiles for a deterministic screen recording backup.

## Build order (what actually happened / what remains)
1. Foundry scaffold + deps → contracts → mocks + fixtures → 27 tests green. ✅
2. Deploy scripts + ABI export. ✅
3. Worker: config, proof builder (testnet + local encoder), main loop, demo driver. ✅
4. Local e2e on two anvils with mocked precompiles, real SDK encoding. ✅ (see scripts/local-e2e.sh)
5. Dashboard. ✅
6. Docs + submission material. ✅
7. **Fund `DEPLOYER_ADDRESS` on Sepolia + CC3 Testnet, run `scripts/deploy.sh`, run demo on testnet,
   record video.** ← needs the faucets (human-only): Sepolia via Alchemy/Google/Zalalena; tCTC via
   Creditcoin Discord `#token-faucet` or thirdweb faucet.
