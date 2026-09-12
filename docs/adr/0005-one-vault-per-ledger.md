# ADR 0005: One vault per ledger

## Status

Accepted. Enforced by `scripts/deploy.sh` (a `FORCE_REDEPLOY=ledger` implies a fresh vault) and by `KittyLedger`'s `BeforeCircleStart` check. Applied on 12 September 2026, when the final ledger `0xC2A1…F276` was deployed paired with the fresh vault `0xa27e…DA84`.

## Context

`KittyVault` is deliberately ignorant of circles (ADR 0002). It keeps three pieces of state keyed by the `circleId` and `round` the caller supplies: `pot[circleId]`, `paidOut[circleId][round]` and `contributor[circleId][member]`. `KittyLedger` assigns circle ids densely from 1.

During the testnet campaign the ledger was redeployed three times in one day (v1 at block 5473022, v2, v3, then the final build) while the same vault stayed in place. Two problems appeared:

1. **Reused ids collide in the vault.** Circle 1 on the new ledger is a different circle from circle 1 on the old one, but the vault has already set `paidOut[1][0] = true` for the old ledger's round 0. The new ledger's round 0 can close and pick a recipient, and `KittyVault.payout(1, 0, …)` reverts `AlreadyPaid`. The round is stuck at `Closed` with no possible proof-back.
2. **Old payments look new.** `Contributed(1, 0, member, 100e6)` events from the old ledger's era sit in the vault's history with a valid proof. A new ledger that created circle 1 with a later `startHeight` would still see a `(circleId, round, member, amount)` that passes every field check. The worker hit exactly this: `batch failed: BeforeCircleStart(11686995, 11687030)` in the steward's decision log for the v3 run (the `worker/steward*.json` files are gitignored) is the v3 ledger refusing a payment that predated its circle.

## Decision

1. **A vault serves exactly one ledger.** `scripts/deploy.sh` treats `FORCE_REDEPLOY=ledger` as `FORCE_REDEPLOY=ledger,vault`: a new ledger is always paired with a new vault, trusted on the new ledger for the configured chain key. The script prints `ledger redeploy implies a fresh vault` when it adds the vault.
2. **The ledger refuses payments older than the circle.** `_recordContribution` reverts `BeforeCircleStart(height, startHeight)` when the proven height is below the circle's `startHeight`. This is the on-chain guard for problem 2 even when someone deploys without the script.
3. **The worker mirrors the rule** before the duplicate check, so a member's later, valid payment is not dropped as a duplicate of the stale one (`worker/src/worker.ts`, `flushBatches`).
4. **Deployments are recorded as pairs.** `deployments.json` and the README deployment table name the ledger and the vault it trusts; `docs/TESTNET_LOG.md` notes which vault each circle ran on.

## Consequences

Positive:

- A redeployed ledger starts with a clean vault: no `AlreadyPaid` collisions, no `contributor` state from another ledger's circles, no stale `Contributed` history that passes field checks.
- The invariant "a payment never predates its circle" (`docs/specs/PROTOCOL.md`, invariant 4) holds regardless of deployment hygiene.
- The first testnet ledger's history stays intact on its own vault for anyone auditing the log.

Negative:

- A ledger upgrade costs a vault deployment on Sepolia and requires members to approve the new vault for the token.
- Members' escrow on the old vault belongs to the old ledger's circles; it is not migrated. On testnet this was demo money; on a real deployment an upgrade would need a completion or refund plan for open circles.
- `TestUSD` and `FakeVault` are reused across pairs (they carry no per-circle state), which the script's `have` checks handle by leaving them in place unless forced.

## Alternatives considered

- **Namespace vault state by ledger address.** The vault would key `pot`, `paidOut` and `contributor` by `(ledger, circleId)`. Rejected for this build: the vault would then need to know its ledger, which is the coupling ADR 0002 avoids, and the `Contributed` event would need a fifth field that changes the decoder path and the trusted-emitter binding.
- **Let the ledger accept any height and rely on `processedQueries`.** Rejected: query ids are per ledger instance, so a new ledger has never seen the old proofs; replay protection does not help across deployments.
- **Bump circle ids past the old ledger's count.** Rejected: fragile, manual, and does nothing about stale `contributor` flags or stale payments.
- **Make `paidOut` resettable by the owner.** Rejected: an owner-resettable payout guard is a treasurer power.
