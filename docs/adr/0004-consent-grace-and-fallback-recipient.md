# ADR 0004: Consent, grace, and the fallback recipient

## Status

Accepted. Implemented in `KittyLedger`: `accepted`, `_accept`, `acceptMembership`, `redeemInvite`, `GRACE_BLOCKS`, `closeRound`, `_pickRecipient`, `PotCarriedOver`, `FallbackRecipient`. Covered by `test/KittyLedger.t.sol`, `test/KittyInvites.t.sol` and `test/KittyRotation.t.sol`.

## Context

The adversarial review before submission asked three questions that a proof-settled ledger has to answer without an administrator:

1. **Who can be hurt?** `createCircle` lets an organiser list any address. If listing alone were enough, anyone could open a circle naming a stranger and, when the deadline passed, hand them a permanent miss worth 120 score points.
2. **Who can close a round?** Anyone, by design (ADR 0001). But a payment mined at the deadline block is provable only after that block is attested, which is the same moment the deadline itself is attested. Without a window, whoever closes first wins against an honest payer.
3. **Where does the pot go when nobody qualifies?** The recipient must have paid this round and must not have received before. In a round where the only payers have already received, or where nobody paid, the pot has no eligible recipient. Escrow that stays in the vault with no ledger recipient is money nobody can claim.

## Decision

### Consent

- A member is penalised (`missed += 1`) only if `accepted[circleId][member]` is true when the round closes on the deadline path.
- Consent is granted by exactly four acts, all attributable to the member: organising an open circle, redeeming an invite signed by the organiser, calling `acceptMembership`, or having a proven contribution recorded in the circle (paying is consent).
- Listing by `createCircle` grants membership (`isMember`) but not consent. Until a listed member opts in, the circle does not appear in their `getMemberCircles` and cannot touch their record.
- Consent is irreversible and `_accept` is idempotent; `MembershipAccepted` is emitted once.
- Invites are EIP-191 signatures over `(ledger, chainid, circleId, invitee, nonce)`, single-use per `(circleId, nonce)`, redeemable only by the invitee, only while the circle is open and round 0 has no contribution.
- Because consent can be collected before the first deadline, creation refuses a circle whose round 0 is already over on the source chain (`InvalidCircle("round 0 already attested")`).

### Grace

- `closeHeight = deadlineHeight + GRACE_BLOCKS`, `GRACE_BLOCKS = 64`.
- A round with missing payments cannot close until the close height is attested. A payment proven inside the window with `height <= deadlineHeight` is on time; one with a higher height is late, never missed, as long as it is recorded before the close.
- The window is a constant so that no organiser can shorten it.

### Fallback recipient

- Both rotation modes require a proven contribution for the round and, normally, no prior pot.
- If nobody qualifies on a non-final round, the round closes with `recipient == address(0)`, its pot is added to the next round's pot, `PotCarriedOver` is emitted, and the closed round's pot is zeroed.
- On the final round (`r + 1 == members.length`) the has-not-received filter is lifted: the first payer in rotation order (Fixed) or the best-scoring payer (ByScore) receives, and `FallbackRecipient` marks the exception. The requirement to have paid this round is never lifted.
- A final round in which nobody paid keeps its pot with no recipient; releasing it needs a refund path the vault does not have in this build.

## Consequences

Positive:

- Nobody can be penalised for a circle they did not join (`test_listedButUnconsentedMemberIsNeverPenalised`), and the consent trap through a past start is closed (`test_redeemInvite_cannotBeGriefedByPastStart`).
- An honest payer at the deadline block cannot be raced by a closer (`test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace`).
- Escrow does not strand when the circle completes with at least one payer in the last round (`test_finalRound_fallbackPaysAPayer`, `test_potCarriesOverToNextRound`).
- Every miss carries the attestation that proved it (`test_closeRound_recordsAttestationEvidence`).

Negative:

- A member listed by `createCircle` who never opts in and never pays is invisible to the score, which means a circle can carry a passive non-payer whose absence costs them nothing. The organiser's remedy is to use invites, which require the invitee's signature-bound action.
- Rounds with missing payments take 64 blocks longer to close than the deadline suggests.
- The fallback can pay a member a second pot. It is marked by an event and counted in `received`, so a lender can see it, but it does change the "everyone receives exactly once" story into "at most once, except by explicit final-round fallback".
- A carried-over pot makes the next round's payout larger than `contribution * members`, which the dashboard shows as the round's pot.

## Alternatives considered

- **Listing as consent.** Rejected: the griefing vector above.
- **Consent by signature only (no consent by paying).** Rejected: paying into a circle is the clearest possible opt-in, and requiring a separate transaction from a member who has already paid adds a step that only hurts honest members.
- **A per-circle grace parameter.** Rejected in ADR 0001.
- **Pot to the organiser or to the contract owner when nobody qualifies.** Rejected: both are treasurer roles.
- **Refund the pot pro rata when nobody qualifies.** Preferred in principle, but a refund is a source-chain action gated by ledger state, which is writability territory. Carry-over plus final-round fallback covers every case except a final round with no payer.
- **Lottery or VRF for the recipient.** Rejected: deterministic order or proven score is auditable; randomness needs an oracle.
