# 🐈 Kitty — proof-settled savings circles

**Savings circles where every payment is proven, not promised.**
Rotating savings (chit funds, susu, tandas, chamas) on Ethereum stablecoins, settled and
credit-scored on Creditcoin through the **Attestcoin Protocol**. No treasurer, no oracle operator,
no bridge.

Built solo for **BUIDL CTC 2026 Fall** · Track: **DeFi** · Attestcoin integration write-up:
[`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md)

## Quick judge links

| | |
|---|---|
| **Demo video** | _testnet recording added on submission_ · fallback already in the repo: [`docs/kitty-demo-local.mp4`](docs/kitty-demo-local.mp4) (2:38, narrated, full loop against the local rehearsal world) |
| **Live dashboard** | `pnpm web:dev` → http://localhost:5173 (reads the public testnet RPCs; no keys needed). GitHub Pages publishing is wired and opt-in — see [Publishing the dashboard](#publishing-the-dashboard) |
| **Deck (PDF)** | [`docs/Kitty-deck.pdf`](docs/Kitty-deck.pdf) — printed straight from the presentation route |
| **Presentation mode** | `/presentation` on the dashboard — 10 slides, arrow keys, Print → PDF |
| **Attack lab** | `/lab` — replay, spoofed emitter, wrong chain key, reverted source tx, late payment, each answered by the ledger's decoded custom error |
| **Borrow** | `/borrow` — KittyCreditLine underwrites purely from the Kitty Score (tier A 100% of proven volume, B 50%, C 20%, D nothing) |
| **Prove it yourself** | On any circle page: a member fetches the round's batch proof from the Proof Builder in the browser and submits it from their own wallet, no operator |
| **KittyVault (Sepolia, chainKey 1)** | [`0x1172ABd45724069749E9EB98A0349177435B284E`](https://sepolia.etherscan.io/address/0x1172ABd45724069749E9EB98A0349177435B284E) |
| **TestUSD (Sepolia)** | [`0xc6fe7fd411681E07a44523f87F6aB0805903c2dE`](https://sepolia.etherscan.io/address/0xc6fe7fd411681E07a44523f87F6aB0805903c2dE) |
| **KittyLedger (Creditcoin CC3 Testnet, 102031)** | _deploys with `scripts/deploy.sh`; see [`deployments.json`](deployments.json)_ |
| **Deployer / operator** | [`0xD793169c516c9F9A334218608fbF6E1338b3DE56`](https://creditcoin-testnet.blockscout.com/address/0xD793169c516c9F9A334218608fbF6E1338b3DE56) |
| **Testnet transaction log** | [`docs/TESTNET_LOG.md`](docs/TESTNET_LOG.md) |
| **One-command check** | `pnpm judge` — contract tests, the local two-anvil rehearsal, then a real Sepolia proof verified by the live precompile |
| **Verify the pipeline yourself** | `pnpm verify:live <anySepoliaTxHash>` — fetches the Proof Builder proof and asks the **live** 0x0FD2 precompile on CC3 Testnet to verify it (view call, no funds), then shows tampered bytes and a wrong chain key being rejected |

![Circle page — urgency band, attested-height progress, members, rotation, browser proving, proof feed](docs/assets/circle.png)

### Dashboard highlights

**Attested time, not wall time.** The round header counts Sepolia blocks until the deadline is *attested* on Creditcoin; the bar fills mint as blocks are attested. When the deadline block is attested, anyone can close the round and missed members are recorded.

![Kitty Score — gauge, lender view JSON, badge, proof-backed history](docs/assets/score.png)

**The score is used.** `/score` shows exactly what a lender reads from `creditScore(address)`; `/borrow` lets KittyCreditLine lend against it; the soulbound badge renders the same numbers on-chain.

![Attack lab — five live scenarios answered with decoded custom errors](docs/assets/lab.png)

**Try to cheat it.** Each scenario pushes a real transaction through proof → precompile → ledger and shows the decoded rejection.


## Table of contents

- [Files using Attestcoin](#files-using-attestcoin)
- [The problem](#the-problem)
- [How Kitty works](#how-kitty-works)
- [Attestcoin depth](#attestcoin-depth)
- [Attack lab](#attack-lab)
- [Kitty Score](#kitty-score)
- [Repository](#repository)
- [Quick start](#quick-start)
- [Security model](#security-model)
- [Challenges I ran into](#challenges-i-ran-into)
- [What makes Kitty different](#what-makes-kitty-different)
- [Roadmap](#roadmap)

## Files using Attestcoin

Every file that touches the Attestcoin Protocol (precompiles `0x0FD2` / `0x0FD3`, `@gluwa/asc-contracts`, `@gluwa/usc-sdk`, the Proof Builder).

| File | Attestcoin usage |
|---|---|
| [`src/asc/KittyLedger.sol`](src/asc/KittyLedger.sol) | `INativeQueryVerifier.verifyAndEmit` **batch** overload (≤10 txs, one continuity proof) in `recordContributions`; single overload in `confirmPayout`; `calculateTxIndex` for ASCBase-identical query ids; `EvmV1Decoder` (`getTransactionType`, `decodeReceiptFields`, `getLogsByEventSignature`, `decodeCommonTxFields`); `IChainInfo.is_height_attested` as the deadline clock in `closeRound` |
| [`src/interfaces/IChainInfo.sol`](src/interfaces/IChainInfo.sol) | Solidity interface for the ChainInfo precompile (`0x0FD3`): `is_height_attested`, `get_latest_attestation_height_and_hash`, `get_attestation_bounds`, `find_lowest_attested_after`, `find_highest_attested_before`, `get_attestation_genesis_height`, `get_chain_by_key`, `get_supported_chains` — 8 of the precompile's 11 functions |
| [`src/asc/KittyViewer.sol`](src/asc/KittyViewer.sol) | One-call reads of proof-derived state for the dashboard |
| [`src/source/KittyVault.sol`](src/source/KittyVault.sol) | Source-chain contract designed to the Attestcoin readability pattern: minimal logic, purpose-named events (`Contributed`, `PaidOut`) that the ASC binds on |
| [`worker/src/proofs.ts`](worker/src/proofs.ts) | `@gluwa/usc-sdk` `ProofBuilder.waitUntilHeightAttested` + **`getBatchProof`** (fallback to `getProof` + `mergeProofs`); local mode uses the SDK's `encoding.abiEncode` so the decoder is exercised on genuine tx bytes |
| [`worker/src/chain.ts`](worker/src/chain.ts) | `usc-sdk` `utils.gas.computeGasLimit` (precompile-aware gas fallback); custom-error decoding |
| [`worker/src/worker.ts`](worker/src/worker.ts) | Readability off-chain worker: watch → wait attestation → batch prove → submit → close → pay out → prove back |
| [`worker/src/scenarios.ts`](worker/src/scenarios.ts) | Attack scenarios that push bad proofs through the precompile path and assert the ledger's rejection |
| [`worker/src/verifier.ts`](worker/src/verifier.ts), [`web/src/lib/verifier.ts`](web/src/lib/verifier.ts) | **Free preflight**: the precompile's view `verify` (single and batch overloads) is asked whether a proof holds *before* any gas is spent submitting it; also powers the per-payment re-verify receipt |
| [`worker/src/agent/policy.ts`](worker/src/agent/policy.ts) | Deterministic batch policy: pools payments **across circles** under one continuity proof, never mixes chain keys, and prefers payments closest to their grace window over a fuller batch |
| [`worker/src/agent/log.ts`](worker/src/agent/log.ts) | Every steward decision recorded with the chain state behind it — the only values Layer 3 may cite |
| [`worker/src/agent/citations.ts`](worker/src/agent/citations.ts), [`worker/src/agent/explain.ts`](worker/src/agent/explain.ts) | Cited reasoning: the model must mark every figure it states, each is checked against chain-derived values, and any sentence with an unverifiable or uncited figure is removed before display |
| [`worker/src/receipts.ts`](worker/src/receipts.ts) | Exports a member's proof bundle: every recorded payment with its source tx, query id and the Creditcoin proof transaction |
| [`worker/src/verify-live.ts`](worker/src/verify-live.ts) | Real proof → real precompile: `verify` / `calculateTxIndex` on the live 0x0FD2, with tamper and wrong-chain negative checks |
| [`test/RealProofFixture.t.sol`](test/RealProofFixture.t.sol), [`test/fixtures/`](test/fixtures) | Genuine Proof Builder `txBytes` (verified `true` on-chain) decoded with the ledger's exact `EvmV1Decoder` calls |
| [`worker/src/config.ts`](worker/src/config.ts) | ChainInfo precompile ABI (`get_latest_attestation_height_and_hash`) |
| [`web/src/lib/prover.ts`](web/src/lib/prover.ts), [`web/src/components/ProvePanel.tsx`](web/src/components/ProvePanel.tsx) | **Browser-side proving**: calls the Proof Builder (`/api/v1/proof-batch-by-tx/1`) directly and submits `recordContributions` from the member's wallet — the ledger verifies, the submitter is irrelevant |
| [`web/src/hooks.ts`](web/src/hooks.ts), [`web/src/lib/abi.ts`](web/src/lib/abi.ts) | Dashboard reads the ChainInfo precompile directly for the "Sepolia head → attested" lag indicator |
| [`src/asc/KittyCreditLine.sol`](src/asc/KittyCreditLine.sol) | Lender that underwrites only from proof-derived history (`creditScore`, `getRecord`) — the score is *used* |
| [`src/asc/KittyBadge.sol`](src/asc/KittyBadge.sol) | Soulbound badge whose on-chain SVG renders live from the ledger |
| [`test/KittyLedger.t.sol`](test/KittyLedger.t.sol), [`test/mocks/`](test/mocks) | Precompiles mocked at their real addresses with `vm.etch`; prover-format `txBytes` fixtures in [`test/TxFixtures.sol`](test/TxFixtures.sol) |
| [`scripts/local-e2e.sh`](scripts/local-e2e.sh) | Two anvils with the precompiles mocked via `anvil_setCode`; full loop plus replay attack |
| [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) | Step-by-step integration document (required by the submission rules) |

## Verified against the live precompile

Before the Creditcoin-side deployment, the whole proof path was exercised against the real network:
a Proof Builder proof for a real Sepolia transaction (the FakeVault deployment, block 11,656,295,
tx index 44) was submitted to the **live** block-prover precompile at `0x0FD2` on CC3 Testnet.

```
0x0FD2.calculateTxIndex = 44
0x0FD2.verify(chainKey 1, height 11656295) = true
0x0FD2.verify(tampered txBytes)  = reverted: "Merkle proof validation failed"
0x0FD2.verify(wrong chainKey 3)  = reverted: "Continuity proof does not match attestation or checkpoint"
```

And the **batch** overload — the call `recordContributions` makes — with three real transactions
from two different Sepolia blocks under one shared continuity proof:

```
batch proof: 3 tx over blocks 11656253–11656295 · ONE continuity proof (48 roots)
0x0FD2.verify(BATCH of 3, one shared continuity proof) = true
```

Run it on any Sepolia transactions: `pnpm verify:live <txhash> [<txhash> …]` (one hash = single
proof, several = batch). The same bytes are a Foundry fixture decoded by the ledger's `EvmV1Decoder` calls.

## The problem

Hundreds of millions of people save through rotating circles: chit funds in India, susu in Ghana,
tandas in Mexico, chamas in Kenya, stokvels in South Africa. They work because members watch each
other. They fail in two ways: a treasurer disappears with the pot, or a member stops paying and
nobody outside the group ever knows. Years of perfect payments build zero formal credit history.
Existing on-chain ROSCA apps keep money and rules on one chain and still need a randomness oracle
or an admin to run the rotation.

## How Kitty works

```
 Ethereum Sepolia (chainKey 1)                         Creditcoin CC3 Testnet (102031)
 ┌─────────────────────────┐                           ┌──────────────────────────────────────┐
 │ TestUSD · KittyVault    │  Contributed / PaidOut    │ KittyLedger (ASC)                    │
 │  contribute() escrow    │ ───────────────────────▶  │  recordContributions(batch ≤10) ──┐  │
 │  payout()  (operator)   │                           │  closeRound  · confirmPayout      │  │
 └───────────┬─────────────┘                           │  creditScore · KittyViewer        │  │
             │ events                                  └────────┬──────────────┬───────────┘  │
             ▼                                                  │              │              │
     ┌───────────────┐  wait attestation  ┌────────────────┐   verifyAndEmit  is_height_attested
     │ worker        │ ─────────────────▶ │ Proof Builder  │   ┌────▼─────┐  ┌────▼─────┐      │
     │ @gluwa/usc-sdk│ ◀── batch proof ── │ prover.cc3-…   │   │ 0x0FD2   │  │ 0x0FD3   │      │
     └───────┬───────┘                    └────────────────┘   └──────────┘  └──────────┘      │
             └──── recordContributions · closeRound · payout · confirmPayout ──────────────────┘
                                          ▲  React + wagmi dashboard reads both chains
```

1. A group creates a circle on Creditcoin: members (or signed invites), installment, round length
   in *Sepolia blocks*.
2. Each round, members pay the installment into the vault on Sepolia.
3. The worker waits for the attestor network to attest those blocks, fetches **one batch proof**
   for the whole round, and calls `recordContributions`.
4. The ledger verifies all payments in **one precompile call**, decodes each receipt and calldata,
   binds emitter / member / amount / round, and records on-time vs late by source block height.
5. The round closes when everyone has paid, or when the deadline block is **attested**. Missed
   members are recorded. The recipient is deterministic: fixed order, or **by Kitty Score** — the
   best proven record among members who haven't received yet, judged *after* this round's misses
   are recorded, so paying on time moves you up the queue.
6. The vault pays out on Ethereum; that `PaidOut` transaction is proven back before the round
   shows "Paid".
7. Every member accrues a **Kitty Score** built solely from proven transactions and attested deadlines.
8. The score is used: **KittyCreditLine** lends kUSD against it, and a soulbound **Kitty Score badge** renders it live for any explorer or lender.
9. The score is **portable**: `pnpm receipts <address>` (or the Proof bundle button on `/score`) exports a
   self-verifying JSON — every entry names the Creditcoin transaction that carried its Attestcoin proof,
   so a lender re-checks it against the live precompile instead of trusting Kitty.

## Attestcoin depth

| Capability | Where | Why it matters |
|---|---|---|
| Batch verification, **across circles** | `recordContributions` → `verifyAndEmit(chainKey, heights[], txs[], merkleProofs[], continuity)` | Up to ten queries under one continuity proof, pooled from every open circle rather than one round at a time. Measured on the live precompile: 3 singles 261,813 gas vs 1 batch 199,375 (−24%), and the continuity proof is checked once |
| Free preflight | precompile view `verify(...)`, both overloads | A proof that would fail is never submitted, so a bad batch costs nothing. Used by the worker and by the browser before a member pays |
| Query-id replay protection | `_computeQueryId` (identical to `ASCBase`) + per-(circle, round, member) guard | Same proof can never count twice |
| Chain binding, **per circle** | each circle stores its own `chainKey`, validated at creation against `get_chain_by_key` | A circle settles from Sepolia (key 1) or Ethereum mainnet (key 3); proofs from any other chain are refused, and the trusted-vault allowlist is keyed by chain so a vault trusted on one chain is not trusted on another |
| Attestation bounds | `get_attestation_bounds`, `find_lowest_attested_after`, `get_supported_chains`, `get_chain_by_key` | The exact block that will cover a payment comes from the precompile, not from arithmetic; supported chains are read from the registry rather than hard-coded |
| Batch payout confirmation | `confirmPayouts(chainKey, heights[], txs[], proofs[], continuity)` | Several rounds' payouts proven back under one shared continuity proof |
| Emitter + calldata binding | `log.address_ == vault`, `tx.to == vault`, `tx.from == member` | A proof of someone else's transaction that merely contains a vault log is rejected |
| Receipt status | `receiptStatus == 1` | The precompile proves inclusion, not success |
| Attested-height clock | `is_height_attested(chainKey, deadline)` in `closeRound`; `onTime = height ≤ deadline` | No timestamps, no oracle, no admin decides when a round ends |
| Proof-back of payouts | `confirmPayout` single `verifyAndEmit` on the `PaidOut` tx | "Paid" is never an operator's claim |

## Attack lab

`pnpm lab:api` + the dashboard's `/lab` page, or `pnpm scenario <name>`:

| Scenario | Ledger answer |
|---|---|
| Replay an already-counted proof | `QueryAlreadyProcessed(queryId)` |
| Fake vault emits a byte-identical `Contributed` event | `WrongEmitter(got, want)` |
| Same proof, chain key 3 (Ethereum mainnet on testnet) | `WrongChain(3, 1)` |
| Included but reverted source transaction | `SourceTxFailed()` |
| Payment after the deadline block | Accepted, `onTime = false`, score −20 |

## Kitty Score

`creditScore(member)` = 500 + 15·onTime − 20·late − 120·missed, clamped to 300–850, with tiers
A ≥ 700, B ≥ 600, C ≥ 500, D. Readable by any Creditcoin contract; inputs are only proven
transactions and attested deadlines.

## Repository

```
src/source/KittyVault.sol      Sepolia escrow; emits Contributed / PaidOut (minimal by design)
src/source/TestUSD.sol         6-decimal demo stablecoin with open mint
src/source/FakeVault.sol       demo-only spoof emitter for the attack lab
src/asc/KittyLedger.sol        Creditcoin ASC: batch verify, decode, bind, deadlines, rotation, invites, score
src/asc/KittyViewer.sol        one-call reads for the dashboard
src/asc/KittyCreditLine.sol    demo lender underwriting from the Kitty Score (+ KittyUSD)
src/asc/KittyBadge.sol         ERC-5192 soulbound badge, on-chain SVG from live ledger state
src/interfaces/IChainInfo.sol  0x0FD3 precompile subset
test/                          Foundry tests, precompile mocks, prover-format tx fixtures
worker/                        TypeScript worker (usc-sdk ProofBuilder), demo driver, scenarios, lab API, tx log
web/                           Vite + React + wagmi dashboard: circles (with browser proving), score + badge, borrow, attack lab, architecture, presentation
scripts/                       deploy.sh · local-e2e.sh · local-lab.sh
docs/                          STRATEGY · MASTER_PLAN · BUILD_PLAN · SUBMISSION · ATTESTCOIN_INTEGRATION · TESTNET_LOG
```

## Quick start

```bash
pnpm install && (cd web && pnpm install)
forge test                     # precompiles mocked at 0x0FD2 / 0x0FD3
pnpm e2e:local                 # two anvils, mocked precompiles, real worker + SDK encoding, 2 rounds + replay attack
pnpm run e2e:lab               # same setup, then all attack scenarios, then the lab API stays up for the dashboard
```

Testnet:

```bash
cp .env.example .env           # PRIVATE_KEY needs Sepolia ETH + tCTC
scripts/deploy.sh              # deploys what is missing, writes .env / web/.env / deployments.json
pnpm demo fund && pnpm demo create && pnpm demo contribute
pnpm worker                    # attestation wait → batch proof → record → close → payout → proof-back
pnpm demo status
pnpm web:dev                   # http://localhost:5173
```

Faucets: Sepolia ETH — https://www.alchemy.com/faucets/ethereum-sepolia · tCTC — Creditcoin Discord
`#token-faucet` (`/faucet address:0x…`), https://discord.gg/Gu43zTfmtc.

## Kitty Steward — an agent whose only power is proof

The worker is an agent in three layers, and authority *decreases* as you move toward the model.

| Layer | Holds | What it does |
|---|---|---|
| **1 · The ledger** | final say | A proof verified by 0x0FD2, receipt status 1, a log from a trusted vault, the transaction sent by the member to that vault, exact amount, current round, an unseen query id. Fail any one and nothing happens, whoever asked. |
| **2 · Deterministic decisions** ([`policy.ts`](worker/src/agent/policy.ts)) | timing only | Prove now or wait for a fuller batch? Batching is measurably cheaper, but a payment that misses its grace window costs its owner 120 score points, so urgency beats thrift and thrift beats impatience. Which payments, in what order, across which circles. 8 unit tests, no model involved. |
| **3 · Cited reasoning** ([`explain.ts`](worker/src/agent/explain.ts)) | none | Claude turns the decision log into plain language. Every figure it states must be marked and must appear in the log; [`citations.ts`](worker/src/agent/citations.ts) removes any sentence with an unverifiable *or uncited* figure before display. 10 unit tests. |

Two properties follow, and both are demonstrable rather than promised:

- **The steward's key is worth nothing.** It has no role, no ownership, no allowance. Its entire
  action space is submitting a proof — and `recordContributions`, `closeRound` and `confirmPayout`
  are callable by anyone, because the ledger checks the proof, not the caller.
- **The model is optional.** With no `ANTHROPIC_API_KEY` the steward prints the deterministic
  sentence from layer 2 and behaves identically. Run `pnpm explain` to see either path.

```bash
pnpm test:agent            # 18 unit tests: batch policy + citation validator
pnpm explain "why did you wait?"
```

## Publishing the dashboard

The dashboard is a static SPA that reads public RPCs, so anything that serves files can host it.
GitHub Pages is wired up and waits on two one-time repository settings (they cannot be set from a
workflow):

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Actions → General → Workflow permissions: Read and write**
3. **Settings → Secrets and variables → Actions → Variables → new variable `ENABLE_PAGES` = `true`**

The `pages` workflow then builds `web/` with `VITE_BASE=/Kitty/` and publishes to
`https://prashant-thakur77.github.io/Kitty/`. Until the variable is set the workflow is skipped, so
the Actions tab stays green. Any static host works the same way: `cd web && pnpm build`, serve `dist/`.

## Security model

Reviewed with an adversarial model where the Attestcoin precompiles are trusted and everything else
(proof submitters, members, organisers, the vault operator, other contracts) is hostile. Fixes from
that review are in the code and covered by tests.

| Claim | Backed by |
|---|---|
| Member X paid round R | Proof verified by 0x0FD2; receipt status 1; exactly one `Contributed` log from a **trusted vault** (owner-curated allowlist; look-alike logs from other contracts in the same tx are ignored); tx `to` = vault, `from` = member; exact amount; current round |
| Payment was on time | Proven source block height ≤ deadline height |
| Member Y missed round R | Deadline **plus a 64-block grace window** attested (0x0FD3), no proven payment, **and Y consented** to the circle (invite, organiser, `acceptMembership`, or a prior payment). A stranger listed in a circle cannot be penalised |
| Recipient Z was paid | `PaidOut` proven by 0x0FD2 with matching recipient and amount; the vault only pays contributors of that circle |
| Recipient Z deserved the pot | Z paid this round and had not received before; otherwise the pot rolls to the next round |
| Same proof can't count twice | Query id (chainKey ‖ height ‖ txIndex), byte-identical to `ASCBase`, shared by both entry points, in-batch duplicate check, plus a per-(circle, round, member) guard |
| Proof from another chain can't count | `chainKey` pinned at deployment |
| Invite is genuine | Organiser's EIP-191 signature over (ledger, chainId, circleId, invitee, nonce); single-use nonces; OpenZeppelin ECDSA (malleability-safe) |
| Score cannot be minted | Only trusted vaults feed volume; credit limits come from that volume; missed payments require consent |
| LP fees are not stranded | Withdrawals are pro-rata over pool value (idle + owed) |

Known limits, stated plainly: the vault operator *sends* payouts (Attestcoin writability, once audited,
replaces this); a payout mis-routed inside the group is not recoverable; loan defaults do not yet
feed back into the score; members paying through smart-account wallets are not credited because the
transaction's own `from` must be the member (a safe false negative).

## Challenges I ran into

- **`forge script` can't simulate Creditcoin** ("prevrandao not set" on Substrate EVM headers).
  Deployment uses `forge create` directly, as the official examples do.
- **`ASCBase.execute` drops `chainKey` and `blockHeight`** before app logic. Kitty needs both, so
  the ledger re-implements the pipeline with the same query-id derivation and adds a batch entry point.
- **The precompile proves inclusion, not success.** A reverted transaction still has a valid proof;
  the ledger checks receipt status before reading any log.
- **Gas estimation through precompiles can fail** in estimation mode; the worker uses the SDK's
  heuristic fallback.
- **ethers ESM vs CommonJS typings**: `@gluwa/usc-sdk` is typed against the CJS build; the worker
  casts once at the SDK boundary.
- **Hosted Sepolia RPCs cap `eth_getLogs` ranges**; the worker scans in 50-block chunks.

## What makes Kitty different

1. The only entry that verifies a whole round in a single precompile call.
2. Deadlines are attested source-chain block heights, not timestamps or admin calls.
9. Score-ordered rotation: proven behaviour decides who gets the pot next, inside the circle itself.
10. Portable receipts: a member can hand a lender a bundle that verifies itself against the precompile.
3. Output is portable credit data, not just a pot: a score any Creditcoin lender can read — and one already does (KittyCreditLine).
4. Payouts are proven back; the ledger never displays money it hasn't seen move.
5. Five live attack scenarios, each answered with a decoded custom error.
6. Members can prove rounds themselves from the browser; the worker is a convenience, not a trust assumption.
8. Rehearsable offline: two anvils, mocked precompiles, real SDK encoding.
7. On Creditcoin's own thesis: credit history for people banks cannot see.

## Roadmap

Score-gated circle sizes · seat bidding for early payout · ERC-5192 Kitty Score badge · pot cover
via proven-event insurance · Ethereum mainnet chainKey on CC3 mainnet · Attestcoin writability for payouts.

## License

MIT. Dashboard patterns adapted from SentinelCRE (MIT); contract patterns from BreadchainCoop
saving-circles (MIT) and gluwa/attestcoin-protocol-examples (MIT).
