# Submission fields, BUIDL CTC 2026 Fall (DoraHacks)

Everything below maps to a field on the DoraHacks form. The technical write-up the rules require is
`docs/ATTESTCOIN_INTEGRATION.md`; the demo chapter list is in `README.md` under Demo.

## Project name

Kitty

## Tagline

*Savings circles where every payment is proven, not promised.*

## Short description

Kitty is a rotating savings circle (chit fund, susu, tanda) whose money stays in stablecoins on
Ethereum and whose rules run on Creditcoin, fed only by transactions the Attestcoin Protocol has
verified. The output is a Kitty Score built from proven payments and attested deadlines, which
`KittyCreditLine` lends against and any Creditcoin lender can underwrite.

## Full description

**Problem.** Hundreds of millions of people save through rotating circles: chit funds in India,
susu in Ghana, tandas in Mexico, chamas in Kenya, stokvels in South Africa. They work because
members watch each other. They fail in the same two ways: a treasurer disappears with the pot, or a
member stops paying and nobody outside the group ever knows. Years of perfect payments build zero
formal credit history. Existing on-chain ROSCA apps put the money and the rules on one chain and
still need a random-number oracle or an admin to run the rotation.

**Solution.** Kitty keeps the money where members already hold stablecoins (Ethereum) and puts the
rules where credit history belongs (Creditcoin). Members pay into a minimal escrow vault on Sepolia.
The Attestcoin Protocol proves those payments to a Creditcoin ledger that enforces deadlines from
attested block heights, closes rounds, picks the rotation recipient deterministically, and records
on-time, late and missed as a Kitty Score. Payouts are proven back, so the ledger only ever shows
money that verifiably moved.

What no other Attestcoin contract in this field does:

- **Settles up to ten payments from every open circle in one precompile call.** Payments from every
  open circle are pooled into one `verifyAndEmit` under a single continuity proof, preflighted for free with the view `verify`,
  and measured 24% cheaper than singles against the live 0x0FD2.
- **Has no clock but the attestor network.** Deadlines are Sepolia block heights; a round with a
  missing payment can close only when `is_height_attested(chainKey, deadline + 64)` says so, and
  the Ethereum payout is proven back before the round shows *Paid*.
- **Does not care who submits.** Fire the steward and a stranger's proof still settles the round;
  the steward's only on-ledger power is a proof.

## How it uses the Attestcoin Protocol

- Batch `verifyAndEmit` on 0x0FD2: up to 10 payments under one continuity proof, pooled across
  every open circle by a deterministic batch policy.
- Free view-`verify` preflight from both the worker and the browser; a proof that would fail is never
  submitted.
- `EvmV1Decoder` on every proven transaction: receipt status 1, exactly one `Contributed` log from
  the circle's vault, and the transaction's own `tx.to` and `tx.from` bound to the vault and member.
- Query ids derived byte-identically to `ASCBase` (`keccak(chainKey ‖ height ‖ txIndex)`) plus
  in-batch duplicate detection, so no proof counts twice.
- Per-circle chain key validated with `get_chain_by_key` at creation; the trusted-vault allowlist
  is keyed by chain; a batch under the wrong key reverts `WrongChain`.
- `is_height_attested(chainKey, deadline + 64)` on 0x0FD3 is the only clock: no timestamps, no
  admin close.
- The dashboard reads `find_lowest_attested_after` and `get_attestation_bounds` to show which
  attestation covers each payment and whether a deadline is covered.
- `PaidOut` on Ethereum is proven back through `confirmPayout` (and the batch `confirmPayouts`)
  before a round can show *Paid*.
- Browser-side proving through the CORS-open Proof Builder; the ledger checks the proof, never the
  caller.
- Live on Creditcoin CC3 Testnet: KittyLedger at
  `0xA3111Ee555Fb8420DE7A38572521f88888CeE2De` (with KittyViewer, KittyUSD, KittyCreditLine and
  KittyBadge) trusts KittyVault `0x1172ABd45724069749E9EB98A0349177435B284E` on Sepolia. The first
  circle settled round 0 end to end on 12 September 2026: three Sepolia payments, two batch proofs
  verified by 0x0FD2, an early close, a 300 tUSD payout on Sepolia and its proof back to
  Creditcoin. Round 0 landed in two calls (1 + 2) because the steward's batch timer fired before two
  payments were attested; the policy now holds for attested roundmates. Every transaction is linked
  in `docs/TESTNET_LOG.md`.
- Verified against the live precompile before deployment: a real Sepolia proof and a real 3-tx
  batch proof both returned `true` from the live 0x0FD2, tampered bytes and a wrong chain key
  reverted (`pnpm verify:live`), and the batch measured 24% cheaper than three singles.
- The Kitty Score is consumed on Creditcoin by `KittyCreditLine` and `KittyBadge`, and exported
  with `pnpm receipts` as a bundle a lender can re-check against the precompile.
- Eight attack scenarios run end to end in CI: six rejected, two accepted by design (a late
  payment, and a stranger's proof after the agent is fired).

## Links

- Repository: https://github.com/Prashant-thakur77/Kitty
- Live dashboard: https://prashant-thakur77.github.io/Kitty/
- Demo video (5:23): https://github.com/Prashant-thakur77/Kitty/releases/download/v2-submission/kitty-demo.mp4
  (also uploaded to YouTube as unlisted; paste that link in the video field)
- Deck: https://github.com/Prashant-thakur77/Kitty/releases/download/v2-submission/Kitty-deck.pdf
- Release: https://github.com/Prashant-thakur77/Kitty/releases/tag/v2-submission
- Integration write-up: `docs/ATTESTCOIN_INTEGRATION.md`
- Contracts: KittyLedger https://creditcoin-testnet.blockscout.com/address/0xA3111Ee555Fb8420DE7A38572521f88888CeE2De · KittyVault https://sepolia.etherscan.io/address/0x1172ABd45724069749E9EB98A0349177435B284E · all addresses in `deployments.json`
- Sector: DeFi

## Team

1 member: Prashant (solo builder).
