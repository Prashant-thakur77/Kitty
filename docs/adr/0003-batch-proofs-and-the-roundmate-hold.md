# ADR 0003: Batch proofs and the roundmate hold

## Status

Accepted. Implemented in `KittyLedger.recordContributions` and `confirmPayouts` (batch overload of `verifyAndEmit`), `worker/src/proofs.ts` (`getBatchProof` with a single-proof fallback), `worker/src/agent/policy.ts` (`decideBatch`), and `web/src/components/ProvePanel.tsx`. The hold rule shipped after the first testnet round settled in two calls.

## Context

The Attestcoin block-prover precompile accepts up to ten queries under one shared continuity proof. Verifying a continuity proof is the expensive part of a verification, and it grows with the distance between the attested header and the block. Measured against the live `0x0FD2` with real proofs, one batch `verify` of three transactions cost 199,375 gas against 261,813 for the same three as singles, a 24% saving that grows with block age.

A round of up to ten members is a natural batch. But payments arrive over minutes, and the attestor network attests Sepolia roughly every eight minutes, so at any moment some of a round's payments are provable and some are not. The steward has to decide when to stop waiting.

Two costs pull in opposite directions. Waiting fills the batch and saves gas. Waiting past a payment's grace window costs its owner 120 score points and marks them missed, which is worth far more than the gas.

The first testnet round exposed the naive version of this trade-off: the steward's 45-second timer fired while two of three payments were still unattested, and round 0 of the Delhi Chit Circle settled as a batch of 1 followed by a batch of 2 (`docs/TESTNET_LOG.md`, transactions `0xaf5a3477…` and `0x05ef192d…`).

## Decision

1. **The ledger accepts batches, pooled across circles.** `recordContributions` takes arrays of up to `MAX_BATCH = 10` and calls the batch overload once; each element is decoded and bound independently, and a failure anywhere reverts the whole call. The same shape serves `confirmPayouts`. Query ids are checked for replay and in-batch duplicates before the precompile is called.
2. **The worker preflights for free.** Before submitting, it asks the precompile's view `verify` (both overloads, `worker/src/verifier.ts`) and runs `staticCall` on the ledger. A proof that would fail costs nothing.
3. **Batch assembly is a pure function** (`decideBatch`): keep provable payments (block at or below the attested frontier); one chain key per call, serving the most urgent group; sort by slack then age; fill to ten without exceeding a span of `MAX_BATCH_RANGE = 1000` blocks, which the Proof Builder rejects.
4. **Urgency beats thrift, thrift beats impatience.** Fire on `forced`, `full`, `round-complete`, or `deadline-risk` (slack at most `URGENT_BLOCKS = 24`); otherwise on `waited` after `WORKER_BATCH_WAIT_MS` (default 45 s); otherwise wait.
5. **The roundmate hold.** If the only reason to fire is the timer, and some member of a round in the batch has paid on Sepolia but is not yet attested, and the most urgent payment still has more than `URGENT_BLOCKS + ATTESTATION_LAG_BLOCKS = 88` blocks of slack, wait instead, so the round lands in one call. The hold never overrides `full`, `round-complete`, `deadline-risk` or `forced`.
6. **Every decision is logged with its evidence** (`worker/src/agent/log.ts`): chain key, query count, circles, attested height, source head, slack, rounds completed, block span, payments left behind, seconds waited, payments still waiting, and when holding, `heldForRoundmates` and `holdUntilAttested`.

## Consequences

Positive:

- The final testnet ledger's round 0 settled as one batch of three in a single precompile call (`0xac2a637f…652fe9`).
- A ten-member round is one continuity check plus ten Merkle checks.
- Payments from different circles share a proof when they are close in height, which is what pooling across circles buys.
- The decision log is auditable without a model, and the model's explanations can only cite it.

Negative:

- A batch is atomic: one bad element reverts all of them. The worker therefore validates every candidate against the ledger before assembly (unknown circle, wrong amount, non-member, duplicate, pre-start height) and quarantines what can never be recorded.
- The Proof Builder's 1000-block span limit means a round whose payments are spread over more than a thousand blocks needs more than one call.
- The hold introduces a delay of up to one attestation for a payment whose roundmates are slow; the slack bound keeps that delay from ever reaching the grace window.
- Gas estimation through the precompile can fail; the worker floors the gas limit at 1,500,000 (`worker/src/chain.ts`) and the browser at 4,000,000.

## Alternatives considered

- **One proof per payment.** Rejected on cost (the measured 24%) and on call count; it also makes the "one call per round" story false.
- **Per-circle batching only.** Rejected: leaves the continuity proof unshared across circles that settle in the same window. Cross-circle pooling was the first item of the v2 plan (`docs/AGENT_PLAN.md`, A1).
- **A pure timer.** Rejected by the first testnet round: it splits rounds.
- **Always wait for the whole round.** Rejected: a single slow or absent member would hold every other member's proof until the grace window, and a member who never pays would hold it forever. Slack-bounded holding keeps the benefit without the hostage.
- **Letting the model decide timing.** Rejected: the decision has a right answer computable from chain state, and a model cannot be audited the way a pure function can. The model explains; it does not decide (`docs/AGENT_PLAN.md`, section 4).
