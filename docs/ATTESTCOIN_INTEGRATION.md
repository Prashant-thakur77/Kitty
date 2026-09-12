# How Kitty uses the Attestcoin Protocol

This is the technical integration document required by the BUIDL CTC submission rules.

## Environment

| | value |
|---|---|
| Creditcoin network | CC3 Testnet, chainId `102031`, RPC `https://rpc.cc3-testnet.creditcoin.network` |
| Source chain | Ethereum Sepolia, **chainKey `1`** on CC3 Testnet (chainId 11155111) |
| Block-prover precompile | `0x0000000000000000000000000000000000000FD2` (`INativeQueryVerifier`) |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fD3` |
| Proof Builder | `https://prover.cc3-testnet.creditcoin.network` (`/api/v1/attested-height/1`, `/api/v1/proof-batch-by-tx`) |
| Packages | `@gluwa/asc-contracts@0.2.1` (Solidity), `@gluwa/usc-sdk@0.18.0` (TypeScript) |
| Deployed contracts | see `deployments.json` (written by `scripts/deploy.sh`) |

## Readability pipeline, step by step

1. **Source-chain contract is intentionally dumb** (`src/source/KittyVault.sol`). It escrows a
   stablecoin and emits two purpose-named events, exactly as the Attestcoin design-pattern docs
   recommend ("use specific, unambiguous events rather than common standards"):
   `Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount)`
   and `PaidOut(...)`. It has no idea what a circle is.

2. **Attestation.** The attestor network attests Sepolia blocks on Creditcoin (~7–8 minutes of lag
   on testnet at the time of writing: Sepolia head 11,655,846 vs attested 11,655,810).

3. **Steward** (`worker/src/worker.ts`, `worker/src/proofs.ts`) pools `Contributed` events across
   every open circle. The batch policy in `worker/src/agent/policy.ts` picks one chain key per call,
   at most 10 payments, never a span of 1000 blocks or more (the Proof Builder's batch limit), and
   ranks urgency over thrift: a payment near its grace window is proven now, a fuller batch waits.
   The steward waits with `ProofBuilder.waitUntilHeightAttested(chainKey, maxHeight)`, fetches one
   batch proof with **`ProofBuilder.getBatchProof([...txHashes])`** (one continuity proof, up to 10
   Merkle proofs), asks the precompile's free view `verify` whether it holds (`preflight` in
   `worker/src/verifier.ts`; the browser does the same in `web/src/components/ProvePanel.tsx`) and
   only then submits `KittyLedger.recordContributions(...)`.

4. **On-chain verification** (`src/asc/KittyLedger.sol`):
   ```solidity
   bool ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity); // 0x0FD2, batch overload
   ```
   Before the call, each query id is derived exactly as `ASCBase` does
   (`keccak(chainKey ‖ height ‖ VERIFIER.calculateTxIndex(merkleProof))`) and rejected if already
   processed — replay protection at the proof level, plus a second guard per `(circle, round, member)`.

5. **Decoding with `EvmV1Decoder`** for every proven tx:
   - `getTransactionType` / `isValidTransactionType` (types 0–4);
   - `decodeReceiptFields` → **`receiptStatus == 1` is enforced** ("the precompile proves
     inclusion, not success");
   - `getLogsByEventSignature(receipt, CONTRIBUTED_SIG)` → exactly one log, 4 topics, 32-byte data;
   - the log must come from an **owner-trusted vault** (allowlist) and equal the circle's registered
     vault (**emitter binding**); look-alike logs from other contracts in the same tx are ignored;
   - `decodeCommonTxFields` → `tx.to == vault` and `tx.from == member` (**transaction binding**: a
     proof of someone else's tx that merely *contains* a vault log can't be reused).

6. **Chain binding.** Each circle carries its own `chainKey`, validated at creation with
   `CHAIN_INFO.get_chain_by_key(chainKey).exists` (`KittyLedger.sol`, `_initCircle`); the vault
   allowlist is keyed by chain, so `trustedVault[chainKey][vault]` must hold. The same function
   bounds `startHeight` against the attested frontier: round 0's deadline must lie beyond
   `CHAIN_INFO.get_latest_attestation_height_and_hash(chainKey).height`, otherwise
   `InvalidCircle("round 0 already attested")` — an organiser cannot open a circle whose first
   round is already over, collect consent through invites, and close it on every invitee as missed.
   A batch whose chain key
   differs from the circle's reverts `WrongChain(got, want)`, so a contract at the same address on
   another supported chain (Ethereum mainnet is chainKey 3 on testnet) cannot feed the circle.

7. **Time from attested blocks, not clocks.** A contribution is *on time* iff its proven source
   block height ≤ `startHeight + (round+1)·roundBlocks`. `closeRound` may run early when everyone
   has paid, otherwise only when **`CHAIN_INFO.is_height_attested(chainKey, deadline + 64)`**
   (0x0FD3) is true — the attestor network is the clock, and the 64-block grace window covers
   attestation lag plus proving time so an on-time payment can never be closed out by a rival.
   On that path `closeRound` also asks `find_lowest_attested_after(chainKey, deadline + 64)` and
   stores the answer on the round (`attestedCloseHeight`, `attestedCloseHash`); every
   `ContributionMissed` and the `RoundClosed` event carry it, so a lender re-checking a miss has
   the exact attestation to verify against 0x0FD3, not just a deadline number.
   Missed members are recorded permanently, but only if they consented to the circle (invite,
   organiser, `acceptMembership`, or a prior payment), so nobody can be listed and penalised.

8. **Close the loop.** The vault operator pays the rotation recipient on Sepolia; the steward proves
   that `PaidOut` tx with a single `verifyAndEmit` and `confirmPayout` moves the round to `Paid`
   only if recipient and amount match what the ledger decided. A batch overload, `confirmPayouts`,
   confirms several rounds' payouts under one continuity proof; the steward uses the single path
   because payouts are one per round.

9. **Kitty Score.** `creditScore(member)` = 500 + 15·onTime − 20·late − 120·missed, clamped to
   300–850. Every input is a proven transaction or an attested deadline — any Creditcoin lender
   can read it without trusting Kitty's operator.

10. **Steward.** The worker is an agent in three layers, and authority decreases toward the model.
    Layer 1 is the ledger itself: a verified proof, receipt status 1, a trusted emitter, the right
    sender and target, the exact amount, the current round and an unseen query id, whoever calls.
    Layer 2 is deterministic timing (`worker/src/agent/policy.ts`): prove now or wait for a fuller
    batch, with every decision and the chain state behind it written to the decision log
    (`worker/src/agent/log.ts`). Layer 3 is cited reasoning (`worker/src/agent/explain.ts`): Claude
    explains the log in plain language, and `worker/src/agent/citations.ts` removes any sentence with
    a figure the log cannot back before it is shown; without an API key the deterministic sentence
    from layer 2 is printed instead. The steward's Creditcoin key holds no ledger role, ownership or
    allowance; everything it calls is callable by anyone. On Sepolia this build runs the
    vault-operator key in the same process: that is the one privileged action in the system, it is
    bounded by `KittyVault` to addresses that have paid into the circle, and it is exactly the action
    Attestcoin writability removes.

## Files using Attestcoin

| File | Usage |
|---|---|
| `src/asc/KittyLedger.sol` | `verifyAndEmit` batch (`recordContributions`, `confirmPayouts`) and single (`confirmPayout`); `calculateTxIndex` query ids; `EvmV1Decoder` receipt + transaction decoding; `is_height_attested` deadline clock; `find_lowest_attested_after` records the attestation behind every missed deadline; `get_chain_by_key` and `get_latest_attestation_height_and_hash` at circle creation (registry check, round-0 frontier bound) |
| `src/interfaces/IChainInfo.sol` | ChainInfo precompile (0x0FD3) interface |
| `src/asc/KittyViewer.sol` | Reads proof-derived state in one call for the dashboard |
| `src/source/KittyVault.sol` | Source-chain contract in the readability pattern (minimal logic, purpose-named events) |
| `worker/src/proofs.ts` | usc-sdk `ProofBuilder.waitUntilHeightAttested`, `getBatchProof`, fallback `getProof` + `mergeProofs`; local mode uses `encoding.abiEncode` |
| `worker/src/chain.ts` | usc-sdk `utils.gas.computeGasLimit`; custom-error decoding |
| `worker/src/worker.ts` | The steward loop: attestation wait, batch proof, preflight, record, close, payout, proof-back; `get_latest_attestation_height_and_hash` is the attested frontier the batch policy decides against, recorded in every decision-log entry |
| `worker/src/verifier.ts`, `web/src/lib/verifier.ts` | The view `verify` overloads of 0x0FD2 as a free preflight before any submission, and the per-payment re-verify receipt |
| `worker/src/agent/policy.ts` | Batch policy: cross-circle pooling, one chain key per call, at most 10 payments and a span under 1000 blocks, urgency over thrift |
| `worker/src/verify-live.ts` | Real Proof Builder proofs checked by the live 0x0FD2 on CC3 Testnet, single and batch, with tamper and wrong-chain negatives (`pnpm verify:live`) |
| `worker/src/receipts.ts` | Exports a member's proof-backed entries as a bundle carrying both precompile addresses and the Proof Builder URL, so a lender can re-check it (`pnpm receipts`) |
| `worker/src/scenarios.ts` | Adversarial proofs pushed through the precompile path |
| `web/src/lib/prover.ts`, `web/src/components/ProvePanel.tsx` | Browser-side proving against the Proof Builder (CORS `*`): batch proof fetched client-side, `recordContributions` submitted from the member's wallet |
| `web/src/hooks.ts` | Dashboard reads of 0x0FD3 via wagmi: `find_lowest_attested_after` (which attestation covers each payment), `get_attestation_bounds` (whether a deadline is covered), `get_latest_attestation_height_and_hash` (the lag indicator) |
| `src/asc/KittyCreditLine.sol`, `src/asc/KittyBadge.sol` | Consumers of proof-derived state (score, record) — lending and a live-rendered soulbound badge |
| `test/`, `scripts/local-e2e.sh` | Precompiles mocked at their real addresses (`vm.etch` / `anvil_setCode`) |

## Protocol coverage

One row per protocol function, with where Kitty calls it. Line numbers refer to the current
`src/asc/KittyLedger.sol`.

| Interface | Function | Where |
|---|---|---|
| `INativeQueryVerifier` (0x0FD2) | `verifyAndEmit` (batch) | `recordContributions`, `KittyLedger.sol:511`; `confirmPayouts`, `:556` |
| `INativeQueryVerifier` | `verifyAndEmit` (single) | `confirmPayout`, `KittyLedger.sol:537` |
| `INativeQueryVerifier` | `verify` (both view overloads) | free preflight and re-verify: `worker/src/verifier.ts`, `web/src/lib/verifier.ts` |
| `INativeQueryVerifier` | `calculateTxIndex` | query ids, `_computeQueryId`, `KittyLedger.sol:764` |
| `ChainInfo` (0x0FD3) | `is_height_attested` | the clock in `closeRound`, `KittyLedger.sol:444` |
| `ChainInfo` | `find_lowest_attested_after` | `closeRound`, `KittyLedger.sol:447`: the attestation that proved a missed deadline, stored as `Round.attestedCloseHeight/Hash` and emitted in `ContributionMissed` / `RoundClosed`; `web/src/hooks.ts`: which attestation covers each payment |
| `ChainInfo` | `get_chain_by_key` | circle creation, `_initCircle`, `KittyLedger.sol:786` |
| `ChainInfo` | `get_latest_attestation_height_and_hash` | `_initCircle`, `KittyLedger.sol:792`: round 0's deadline must lie beyond the attested frontier (`InvalidCircle("round 0 already attested")`); `worker/src/worker.ts:72`, `worker/src/api.ts:31`, `web/src/hooks.ts:14` |
| `ChainInfo` | `get_attestation_bounds` | `web/src/hooks.ts`: whether a deadline is covered, or the latest attested block below it |
| `ChainInfo` | `find_highest_attested_before`, `get_attestation_genesis_height`, `get_supported_chains` | declared in `src/interfaces/IChainInfo.sol`, tested against the mock in `test/KittyMultiChain.t.sol:236-263`; not on the hot path |
| `ChainInfo` | `get_checkpoint_for_height`, `get_latest_checkpoint_height_and_hash`, `get_attestation_height_for_digest` | not used; continuity proofs come from the Proof Builder |

Six of the ChainInfo precompile's eleven functions are on the hot path, four of them inside
`KittyLedger.sol` itself; the eight-function interface in `IChainInfo.sol` is exercised end to end
against the mock. Query ids: `_computeQueryId` in `KittyLedger.sol` (lines 759-771) is byte-identical to `readability/ASCBase.sol` lines 99-111 in
`@gluwa/asc-contracts@0.2.1`, so a query processed by Kitty is the same id any `ASCBase` contract
would derive for that transaction.

### Where writability fits

The one action Kitty still delegates to an operator is the Sepolia payout. With Attestcoin
writability, `closeRound` would call `IOutbox.publishMessage(bool canAck, bytes payload)` with
`payload = abi.encode(circleId, round, recipient, pot)`, and a receiver on the source chain
implementing `IMessageReceiver.receiveMessage(messageId, sourceChainId, emitterAddress, payload)`
would execute the payout from the vault. The shipped `Inbox` delivers through its
`messageDispatcher`, which is where that receiver would sit. Writability is under third-party audit
and is not on testnet, so the operator path stays until then: the steward process holds the operator
key, `KittyVault` bounds it to addresses that have paid into the circle, and the payout is proven
back before the round shows *Paid*.

## Gas: why batch (measured on the live precompile)

`eth_estimateGas` against the real `0x0FD2` on CC3 Testnet, using real Proof Builder proofs for the
three Sepolia deployment transactions (two in block 11,656,253, one in 11,656,295):

| Call | Continuity roots | Gas |
|---|---|---|
| single `verify`, tx @ 11656253 #86 | 48 | 104,141 |
| single `verify`, tx @ 11656253 #85 | 48 | 112,239 |
| single `verify`, tx @ 11656295 #44 | 6 | 45,433 |
| **three singles, total** | | **261,813** |
| **one batch `verify` of the same three** | 48 (shared) | **199,375** |

The batch is 24% cheaper for three payments, and the gap grows with the age of the blocks because
the continuity proof — the expensive part — is verified once instead of once per payment. A
ten-member round is one continuity check plus ten Merkle checks. Reproduce with
`pnpm verify:live <h1> <h2> <h3>` and `cast estimate`.

## Why not inherit `ASCBase`?

`ASCBase.execute` calls `_processAndEmitEvent(action, queryId, txBytes)` — it drops `chainKey`
and the source `blockHeight`. Kitty needs both (chain binding, height-based deadlines) and needs
the batch overload of the precompile, so `KittyLedger` re-implements the same
verify → dedupe → act pipeline with identical query-id derivation and adds `recordContributions`.

## Testing without the network

`test/` mocks both precompiles at their real addresses with `vm.etch` and builds prover-format
`txBytes` (`abi.encode(uint8 txType, bytes[] chunks)`) in `test/TxFixtures.sol`. 106 tests in 11
suites (KittyLedger 33, Invites 16, MultiChain 14, CreditLine 12, BatchPayout 9, Badge 6, Viewer 6,
Rotation 4, Vault 4, FakeVault 1, RealProofFixture 1 with genuine Proof Builder bytes for Sepolia tx
11656295 #44) cover the batch path, replay, spoofed emitter, wrong transaction target, reverted
source tx, non-member, wrong amount/round, late flagging, deadline gating via ChainInfo, per-circle
chain keys, rotation, payout proof and batch payout proof, invites, scoring, credit lines and the
badge.

`scripts/local-e2e.sh` runs two anvils, mocks the precompiles with `anvil_setCode`, and drives the
real worker — including the real `@gluwa/usc-sdk` `abiEncode` so the decoder is exercised on
genuine transaction/receipt bytes — through two rounds and a replay attack.

## Gas notes
Gas estimation through the precompile can fail (`pallet-evm` does not always propagate reverts in
estimation mode); the worker uses `usc-sdk`'s `utils.gas.computeGasLimit`, which falls back to a
continuity-length heuristic. Batch verification amortises the continuity proof: one call per round
instead of one per member.
