# ADR 0001: Attestation as the only clock

## Status

Accepted. Implemented in `src/asc/KittyLedger.sol` (`deadlineHeight`, `closeHeight`, `closeRound`, `_initCircle`) and `src/interfaces/IChainInfo.sol`. Deployed on Creditcoin CC3 Testnet.

## Context

A rotating savings circle needs a deadline per round and a rule for what happens when it passes. Every design that puts the rule on one chain has a clock problem:

- `block.timestamp` on the rules chain says nothing about when a payment happened on the money chain.
- A timestamp carried in the proof is a value the proof does not authenticate.
- An admin or oracle that declares "the round is over" is a treasurer with a different name, and the whole point of Kitty is that there is no treasurer.

Kitty's money is on Sepolia and its rules are on Creditcoin. The one fact about Sepolia time that Creditcoin can verify is which Sepolia block heights the attestor network has attested, exposed by the ChainInfo precompile at `0x0FD3` through `is_height_attested`, `get_latest_attestation_height_and_hash`, `find_lowest_attested_after` and `get_attestation_bounds`.

A second constraint follows from how proofs land. A payment mined at the deadline block becomes provable at the same moment that block is attested, which is also the moment the deadline itself becomes "past". If the deadline were the close height, a rival could close the round between the attestation and the proof and record the payer as missed.

## Decision

1. Every deadline is a source-chain block height. For circle `c` and round `r`, `deadlineHeight = c.startHeight + (r + 1) * c.roundBlocks`. There are no timestamps anywhere in the ledger.
2. A contribution is on time iff its proven source height (taken from the proof, not from the submitter) is at most the deadline height.
3. A round with missing payments may close only when `CHAIN_INFO.is_height_attested(c.chainKey, deadlineHeight + GRACE_BLOCKS)` is true, with `GRACE_BLOCKS = 64`. Otherwise `closeRound` reverts `RoundStillOpenOnSource(closeHeight)`. A round where everyone has paid may close at once.
4. On the deadline path, `closeRound` records which attestation proved the deadline (`find_lowest_attested_after(c.chainKey, closeHeight)`) on the round and in every `ContributionMissed` and `RoundClosed` event of that round.
5. At creation, round 0's deadline must lie beyond the attested frontier (`get_latest_attestation_height_and_hash`), else `InvalidCircle("round 0 already attested")`.
6. The grace window is a constant, not a parameter: 64 blocks covers the observed testnet attestation lag (roughly 36 to 40 Sepolia blocks) plus the time to fetch and submit a proof, and a constant cannot be tuned against a member.

## Consequences

Positive:

- No party can end a round early, including the steward, the organiser and the ledger owner. The `stealFromSteward` scenario shows `closeRound` reverting `RoundStillOpenOnSource` for a fresh key.
- Late is a property of a proof, not a claim: `test_lateContributionIsFlagged` and the `late` scenario.
- A miss is auditable against the precompile: a lender holding the `attestedHeight` and `attestedHash` from a `ContributionMissed` event can ask `0x0FD3` directly.
- The consent-trap through a past start is closed structurally (`test_redeemInvite_cannotBeGriefedByPastStart`).

Negative:

- Round lengths are in blocks, which members must translate to time. The dashboard shows the deadline as a Sepolia block and a tick bar of attested versus mined blocks.
- Every round with a missing payment takes at least the attestation lag plus 64 blocks after the deadline to close. On testnet that is roughly 15 to 20 minutes after the deadline.
- A payment mined in time whose proof does not land within the grace window is lost to the round and, in this build, not refunded (`THREAT_MODEL.md`, limit 2).
- The steward's batching policy has to reason in blocks of slack rather than seconds (`worker/src/agent/policy.ts`, `slack`), and the browser has to show which attestation covers each payment (`useCoveringAttestations`).

## Alternatives considered

- **`block.timestamp` on Creditcoin.** Rejected: it is unrelated to when the Sepolia payment was mined and would let a fast proof of a late payment count as on time.
- **A timestamp inside the proven transaction.** Rejected: `EvmV1Decoder` exposes the receipt and common fields, not the block timestamp; and the block height is what the proof authenticates.
- **An operator-declared close.** Rejected: reintroduces the treasurer.
- **No grace window, close at the deadline.** Rejected: the race described above lets an on-time payer be recorded as missed by whoever closes first.
- **A per-circle grace parameter.** Rejected: an organiser could set it to zero and recreate the race; a constant is safer and simpler.
- **Waiting for a checkpoint rather than an attestation.** Not needed: the attestation is the finer-grained fact and `is_height_attested` answers it directly.
