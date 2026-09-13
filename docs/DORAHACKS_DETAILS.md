![Kitty](https://raw.githubusercontent.com/Prashant-thakur77/Kitty/main/docs/assets/banner.png)

# Kitty

**Savings circles where every payment is proven, not promised.**

Kitty is a rotating savings circle (a chit fund, a susu, a tanda, a chama) where the money stays in stablecoins on Ethereum and the rules run on Creditcoin, fed only by transactions the **Attestcoin Protocol** has cryptographically verified. No treasurer, no oracle operator, no bridge. The output is a **Kitty Score**: a credit history built from nothing but proven payments and attested deadlines, which a lender on Creditcoin can underwrite against, for people the banking system has never seen.

**Live now:** dashboard https://prashant-thakur77.github.io/Kitty/ · Telegram bot https://t.me/KittyCirclesBot · source https://github.com/Prashant-thakur77/Kitty · demo https://youtu.be/ajHBt2ANKtA

## What is live on testnet

- KittyLedger `0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276` on Creditcoin CC3 Testnet, paired with KittyVault `0xa27eD42Ce06AaBe1D5924272fDb913b4CBC0DA84` on Ethereum Sepolia.
- Seven circles opened, five run to completion, **127 linked transactions** in [docs/TESTNET_LOG.md](https://github.com/Prashant-thakur77/Kitty/blob/main/docs/TESTNET_LOG.md).
- A whole round verified in **one `verifyAndEmit` call**; eight payments from two circles pooled into one call; two circles' payouts proven back in one `confirmPayouts` call.
- A member **creating a circle, paying and proving the entire round from the browser** during the demo recording.
- A **real missed payment** closed on the attested deadline, with the attestation that proved it stored on chain.
- All **eight attack scenarios** run against the live precompile: six decoded rejections, two accepted by design.
- A real **Ethereum mainnet** transaction verified under chain key 3 on the live precompile.
- 162 Foundry tests (unit, fuzz, stateful invariants with an attacker target), 29 agent tests, 11 bot tests, a triaged Slither report, CI green.

## The problem

Hundreds of millions of people save through rotating circles. Ten friends each pay the same amount every month and one of them takes the pot. It works because members watch each other, and it fails in two ways: the treasurer disappears with the pot, or a member stops paying and nobody outside the group ever learns. Ten years of perfect payments build no formal credit history.

## The solution

Kitty splits the circle along its natural seam.

| | Where | What lives there |
|---|---|---|
| Money | Ethereum Sepolia | `KittyVault`, a deliberately minimal escrow that holds stablecoins and emits two events. It does not know what a circle is. |
| Proof | Attestcoin Protocol | The attestor network attests Sepolia blocks on Creditcoin; the Proof Builder returns Merkle and continuity proofs; two precompiles verify them natively. |
| Rules | Creditcoin | `KittyLedger`, an Attestcoin Smart Contract: membership, deadlines, rotation, missed payments and the score. It acts on nothing but proven transactions and attested blocks. |

Kitty does not import a credit record that already exists on another chain. It creates a **primary** one, from savings circles that run today with no bank at all: every installment, deadline, payout and miss of the circle itself is proven or attested, stablecoins settle every round, and the payout on Ethereum is proven back before the round shows *Paid*.

![How a round settles](https://raw.githubusercontent.com/Prashant-thakur77/Kitty/main/docs/assets/architecture.png)

## How it uses the Attestcoin Protocol

- **Batch verification across circles.** `recordContributions` calls `verifyAndEmit` on `0x0FD2` with up to ten payments from every open circle under one continuity proof; measured 24% cheaper than singles against the live precompile.
- **Free preflight.** The precompile's view `verify` is called from the steward and from the browser before any gas is spent.
- **Decode and bind.** Every proven transaction is decoded with `EvmV1Decoder`: receipt status 1, exactly one `Contributed` log from a vault trusted on that chain, and the transaction's own `to` and `from` bound to the vault and the member.
- **The only clock is an attested block.** `is_height_attested(chainKey, deadline + 64)` on `0x0FD3` gates every deadline close; `find_lowest_attested_after` records which attestation proved each missed deadline; `get_chain_by_key` and `get_latest_attestation_height_and_hash` guard circle creation; `get_attestation_bounds` and `get_supported_chains` drive the dashboard. Six ChainInfo functions on the hot path.
- **Replay protection** with query ids derived byte-identically to `ASCBase`, plus in-batch duplicate detection.
- **Proof-back of payouts**, single and batch, so *Paid* is never an operator's claim.
- **Browser-side proving.** The Proof Builder is CORS-open; any member can prove a round from their own wallet. The ledger checks the proof and never the caller.

## The steward: an agent whose only power is proof

The worker has three layers with decreasing authority: the ledger has the final say; a deterministic policy decides only *when* to prove (batching for cost, urgency before a grace window closes, a hold for unattested roundmates); a language model explains the decision log in plain language, and a citation validator strips any sentence whose figures are not in the log. The steward's key holds no role, no ownership and no allowance. Fire it, and a stranger's proof still settles the round. Both properties are demonstrated in the attack lab.

## Product

![A circle](https://raw.githubusercontent.com/Prashant-thakur77/Kitty/main/docs/assets/circle.png)

Create a circle in one Creditcoin transaction, invite members with signed links, pay on Sepolia, prove from the browser, follow the rotation wheel and the proof feed, read a score dial replayed from ledger events, borrow against the score, ask the steward, run the attack lab, and get every proof and deadline pushed to Telegram. A 32-step guided tour explains every tab (`?tour=1`).

![What a lender sees](https://raw.githubusercontent.com/Prashant-thakur77/Kitty/main/docs/assets/score.png)

## The five evaluation pillars

- **User base expansion.** Savers who already run chit funds, susu, tandas and chamas become Creditcoin users the moment their circle settles through Kitty. They arrive through the Telegram bot and Mini App, signed invite links and ordinary stablecoin payments; their proof-derived history is readable by any Creditcoin lender via `creditScore(address)`.
- **Technical alignment.** The ledger acts only on what 0x0FD2 verified and 0x0FD3 attested: batch verification across circles, free preflight, batch proof-back, six ChainInfo functions, browser-side proving, the mainnet chain key, all exercised on the live precompile.
- **Product vision.** Next: mainnet circles under chain key 3 with a USDC vault, score-gated circle sizes, seat bidding, pot cover, loan defaults feeding the score, lender integrations, then payouts through Attestcoin writability so the last operator key disappears.
- **Execution capability.** 100 commits in six days by one builder: contracts with 162 tests, steward, dashboard, bot, full documentation, four testnet deployments, 127 linked transactions, a recorded demo; every problem found live was fixed and logged the same day.
- **Proven models.** A centuries-old savings mechanism (regulated as chit funds in India), the credit-bureau score lenders already price against, and a per-round fee priced against the chit-fund foreman's commission, made cheap by batch proofs. Full treatment: [docs/PILLARS.md](https://github.com/Prashant-thakur77/Kitty/blob/main/docs/PILLARS.md).

## Verify it yourself

1. Open https://prashant-thakur77.github.io/Kitty/circle/4 and follow any proven payment to its Creditcoin transaction.
2. Open https://prashant-thakur77.github.io/Kitty/lab for the eight scenarios recorded against the live precompile.
3. Run one proof against the live precompile from any machine: `git clone https://github.com/Prashant-thakur77/Kitty && cd Kitty && pnpm install && pnpm verify:live 0x2e6fb78a58bde01ea00469ddf5e5182a82594f58cba67c38f00db2d7b4ed40e8`
4. Send `/circle 4` to https://t.me/KittyCirclesBot.

## Documentation

Technical note, protocol specification, threat model, five ADRs, operations runbook, user scenarios, audit checklist, gas and static-analysis reports, and the required Attestcoin integration write-up: https://github.com/Prashant-thakur77/Kitty/blob/main/docs/README.md

Deck: https://github.com/Prashant-thakur77/Kitty/releases/download/v2-submission/Kitty-deck.pdf

Track: DeFi. Team: Prashant Thakur (solo). License: MIT.
