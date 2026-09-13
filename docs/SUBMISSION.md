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

**In one paragraph.** Kitty is live on Creditcoin CC3 Testnet and Ethereum Sepolia: seven circles opened, five run to completion, 128 linked transactions. A whole round verified in one `verifyAndEmit` call; eight payments from two circles pooled into one call; a member creating a circle, paying and proving the entire round from the browser during the demo recording; a real missed payment closed on the attested deadline with the attestation recorded on chain; payouts proven back, in batch; all eight attack scenarios rejected or accepted exactly as designed against the live precompile; a Telegram bot in production; 162 Foundry tests including stateful invariants, 29 agent tests, 12 bot tests; a technical note, protocol spec, threat model, five ADRs, an audit checklist and a triaged static-analysis report. Everything below is backed by a transaction in `docs/TESTNET_LOG.md`.

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

Kitty does not import a credit record that already exists on another chain; it creates a primary one, from savings circles that run today with no bank at all. Every installment, deadline, payout and miss of the circle itself is proven or attested, stablecoins settle every round, the payout is proven back, and the agent that runs it holds a key with no power but a proof.

Three properties that follow from the design:

- **Settles up to ten payments from every open circle in one precompile call.** Payments from every
  open circle are pooled into one `verifyAndEmit` under a single continuity proof, preflighted for free with the view `verify`,
  and measured 24% cheaper than singles against the live 0x0FD2.
- **Has no clock but the attestor network.** Deadlines are Sepolia block heights; a round with a
  missing payment can close only when `is_height_attested(chainKey, deadline + 64)` says so, and
  the Ethereum payout is proven back before the round shows *Paid*.
- **Does not care who submits.** Fire the steward and a stranger's proof still settles the round;
  the steward's only on-ledger power is a proof.

## The five evaluation pillars

- **User base expansion.** Savers who already run chit funds, susu, tandas and chamas become Creditcoin users the moment their circle settles through Kitty. They arrive through the Telegram bot and Mini App, signed invite links and ordinary stablecoin payments; their proof-derived history is readable by any Creditcoin lender via `creditScore(address)`.
- **Technical alignment.** The ledger acts only on what 0x0FD2 verified and 0x0FD3 attested: batch verification across circles, free preflight, batch proof-back, six ChainInfo functions, browser-side proving, mainnet chain key, all exercised on the live precompile.
- **Product vision.** Next: mainnet circles under chain key 3 with a USDC vault, score-gated circle sizes, seat bidding, pot cover, loan defaults feeding the score, lender integrations, then payouts through Attestcoin writability so the last operator key disappears.
- **Execution capability.** 100 commits in six days by one builder: contracts with 162 tests, steward, dashboard, bot, full documentation, four testnet deployments, 128 linked transactions, a recorded demo; every problem found live was fixed and logged the same day.
- **Proven models.** A centuries-old savings mechanism (regulated as chit funds in India), the credit-bureau score lenders already price against, and a per-round fee priced against the chit-fund foreman's commission, made cheap by batch proofs.

Full treatment: `docs/PILLARS.md`.

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
  is keyed by chain; a batch under the wrong key reverts `WrongChain`. Ethereum mainnet (chain key 3)
  was exercised against the live precompile: a real mainnet transaction verified `true`, the
  wrong-key negative reverted. `get_supported_chains` drives the chain picker on the create page.
- `is_height_attested(chainKey, deadline + 64)` on 0x0FD3 is the only clock: no timestamps, no
  admin close.
- The dashboard reads `find_lowest_attested_after` and `get_attestation_bounds` to show which
  attestation covers each payment and whether a deadline is covered.
- `PaidOut` on Ethereum is proven back through `confirmPayout`, and the steward proves several payouts back under one continuity proof with the batch `confirmPayouts`
  before a round can show *Paid*.
- Browser-side proving through the CORS-open Proof Builder; the ledger checks the proof, never the
  caller.
- Live on Creditcoin CC3 Testnet: KittyLedger at
  `0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276` (with KittyViewer, KittyUSD, KittyCreditLine and
  KittyBadge) trusts its paired KittyVault `0xa27eD42Ce06AaBe1D5924272fDb913b4CBC0DA84` on Sepolia.
  Everything below happened on 12 September 2026. On the first ledger (`0xc6fe…c2dE`): three
  Sepolia payments, two batch proofs verified by 0x0FD2, an early close, a 300 tUSD payout on
  Sepolia and its proof back to Creditcoin, then all eight attack scenarios against the live
  precompile (including a real late payment after the attested deadline). On the final ledger,
  with the roundmate hold rule: three circles; the Delhi Chit Circle's round 0 verified as one
  batch of three in a single precompile call, closed, paid out and proven back; round 0 of two
  more circles verified as one cross-circle batch of eight; a five-member round as one batch of
  five; a member proving their own payment from the browser during the demo recording; a real
  missed payment closed on the attested deadline with the attestation recorded on chain; two
  circles run to completion. Every transaction is linked in `docs/TESTNET_LOG.md`.
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
- Demo video (5:27): https://youtu.be/ajHBt2ANKtA (mp4 on the release)
- Deck: https://github.com/Prashant-thakur77/Kitty/releases/download/v2-submission/Kitty-deck.pdf
- Release: https://github.com/Prashant-thakur77/Kitty/releases/tag/v2-submission
- Telegram bot (self-hosted, `pnpm bot`; demonstrated at 4:28 in the video as https://t.me/KittyCirclesBot): `/circle 4`, `/score 0x…`, `/watch circle 4`, `/steward`; opens the dashboard as a Mini App
- Integration write-up: `docs/ATTESTCOIN_INTEGRATION.md`
- Contracts: KittyLedger https://creditcoin-testnet.blockscout.com/address/0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276 · KittyVault https://sepolia.etherscan.io/address/0xa27eD42Ce06AaBe1D5924272fDb913b4CBC0DA84 · all addresses in `deployments.json`
- Sector: DeFi

## Team

1 member: Prashant (solo builder).
