# Kitty: Technical Note

Kitty is a rotating savings circle whose money sits in an escrow vault on Ethereum Sepolia and whose rules run in `KittyLedger`, an Attestcoin Smart Contract on Creditcoin CC3 Testnet. The ledger changes state for exactly two kinds of input: an Ethereum transaction that the block-prover precompile at `0x0FD2` has verified, and a Sepolia block height that the ChainInfo precompile at `0x0FD3` reports as attested. Nothing else moves money, reputation or a round.

This note explains why that is the right shape, how each input is checked, how time works when there is no clock, how the rotation is decided, what the score means, what the steward is allowed to do, and where the design stops today. The formal interface is in [`specs/PROTOCOL.md`](specs/PROTOCOL.md); the adversarial view is in [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Contents

- [The core insight: a payment is a record, not a claim](#the-core-insight-a-payment-is-a-record-not-a-claim)
- [How a Sepolia payment becomes Creditcoin state](#how-a-sepolia-payment-becomes-creditcoin-state)
- [The attestation clock](#the-attestation-clock)
- [Rotation](#rotation)
- [The Kitty Score](#the-kitty-score)
- [Credit line and badge](#credit-line-and-badge)
- [The steward: three layers](#the-steward-three-layers)
- [Batch policy](#batch-policy)
- [Gas, measured](#gas-measured)
- [Attestcoin coverage](#attestcoin-coverage)
- [Why Creditcoin](#why-creditcoin)
- [What writability changes](#what-writability-changes)
- [Current state](#current-state)
- [Limits](#limits)

## The core insight: a payment is a record, not a claim

An informal circle runs on a treasurer's notebook: the notebook says who paid, and the members trust the notebook because they trust the treasurer. Every on-chain ROSCA that puts money and rules on one chain keeps the same structure with a different treasurer, a contract whose admin, oracle or randomness source decides who paid and when the round ends.

Kitty starts from a different premise. A payment on Ethereum is not a claim that someone can make about a member; it is a record that already exists in an Ethereum block, with a transaction hash, a sender, a target, a receipt status and a log. The only question is whether Creditcoin can read that record without trusting anyone to relay it. The Attestcoin Protocol answers yes: the attestor network attests Sepolia block headers on Creditcoin, the Proof Builder returns a Merkle proof of the transaction and a continuity proof from an attested header to the block, and the precompile at `0x0FD2` checks both natively.

So `KittyVault` on Sepolia is deliberately minimal ([`src/source/KittyVault.sol`](../src/source/KittyVault.sol)): it holds a 6-decimal stablecoin, exposes `contribute(circleId, round, amount)` and `payout(circleId, round, recipient, amount)`, and emits two purpose-named events, `Contributed` and `PaidOut`, with the layout `(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount)`. It has no membership list and no deadline. It does not know what a circle is. Everything that interprets a payment happens in `KittyLedger` on Creditcoin, and every interpretation traces back to a proof.

The consequence that matters most: the ledger does not care who submits. `recordContributions`, `closeRound`, `confirmPayout` and `confirmPayouts` are all external functions with no access control. A steward, a member, or a stranger can call them; the ledger checks the proof and the state, never the caller. That is what makes the steward a convenience instead of a dependency, and it is demonstrated rather than asserted by the `fireTheAgent` scenario in [`worker/src/scenarios.ts`](../worker/src/scenarios.ts).

## How a Sepolia payment becomes Creditcoin state

The entry point is `KittyLedger.recordContributions(chainKey, heights[], encodedTxs[], merkleProofs[], continuity)` at [`src/asc/KittyLedger.sol:502`](../src/asc/KittyLedger.sol). It records up to `MAX_BATCH = 10` proven `Contributed` transactions with one precompile call. In order:

### Step 0: batch prologue, before any gas reaches the prover

`_prepareBatch` (line 623) runs first and is a `view`:

| Check | Revert |
|---|---|
| `heights.length == 0` | `EmptyBatch()` |
| `heights.length > MAX_BATCH` | `BatchTooLarge(n)` |
| `encodedTxs.length != n` or `merkleProofs.length != n` | `LengthMismatch()` |
| query id already in `processedQueries` | `QueryAlreadyProcessed(queryId)` |
| the same query id twice inside this batch | `QueryAlreadyProcessed(queryId)` |

The query id is `keccak256(chainKey ‖ height ‖ txIndex)` where `txIndex = VERIFIER.calculateTxIndex(merkleProof)`, packed exactly as `ASCBase._computeQueryId` packs it (`_computeQueryId`, line 763: 32 bytes of chain key, 8 bytes of height shifted into the high bits, 32 bytes of tx index, 72 bytes hashed). A query processed by Kitty therefore has the same id any `ASCBase` contract would derive for that transaction.

### Step 1: one precompile call for the whole batch

```solidity
bool ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity);
if (!ok) revert ProofRejected();
```

The batch overload of `INativeQueryVerifier.verifyAndEmit` checks every Merkle inclusion proof against its block and the shared continuity proof against the attestations for `chainKey`. If the precompile reverts (for example `Merkle proof validation failed` or `Continuity proof does not match attestation or checkpoint`, both observed against the live precompile), the whole call reverts with the precompile's own reason. If it returns `false`, the ledger reverts `ProofRejected()`.

### Step 2: per transaction, in batch order

Each query id is marked processed, then `_recordContribution(chainKey, qid, height, encodedTx)` (line 663) runs. The checks below happen in exactly this order, and the first failure reverts the entire batch:

| # | Check | Where | Revert |
|---|---|---|---|
| 1 | `EvmV1Decoder.getTransactionType` is a valid type (0 to 4) | `_singleLog`, line 714 | `UnsupportedTxType(txType)` |
| 2 | `EvmV1Decoder.decodeReceiptFields(encodedTx).receiptStatus == 1` | `_singleLog`, line 718 | `SourceTxFailed()` |
| 3 | `getLogsByEventSignature(receipt, CONTRIBUTED_SIG)` returns at least one log | `_singleLog`, line 720 | `ExpectedExactlyOneLog(0)` |
| 4 | among those logs, count the ones whose `address_` is in `trustedVault[chainKey]`; if none, `_rejectEmitter` | `_singleLog`, line 728 | `WrongChain(got, want)` when the emitter is the circle's own vault trusted on another chain, otherwise `WrongEmitter(logs[0].address_, address(0))` |
| 5 | exactly one log from a trusted vault | `_singleLog`, line 729 | `ExpectedExactlyOneLog(found)` |
| 6 | the chosen log has 4 topics and 32 bytes of data, and topic 2 fits `uint32` | `_decodeVaultLog`, line 753 | `BadLogShape()` |
| 7 | `circleId` from topic 1 names a circle with a non-zero `sourceVault` | `_circle`, line 857 | `UnknownCircle(circleId)` |
| 8 | `chainKey == c.chainKey` | line 670 | `WrongChain(chainKey, c.chainKey)` |
| 9 | `c.status == Active` | line 671 | `CircleNotActive(circleId)` |
| 10 | `!c.open` (invites closed) | line 672 | `CircleStillOpen(circleId)` |
| 11 | `log.address_ == c.sourceVault` | line 673 | `WrongEmitter(log.address_, c.sourceVault)` |
| 12 | `decodeCommonTxFields(encodedTx)`: `!toIsNull && to == c.sourceVault` | line 677 | `TxNotToVault(to, c.sourceVault)` |
| 13 | `from == member` (the log's topic 3) | line 678 | `SenderMismatch(from, member)` |
| 14 | `isMember[circleId][member]` | line 680 | `NotAMember(circleId, member)` |
| 15 | `amount == c.contribution` | line 681 | `WrongAmount(amount, c.contribution)` |
| 16 | `round == c.currentRound` | line 682 | `NotCurrentRound(round, c.currentRound)` |
| 17 | `height >= c.startHeight` | line 685 | `BeforeCircleStart(height, c.startHeight)` |
| 18 | `_rounds[circleId][round].status == Open` | line 687 | `RoundNotOpen(circleId, round)` |
| 19 | no prior contribution for `(circleId, round, member)` | line 688 | `AlreadyContributed(circleId, round, member)` |

Checks 4 and 11 together are the emitter binding: a look-alike contract that emits a byte-identical `Contributed` event is rejected even with a perfectly valid inclusion proof. Checks 12 and 13 are the transaction binding: a proof of someone else's transaction that merely contains a vault log cannot be reused, because the transaction's own `to` and `from` fields are decoded from the same prover bytes and compared. Check 4 also ignores look-alike logs from untrusted contracts in the same transaction, so a token or router that happens to emit `Contributed` cannot block a genuine payment (`test_extraContributedLogFromUntrustedEmitterIsIgnored`).

### Step 3: effects

Once every check passes, in one place:

```solidity
_accept(circleId, member);                       // paying into a circle is consent
bool onTime = height <= deadlineHeight(circleId, round);
_contributions[circleId][round][member] = Contribution({height, queryId: qid, onTime});
rd.contributions += 1;
rd.pot += amount;
if (onTime) rec.onTime += 1; else rec.late += 1;
rec.volume += amount;
emit ContributionRecorded(circleId, round, member, amount, height, onTime, qid);
```

After the loop, `BatchVerified(chainKey, lo, hi, n)` reports the lowest and highest heights in the batch and the count.

`confirmPayout` (line 528) and `confirmPayouts` (line 547) run the same pipeline against `PAIDOUT_SIG` through `_confirmPayout` (line 646): the round must be `Closed`, must have a recipient, and the log's recipient and amount must equal `rd.recipient` and `rd.pot`, otherwise `RoundNotClosed`, `NoRecipient` or `PayoutMismatch`. On success the round becomes `Paid` and stores the payout's query id.

## The attestation clock

Kitty has no timestamps. Every deadline is a Sepolia block height, and the only authority on whether a height has passed is the attestor network as read through `0x0FD3`.

For circle `c` and round `r`:

```
deadlineHeight(c, r) = c.startHeight + (r + 1) * c.roundBlocks          // KittyLedger.sol:595
closeHeight(c, r)    = deadlineHeight(c, r) + GRACE_BLOCKS               // KittyLedger.sol:603, GRACE_BLOCKS = 64
```

A contribution is on time iff its proven source height is `<= deadlineHeight`. A payment proven above the deadline is still recorded, but as late.

`closeRound(circleId)` (line 431) may run in two situations:

1. Every member has a proven contribution (`rd.contributions == c.members.length`). The round closes early on proofs alone, and `Round.attestedCloseHeight` stays zero.
2. Otherwise, only when `CHAIN_INFO.is_height_attested(c.chainKey, closeHeight)` is true. Until then it reverts `RoundStillOpenOnSource(closeHeight)`.

Why a grace window at all: a payment mined at the deadline block becomes provable at the same moment that block is attested, which is the same moment a rival could close the round if the deadline itself were the close height. `GRACE_BLOCKS = 64` gives the payment's proof room to land first; the constant covers the observed attestation lag on testnet (roughly 36 to 40 Sepolia blocks) plus proving time. `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace` pins the boundary: with the frontier at `deadline + 63` the round cannot close, and a payment at exactly the deadline block is recorded on time.

On the deadline path the ledger also records which attestation proved the deadline:

```solidity
IChainInfo.HeightHash memory a = CHAIN_INFO.find_lowest_attested_after(c.chainKey, closeAt);
rd.attestedCloseHeight = a.height;
rd.attestedCloseHash = a.hash;
```

Every `ContributionMissed(circleId, round, member, deadlineHeight, attestedHeight, attestedHash)` of that round and the `RoundClosed` event carry this evidence, so a lender re-checking a miss has the exact attestation to verify against `0x0FD3`, not just a deadline number (`test_closeRound_recordsAttestationEvidence`).

A member is marked missed only if they have no contribution for the round and `accepted[circleId][member]` is true. Consent is granted by organising the circle, redeeming an invite, calling `acceptMembership`, or paying into the circle at least once. A member listed by `createCircle` who never opted in is never penalised (`test_listedButUnconsentedMemberIsNeverPenalised`).

At circle creation `_initCircle` (line 778) refuses a circle whose round 0 is already over: `get_latest_attestation_height_and_hash(chainKey)` is read and `startHeight + roundBlocks <= latest.height` reverts `InvalidCircle("round 0 already attested")`. Without this an organiser could open an invite circle in the past, collect consent through invites, and close round 0 on every invitee as missed (`test_redeemInvite_cannotBeGriefedByPastStart`).

## Rotation

`closeRound` picks the recipient with `_pickRecipient` (line 826). The rule that never bends: the recipient must have a proven contribution for the round being closed.

**Fixed** (the default): walk the member list starting at index `r`, wrapping, and take the first member who paid this round and has not received a pot in this circle. The classic ROSCA order, with non-payers and prior recipients skipped.

**ByScore**: among members who paid this round and have not received, take the highest `creditScore`; ties go to the earlier member. Because misses and late payments are recorded before the pick, proven behaviour decides the order inside the circle as well as outside it (`test_byScore_missingMemberGoesLast_andEveryoneReceivesOnce`, `test_byScore_higherHistoryBeatsIndexOrder`). The organiser chooses the mode with `setRotation`, and only while round 0 is open with no contribution recorded, so the rule is known before the first payment (`RotationLocked` otherwise).

If nobody is eligible:

- On a non-final round the pot rolls forward: `_rounds[circleId][r + 1].pot += rd.pot`, `PotCarriedOver(circleId, r, amount)`, and the round closes with `recipient == address(0)`.
- On the final round (`r + 1 == members.length`) the has-not-received filter is lifted and the pot goes to a member who paid this round, so escrow never strands. `FallbackRecipient(circleId, r, recipient)` marks it (`test_finalRound_fallbackPaysAPayer`, `test_potCarriesOverToNextRound`).

Each recipient has `receivedPot[circleId][recipient]` set and `MemberRecord.received` incremented. After the final round the circle becomes `Completed`; otherwise `currentRound` advances and `RoundOpened` announces the next deadline.

## The Kitty Score

```
creditScore(member) = clamp(500 + 15 * onTime - 20 * late - 120 * missed, 300, 850)     // KittyLedger.sol:607
tier: A if >= 700, B if >= 600, C if >= 500, D otherwise
```

Bounds: 300 to 850 inclusive; a fresh address reads 500 and tier C. Fourteen on-time installments reach 710 (tier A); one miss from the base lands at 380 (tier D). Every input is a counter in `MemberRecord` (`onTime`, `late`, `missed`, `received`, `volume`), and the only writers are `_recordContribution` (a verified proof) and `closeRound` on the attested deadline path. No function takes a score or a counter as an argument (`test_creditScore_math`).

## Credit line and badge

`KittyCreditLine` ([`src/asc/KittyCreditLine.sol`](../src/asc/KittyCreditLine.sol)) lends `KittyUSD` against nothing but the ledger's record. `_underwrite` reads `getRecord` and `creditScore`; with zero proven installments the limit is 0; otherwise `limit = min(CAP, volume * factor / 100)` with factor 100 for tier A, 50 for B, 20 for C and 0 for D, `CAP = 5_000e6`. `borrow` adds a flat `FEE_BPS = 500` (5%) to the debt and the whole debt counts against the limit until repaid. LP deposits are share units priced at `poolValue / totalDeposits`, so fees repaid by borrowers raise every LP's entitlement and a late LP cannot capture fees earned before it joined (`test_secondLpDoesNotCaptureEarlierFees`).

`KittyBadge` ([`src/asc/KittyBadge.sol`](../src/asc/KittyBadge.sol)) is an ERC-721 with the ERC-5192 `locked` interface: `claim()` mints `tokenId = uint160(caller)` once the caller has at least one proven installment or miss, `_update` reverts `Soulbound()` for any transfer or burn, and `tokenURI` renders JSON and a 400 by 240 SVG from the live ledger on every read, so the picture changes as proofs land.

`pnpm receipts <address> [out.json]` ([`worker/src/receipts.ts`](../worker/src/receipts.ts)) and the "Proof bundle" button on `/score` export the same idea as a file: every `ContributionRecorded`, `ContributionMissed`, `RoundClosed` and `PayoutConfirmed` row for a member, with the source transaction, proven height, query id and Creditcoin transaction, plus both precompile addresses and the Proof Builder URL so a lender can re-run `pnpm verify:live <sourceTx>` without trusting Kitty.

## The steward: three layers

The worker in [`worker/src/worker.ts`](../worker/src/worker.ts) is an agent in three layers, and authority decreases toward the model.

| Layer | Where | Holds | What it does |
|---|---|---|---|
| 1, the ledger | `src/asc/KittyLedger.sol` | final say | The nineteen checks above, whoever calls. The steward's Creditcoin key has no role, no ownership and no allowance on the ledger; everything it calls is callable by anyone. |
| 2, deterministic decisions | `worker/src/agent/policy.ts` | timing only | Prove now, or wait for a fuller batch. A pure function of what is pending, where the attestation frontier is, and how much slack each payment has before its grace window closes. Every decision is written to `worker/src/agent/log.ts` with the chain state behind it. 17 unit tests. |
| 3, cited reasoning | `worker/src/agent/explain.ts`, `citations.ts` | none | Claude rewrites the decision log for a member. Every figure it states must be wrapped `[[like this]]` and must appear in the log; `check()` removes any sentence with an unverifiable citation or an uncited figure before display. Without an API key the deterministic sentence from layer 2 is shown instead. 12 unit tests. |

The one privileged action in the system is on Sepolia, not on Creditcoin: `KittyVault.payout` is `operator`-only, and this build runs the operator key in the steward process. `KittyVault` bounds it to `(circleId, round)` pairs not yet paid, to the circle's own escrow, and to recipients who have paid into that circle (`NotAContributor`). The ledger then requires a proof of the resulting `PaidOut` before the round can show `Paid`, so an operator that pays the wrong member or the wrong amount cannot make the ledger agree (`PayoutMismatch`).

The `stealFromSteward` scenario hands a fresh key the steward's exact powers and tries to take a pot (`NotOperator`), trust a vault (`OwnableUnauthorizedAccount`), close a round early (`RoundStillOpenOnSource`) and bind a circle to its own vault (`VaultNotTrusted`). The `poisonReasoning` scenario feeds the validator one true cited fact and three invented figures and requires all three to be stripped.

## Batch policy

`decideBatch(pending, frontier, opts)` in [`worker/src/agent/policy.ts`](../worker/src/agent/policy.ts) decides what the next `recordContributions` call carries. Its constants:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_BATCH` | 10 | The protocol maximum under one continuity proof; mirrors `KittyLedger.MAX_BATCH`. |
| `MAX_BATCH_RANGE` | 1000 | The Proof Builder's batch endpoint rejects spans of 1000 or more blocks (`BatchSpanTooLarge`, verified against `prover.cc3-testnet`). |
| `URGENT_BLOCKS` | 24 | With this much slack or less before a payment's grace window closes, prove now regardless of batch fill. |
| `ATTESTATION_LAG_BLOCKS` | 64 | How far the frontier may trail a roundmate's payment before holding for it stops being worth it. |

Derived quantities: `provable(p) = p.block <= attestedHeight`; `slack(p) = p.closeHeight - max(attestedHeight, sourceHead)`.

The algorithm:

1. Keep only provable payments. If none, `wait` (evidence: `pending`, `provable: 0`, `attestedHeight`, `waitingOnAttestation`).
2. Group by chain key; one call carries one key. Serve the group with the smallest slack; on a tie, the larger group.
3. Sort most urgent first, then oldest block. Fill greedily to `MAX_BATCH`, skipping any payment that would stretch the batch to a span of `MAX_BATCH_RANGE` blocks or more. Leftovers stay pending.
4. Choose the reason, in priority order: `forced` (a `--once` pass), `full` (ten queries), `round-complete` (this batch carries a payment from every member of some round), `deadline-risk` (`slack <= URGENT_BLOCKS`), `waited` (the oldest payment has waited `WORKER_BATCH_WAIT_MS`, default 45 000 ms). Otherwise `wait`.
5. The roundmate hold: if the reason is only `waited`, some roundmate of a payment in the batch has paid on Sepolia but is not yet attested, and `slack > URGENT_BLOCKS + ATTESTATION_LAG_BLOCKS` (88 blocks), demote to `wait` and record `heldForRoundmates` and `holdUntilAttested`. Only the timer yields to the hold; `full`, `round-complete`, `deadline-risk` and `forced` still fire.

The hold exists because of a real event. On the first testnet ledger the 45-second timer fired before two of the three round-0 payments were attested, and the round settled in two calls (a batch of 1, then a batch of 2). With the hold rule the final ledger's round 0 settled as one batch of three in one precompile call (`0xac2a637f…652fe9` in [`TESTNET_LOG.md`](TESTNET_LOG.md)).

Before submitting, the worker asks the precompile's free view `verify` whether the batch holds (`preflight` in [`worker/src/verifier.ts`](../worker/src/verifier.ts)) and runs `staticCall` on the ledger to surface the custom error. A proof that would fail costs nothing. The browser does the same in `ProvePanel`.

## Gas, measured

`eth_estimateGas` against the live `0x0FD2` with real Proof Builder proofs for the three Sepolia deployment transactions (two in block 11 656 253, one in 11 656 295):

| Call | Continuity roots | Gas |
|---|---|---|
| single `verify`, tx at 11656253 #86 | 48 | 104,141 |
| single `verify`, tx at 11656253 #85 | 48 | 112,239 |
| single `verify`, tx at 11656295 #44 | 6 | 45,433 |
| three singles, total | | 261,813 |
| one batch `verify` of the same three | 48, shared | 199,375 |

The batch is 24% cheaper for three payments, and the saving grows with block age because the continuity proof is verified once instead of once per payment. On the ledger itself, the testnet log shows `recordContributions` at 390,516 gas for a batch of 1, 588,527 for a batch of 2 and 888,573 for a batch of 3 (each including decoding and storage), and `confirmPayout` at 372,484 and 386,582.

## Attestcoin coverage

| Interface | Function | Where |
|---|---|---|
| `INativeQueryVerifier` (0x0FD2) | `verifyAndEmit` (batch) | `recordContributions`, `confirmPayouts` |
| | `verifyAndEmit` (single) | `confirmPayout` |
| | `verify` (both view overloads) | `worker/src/verifier.ts` preflight; `web/src/lib/verifier.ts` preflight and re-verify; `worker/src/verify-live.ts` |
| | `calculateTxIndex` | `_computeQueryId`; `ReverifyModal`; `verify-live.ts` |
| `IChainInfo` (0x0FD3) | `is_height_attested` | `closeRound`; `worker/src/worker.ts` `closeRounds` |
| | `find_lowest_attested_after` | `closeRound` evidence; `web/src/hooks.ts` `useCoveringAttestations` |
| | `get_chain_by_key` | `_initCircle` registry check |
| | `get_latest_attestation_height_and_hash` | `_initCircle` frontier bound; `worker/src/worker.ts` `flushBatches`; `worker/src/api.ts` `/status`; `web/src/hooks.ts` `useAttestation` |
| | `get_attestation_bounds` | `web/src/hooks.ts` `useDeadlineBounds` |
| | `find_highest_attested_before`, `get_attestation_genesis_height`, `get_supported_chains` | declared in `src/interfaces/IChainInfo.sol`, exercised against the mock in `test/KittyMultiChain.t.sol` |

The Proof Builder is used at `/api/v1/attested-height/{chainKey}`, `/api/v1/proof-by-tx/{chainKey}/{tx}` and `/api/v1/proof-batch-by-tx/{chainKey}` (`worker/src/proofs.ts` through `@gluwa/usc-sdk`, `web/src/lib/prover.ts` directly, `worker/src/verify-live.ts` directly). `EvmV1Decoder` from `@gluwa/asc-contracts@0.2.1` decodes every proven transaction on chain, and the worker's local mode runs the SDK's `encoding.abiEncode` so the decoder is exercised on genuine transaction and receipt bytes even without the network.

Why not inherit `ASCBase`: its `execute` drops `chainKey` and the source block height before calling app logic. Kitty needs both, for chain binding and height-based deadlines, and needs the batch overload, so the ledger re-implements the same verify, dedupe, act pipeline with identical query-id derivation.

## Why Creditcoin

Credit history is the product. A member who has paid ten installments on time should be able to prove it to a lender who has never heard of Kitty, and the proof should not depend on Kitty's operator being honest or online. Creditcoin is the chain whose native purpose is exactly this record, and Attestcoin is what lets that record be built from transactions on the chain where people already hold stablecoins, without a bridge, a relayer or an oracle operator. `KittyCreditLine` and `KittyBadge` exist to show that a contract on Creditcoin can consume the score with no intermediary.

Per-circle chain keys make the ledger reusable across source chains: a circle stores `chainKey`, creation validates it against the on-chain registry, and the trusted-vault allowlist is keyed by chain, so one ledger serves Sepolia (key 1) and Ethereum mainnet (key 3) circles side by side while a vault trusted on one chain is not trusted on the other (`test/KittyMultiChain.t.sol`).

## What writability changes

The one action Kitty still delegates to an operator is the Sepolia payout. With Attestcoin writability, `closeRound` would publish `abi.encode(circleId, round, recipient, pot)` through the outbox, and a receiver on Sepolia would execute `KittyVault.payout` from that message; the operator key and the steward's Sepolia role disappear, and the proof-back becomes a formality rather than the only check on the operator. The same mechanism would let the vault refund a payment that landed after its round closed, gated by a proof of the ledger's `RoundClosed` event. Writability is not on testnet and is under third-party audit, so the operator path stays, bounded by `KittyVault` and checked by `confirmPayout`. See [`adr/0002-money-and-rules-on-different-chains.md`](adr/0002-money-and-rules-on-different-chains.md).

## Current state

Live on Ethereum Sepolia and Creditcoin CC3 Testnet since 12 September 2026, addresses in [`deployments.json`](../deployments.json). The Delhi Chit Circle (3 members, 100 tUSD, 200 Sepolia blocks a round, rotation by score) settled round 0 end to end on the final ledger: three Sepolia payments, one batch proof of three verified by `0x0FD2` in a single call, an early close, a 300 tUSD payout on Sepolia and its proof back to Creditcoin; round 1 has two payments proven and one member deliberately missing. Two more circles were opened on the same ledger afterwards (circle 2, Lagos Susu, 5 members, 50 tUSD, 300 blocks, fixed rotation; circle 3, Oaxaca Tanda, 3 members, 100 tUSD, 250 blocks, by score) with their round-0 payments on Sepolia. Every transaction is in [`TESTNET_LOG.md`](TESTNET_LOG.md).

Verification: 162 Foundry tests across 15 suites (unit, fuzz, stateful invariants with a rotation oracle and an attacker target, isolated gas measurements) with both precompiles mocked at their real addresses and one suite decoding genuine Proof Builder bytes; 29 worker unit tests for the batch policy and the citation validator; 8 attack scenarios that push real transactions through proof, precompile and ledger, run in CI on every push and recorded against the live testnets.

## Limits

Stated plainly, and expanded with mitigations in [`THREAT_MODEL.md`](THREAT_MODEL.md):

- The vault operator sends payouts and the steward process holds the operator key. Writability removes this once audited.
- A payout mis-routed inside the group (to a member who paid into the circle but is not the round's recipient) is not recoverable: `KittyVault` only bounds recipients to contributors; the ledger will refuse the proof-back, but the tokens have moved.
- Loan defaults in `KittyCreditLine` do not feed back into the score.
- Members paying through smart-account wallets are not credited, because the transaction's own `from` must equal the member (check 13).
- A payment that lands after its round has closed is never recorded and its escrow is not refunded by this build.
- The steward's timer is tuned to the observed attestation lag; a much slower attestor makes it fall back to smaller batches rather than miss a grace window, because `deadline-risk` fires on slack, not on the clock.
- Query-id derivation depends on `calculateTxIndex` of the precompile; the mock derives the index from the Merkle root, so local tests exercise the pipeline but not the real index arithmetic. `pnpm verify:live` and the testnet rounds cover the real one.
