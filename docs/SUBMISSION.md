# Submission material — BUIDL CTC 2026 Fall

## Project name options
1. **Kitty** — "the kitty" is what every English-speaking savings group calls the pot. Short, warm, ownable.
2. **Susu** — West-African ROSCA; strong emerging-markets signal.
3. **Chitcoin** — chit-fund pun for an Indian audience; fun but narrows the story.

Chosen: **Kitty**.

## One-liners
- **Tagline:** *Savings circles where every payment is proven, not promised.*
- **Alt:** *Rotating savings on Ethereum stablecoins, settled and credit-scored on Creditcoin via Attestcoin.*

## Problem
Hundreds of millions of people save through rotating circles — chit funds in India, susu in Ghana,
tandas in Mexico, chamas in Kenya, stokvels in South Africa. They work because members watch each
other. They fail in the same two ways: a treasurer disappears with the pot, or a member stops
paying and nobody outside the group ever knows. Years of perfect payments build zero formal credit
history. Existing "ROSCA on-chain" apps put the money and the rules on one chain and still need a
random-number oracle or an admin to run the rotation.

## Solution
Kitty keeps the money where members already hold stablecoins (Ethereum) and puts the rules where
credit history belongs (Creditcoin). Members pay into a minimal escrow vault on Sepolia. The
Attestcoin Protocol proves those payments to a Creditcoin ledger that enforces deadlines from
attested block heights, closes rounds, picks the rotation recipient deterministically, and records
on-time / late / missed as a Kitty Score. Payouts are proven back, so the ledger only ever shows
money that verifiably moved. No treasurer, no oracle operator, no bridge.

## How it uses the Attestcoin Protocol (integration summary, paste into the form)
Kitty is an Attestcoin Smart Contract on Creditcoin CC3 Testnet that consumes proven Ethereum
Sepolia transactions through the block-prover precompile (0x0FD2) and the ChainInfo precompile
(0x0FD3). Each savings round is verified with a *single batch call* (`verifyAndEmit` with up to 10
Merkle proofs sharing one continuity proof) obtained from the Proof Builder via `@gluwa/usc-sdk`
(`getBatchProof`, with automatic fallback to single proofs). Every proven tx is decoded with
`EvmV1Decoder`: receipt status must be 1, the `Contributed` log must come from the registered vault,
and the transaction's own `to`/`from` must match the vault/member. Query ids are derived as in
`ASCBase` for replay protection; the chain key is pinned. Round deadlines are enforced by
`is_height_attested(chainKey, deadlineHeight)` — attested source-chain time is the only clock.
Payouts on Ethereum are proven back with a single `verifyAndEmit` before a round can show "Paid".
Members can also prove a round themselves from the browser (the Proof Builder serves CORS) and
submit from their own wallet — the ledger verifies, the submitter is irrelevant. The resulting
Kitty Score is *used* on Creditcoin: KittyCreditLine lends against it and a soulbound badge renders
it on-chain. Before deployment the whole path was validated against the live network: a real
Sepolia proof and a real 3-tx batch proof both returned `true` from the live 0x0FD2 precompile,
while tampered bytes and a wrong chain key reverted (`pnpm verify:live`). Integration doc:
`docs/ATTESTCOIN_INTEGRATION.md`; every file touching Attestcoin is tabled in the README.

## Demo video script (2:30)

**0:00–0:20 — Problem.** "This is Amara's savings circle in Lagos. Ten friends, 100 dollars a
month, one of them takes the pot each month. It works until the treasurer runs, or a member stops
paying and nobody outside the circle ever knows. Ten years of perfect payments, zero credit
history."

**0:20–0:35 — The idea.** "Kitty keeps the money on Ethereum where they already hold USDC, and
puts the rules on Creditcoin. Nobody has to trust a treasurer, an oracle operator, or a bridge —
because every payment is *proven* across chains by the Attestcoin Protocol."

**0:35–1:35 — Live loop.** Screen: dashboard.
- "Here's the circle on Creditcoin: 3 members, 100 tUSD per round, round 0 open, deadline is a
  Sepolia block number — not a timestamp." Point at attestation lag indicator.
- Member 1 clicks *Contribute*: MetaMask on Sepolia → tx. "That's a plain escrow deposit."
- Terminal: worker log. "The worker waits for the attestor network to attest that Sepolia block…
  then asks the Proof Builder for ONE batch proof for all three payments."
- Dashboard proof feed: "`0x0FD2 verified 3 tx in ONE call`. Three green rows: proven, on time, at
  block X. Then *Round closed → Amara receives 300 tUSD*."
- "The operator pays out on Sepolia, and that payout is proven *back* — the round only turns
  'Paid' when the ledger has seen the money move."

**1:35–2:05 — Failing safely.** Round 1: member 3 skips. "Nothing happens until the *deadline
block* is attested on Creditcoin — the ChainInfo precompile is our clock." Round closes, member 3 is
*Missed*, score drops from 515 to 395, tier D. Run `attack.ts`: "Replaying the same proof? Rejected:
`QueryAlreadyProcessed`. A fake event from another contract? `WrongEmitter`."

**2:05–2:30 — Why Creditcoin, what's next.** "Every number on this score is a proven transaction
or an attested deadline. That's a credit history a Creditcoin lender can underwrite against —
which is the whole point of Creditcoin. Next: score-gated circle sizes, seat bidding, and insuring
the pot with proven-event cover. Kitty — savings circles where every payment is proven, not
promised."

## Deck outline (8 slides → PDF)
1. Title + tagline. 2. The ROSCA problem (numbers: India chit funds ≈ $30B+/yr, Kenya chamas ≈
300k groups). 3. Who you trust today vs. with Kitty (table). 4. Architecture diagram
(docs/BUILD_PLAN.md). 5. Attestcoin depth: batch verify, decoder checks, ChainInfo clock, replay.
6. Demo screenshots: proof feed + score. 7. Kitty Score → lending on Creditcoin (CEIP fit).
8. Roadmap + team.

## README outline
Title/tagline · 60-second explanation · architecture diagram · live addresses (Sepolia + CC3) ·
quick start (tests, local e2e, testnet deploy, worker, dashboard) · Attestcoin integration
(link to doc) · security model (what is proven vs. what is operator-controlled) · roadmap · license.

## Form fields (DoraHacks)
- Sector: DeFi
- GitHub: `https://github.com/<you>/kitty` (push this repo)
- Deck PDF / video: upload to Drive/YouTube, paste links.
- Team: 1 member — Prashant (name, email, country, bio, role "solo builder").

## Narration text for TTS (feed to voiceover.py, one paragraph per clip)

1. This is Amara's savings circle in Lagos. Ten friends, one hundred dollars a month, one of them takes the pot each month. It works until the treasurer runs, or a member stops paying and nobody outside the circle ever knows. Ten years of perfect payments. Zero credit history.
2. Kitty keeps the money on Ethereum, where they already hold stablecoins, and puts the rules on Creditcoin. Nobody trusts a treasurer, an oracle operator, or a bridge, because every payment is proven across chains by the Attestcoin Protocol.
3. Here is the circle on Creditcoin. Three members, one hundred test dollars per round. The deadline is a Sepolia block number, not a timestamp. This indicator shows the latest Sepolia block and the latest block the attestor network has attested on Creditcoin.
4. A member pays. That is a plain escrow deposit on Sepolia. Nothing else is required from her.
5. The worker waits for the attestation, then asks the Proof Builder for one batch proof covering every payment in the round. The ledger verifies all of them with a single call to the block prover precompile, decodes each receipt, and binds it to the vault, the member, the amount and the round.
6. Round closed. Amara receives three hundred. The operator pays out on Sepolia, and that payout is proven back. The round shows Paid only after the ledger has seen the money move.
7. Round two. One member does not pay. Nothing happens until the deadline block itself is attested on Creditcoin. The ChainInfo precompile is the only clock. Then the round closes, the missed payment is recorded, and the score drops from five fifteen to three ninety five.
8. Try to cheat it. Replay a proof: rejected, query already processed. A fake vault emitting a perfect event: rejected, wrong emitter. Same proof on another chain key: rejected. A reverted transaction with a valid proof: rejected, the precompile proves inclusion, not success.
9. Every number in this score is a proven transaction or an attested deadline. That is a credit history a Creditcoin lender can underwrite against, which is the whole point of Creditcoin. Kitty. Savings circles where every payment is proven, not promised.

## Backup demo video (already recorded)

`docs/assets/` does not carry the file (size); the local rehearsal recording lives at
`kitty-demo-local.mp4` (2:38, 1280×720, narrated). It walks the whole loop against the two-anvil
world: landing → circle → members pay on the source chain → worker fetches ONE batch proof →
`0x0FD2 verified … in ONE call` → round closes → payout proven back → a member misses and drops to
tier D → attack lab rejects a replay and a spoofed emitter → score and credit line.

Narration was generated locally with the Chatterbox TTS pipeline (`chatterbox-env`), one clip per
segment; the muxing command is in the repo history. Re-record against the testnet once the
Creditcoin side is deployed, using `docs/DEMO_RUNBOOK.md`; keep this file as the fallback if the
attestation lag is unlucky on the day.
