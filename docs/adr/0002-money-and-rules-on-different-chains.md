# ADR 0002: Money and rules on different chains

## Status

Accepted. Implemented as `src/source/KittyVault.sol` on Ethereum Sepolia and `src/asc/KittyLedger.sol` on Creditcoin CC3 Testnet, connected only by Attestcoin proofs. The payout leg remains operator-driven until Attestcoin writability is audited and available.

## Context

Members of a savings circle hold stablecoins on Ethereum. Credit history belongs on Creditcoin, where lenders can read it. Existing on-chain ROSCA designs put the money and the rules in one contract on one chain and then need an admin, a random-number oracle or a bridge for the parts the contract cannot see.

The Attestcoin Protocol makes a different split possible: a contract on Creditcoin can act on an Ethereum transaction that the block-prover precompile at `0x0FD2` has verified, with no relayer trusted for correctness. The Attestcoin design guidance for source-chain contracts is to keep them minimal and to emit specific, unambiguous events rather than relying on common standards such as a bare ERC-20 `Transfer`.

Two things must be decided: how little the source-chain contract can do, and how money gets back out.

## Decision

1. **The vault is dumb.** `KittyVault` holds one ERC-20, exposes `contribute(circleId, round, amount)` and `payout(circleId, round, recipient, amount)`, and emits `Contributed` and `PaidOut` with the same four-field layout. It performs no membership, deadline, amount or round check on `contribute`; the ledger decides whether a payment counts. The trust surface stays on Creditcoin, where it is verifiable.
2. **The ledger acts only on proofs and attestations.** Every function that changes money-related state (`recordContributions`, `confirmPayout`, `confirmPayouts`, `closeRound`) takes either a proof verified by `0x0FD2` or reads `0x0FD3`. There is no function that takes a member's payment status as an argument.
3. **Proofs are bound, not just verified.** The ledger decodes each proven transaction with `EvmV1Decoder` and requires receipt status 1, a `Contributed` log from a vault trusted for the circle's chain and equal to the circle's vault, and the transaction's own `to` and `from` to be the vault and the member. The vault is registered per chain key, and the circle stores its chain key, validated against the ChainInfo registry.
4. **Payouts are proven back.** `KittyVault.payout` is executed by an operator on Sepolia, and the round shows `Paid` only after the resulting `PaidOut` is proven to the ledger with a recipient and amount that match what `closeRound` decided (`PayoutMismatch` otherwise).
5. **The operator is bounded, not trusted.** `payout` requires the recipient to have paid into that circle (`NotAContributor`), pays each `(circle, round)` once (`AlreadyPaid`), and only from the circle's own escrow (`InsufficientPot`).
6. **Writability replaces the operator when available.** With Attestcoin writability, `closeRound` would publish `abi.encode(circleId, round, recipient, pot)` through the outbox and a receiver on Sepolia would execute the payout from the vault. The vault's bounds and the proof-back stay as defence in depth.

## Consequences

Positive:

- Members interact with exactly one thing: a deposit on the chain where they already hold money. Everything else is derived.
- The ledger is auditable in isolation: its inputs are the precompile's answers, and `test/` exercises every check with the precompiles mocked at their real addresses.
- A member can finish a round from the browser without any operator (`ProvePanel`; the `fireTheAgent` scenario).
- The score built on Creditcoin is consumable by any Creditcoin contract (`KittyCreditLine`, `KittyBadge`) with no dependency on Kitty's operator.

Negative:

- One privileged action remains: the Sepolia payout. A compromised operator can mis-route a pot within the circle's contributors; the ledger will refuse the proof-back but the tokens have moved.
- Two chains means two RPCs, two gas tokens and an attestation lag between a payment and its proof. The dashboard shows the lag; the steward waits on it.
- A payment that arrives after its round has closed is escrowed but never credited, and this build has no refund path; that path is writability territory (a proof of the ledger's `RoundClosed` gating a vault refund).
- One vault serves exactly one ledger, because the vault marks payouts per `(circleId, round)` and a new ledger reuses circle ids (ADR 0005).

## Alternatives considered

- **One contract, one chain.** Rejected: puts the money on Creditcoin where members do not hold stablecoins, or the rules on Ethereum where credit history is not readable by Creditcoin lenders, and still needs a clock (ADR 0001).
- **A bridge or relayer.** Rejected: introduces a party trusted for correctness. Attestcoin's precompile makes the relayer trusted for liveness only.
- **Inheriting `ASCBase` from `@gluwa/asc-contracts`.** Rejected: its `execute` drops the chain key and the source block height before app logic, and Kitty needs both plus the batch overload. The ledger re-implements the verify, dedupe, act pipeline with identical query-id derivation instead.
- **A bare ERC-20 `Transfer` as the proven event.** Rejected: a transfer to the vault carries no circle or round and can be emitted by any token; purpose-named events let the ledger bind on emitter, signature and fields.
- **Membership and amount checks in the vault.** Rejected: duplicates ledger state on Sepolia, needs a sync mechanism, and gives the vault a reason to be wrong. The vault's only job is to hold money and say what it received.
