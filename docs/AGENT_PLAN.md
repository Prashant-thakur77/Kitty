# Kitty v2 plan — deeper Attestcoin, plus an agent that cannot lie

> **Status, 12 September 2026.** The v2 plan, kept as written; section 2 describes the codebase before this work and the 8 September status in section 5b is historical (its counts have since grown to 162 Foundry tests, 29 agent tests, 11 bot tests and 8 attack scenarios, with five of the eleven ChainInfo functions on the hot path: `is_height_attested`, `find_lowest_attested_after`, `get_chain_by_key`, `get_latest_attestation_height_and_hash`, `get_attestation_bounds`). Tracks A, B and C all shipped and ran on testnet: cross-circle batches of eight and five in one precompile call, the steward's decision log on `/steward`, and the three agent-safety scenarios recorded against the live precompile. The current description is in [`TECH.md`](TECH.md) and [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md).

Goal: win on the criterion the organisers actually weight — *"Depth of Attestcoin Protocol
utilization will be evaluated as one of the core scoring criteria"* — and pick up the AI track's
framing without bolting a chatbot onto a DeFi app.

## 1. What actually wins, from the winners

| Project | Prize | The pattern worth copying |
|---|---|---|
| **SentinelCRE** (MIT, cloned) | Convergence 2026 · 1st CRE & AI | **Layered authority.** Layer 1 is hard on-chain policy "no AI can override". Layer 2 is a deterministic scoring engine. Layer 3 is AI, and even there *two models must agree*. The AI is the last layer, never the authority. |
| **InControl.finance** | Convergence 2026 · 1st Autonomous Agents | The chain is the **orchestration layer for agents**: consensus-verified data in, automated strategy out, agent-to-agent payments. Not "AI writes a summary". |
| **FlowVault** | Convergence 2026 · 1st DeFi | Verified inputs → **deterministic action**, executed autonomously, no human in the loop. |
| **TokenIQ** | Chromion 2025 · 1st DeFi | "Autonomous CFO": the agent *proposes*, the contract *executes* under fixed rules. |
| **loomcredit** (this hackathon) | competitor | Their own words: "bounded AI proposes financing terms that deterministic RiskGuard policies can approve, refer, or reject". |
| **AEOS** (this hackathon) | competitor | "cited AI analysis and deterministic DAO controls while keeping keys, signatures and assets under human control". |

The rule underneath all six: **AI proposes, the chain disposes.** Every winner makes the agent's
authority structurally limited and says so loudly. Every loser gives an LLM a private key.

Kitty starts from a stronger position than any of them, and we have not been saying it:
**the agent's only possible action is submitting a cryptographic proof.** There is no privileged
function to abuse. Anyone can call `recordContributions`, `closeRound` and `confirmPayout`; the
ledger checks the proof, not the caller. Remove the agent and members do the same from the browser.
That is a safety property, not a policy, and it is worth a slide of its own.

## 2. Where Kitty is thin today

- **ChainInfo precompile: 2 of 11 functions used.** We call `is_height_attested` and
  `get_latest_attestation_height_and_hash`. The precompile also exposes attestation bounds,
  nearest-attested search, checkpoints, genesis height, and the supported-chain registry.
- **Block prover: the view `verify` overloads are unused.** We only ever spend gas on
  `verifyAndEmit`. A free preflight is available and nobody uses it.
- **Batching stops at one circle.** The protocol allows up to 10 queries under one continuity
  proof; we group per (circle, round). Payments from *different circles* in the same window could
  share one proof and one call.
- **One source chain, hard-coded.** `SOURCE_CHAIN_KEY` is immutable. CC3 Testnet supports Sepolia
  (chainKey 1) and Ethereum mainnet (chainKey 3), and the registry is queryable at runtime.
- **No agent.** The worker is a script with an `if`. It does not decide anything.

## 3. Track A — Attestcoin depth (do this first; it carries the score)

**A1. Cross-circle batch proving.** `recordContributions` already takes arrays; teach the worker to
fill a batch of 10 across every open circle in the window, not just one. One continuity proof, one
call, one gas payment for the whole protocol's traffic. Measure it against the live precompile the
way we measured the 24% saving, and put the new number in the README.
*Files:* `worker/src/worker.ts` (batch assembly), `src/asc/KittyLedger.sol` (already supports it),
`docs/ATTESTCOIN_INTEGRATION.md` (gas table).

**A2. Free preflight with the view `verify`.** Before spending gas, call the precompile's
`verify(...)` view. If it returns false, never send the transaction. Log the difference. This is a
protocol feature nobody in the field is using and it is three lines.
*Files:* `worker/src/chain.ts`, `web/src/components/ProvePanel.tsx`.

**A3. Exact "provable at" from the precompile, not arithmetic.** Replace our
"deadline minus attested head" estimate with `get_attestation_bounds` and
`find_lowest_attested_after`, so the UI states precisely when a given payment becomes provable and
which attestation will cover it.
*Files:* `src/interfaces/IChainInfo.sol` (widen the interface), `web/src/hooks.ts`,
`web/src/components/ProvePanel.tsx`.

**A4. Multi-source-chain circles.** Move the chain key from an immutable to a per-circle field,
validated at creation against `get_chain_by_key` and the trusted-vault allowlist. A circle can then
settle from Sepolia *or* Ethereum mainnet, and the UI lists supported chains straight from
`get_supported_chains()`. This is the single biggest "depth" signal available to us.
*Files:* `src/asc/KittyLedger.sol`, `src/interfaces/IChainInfo.sol`, `test/KittyMultiChain.t.sol`,
`web/src/pages/Circles.tsx`.

**A5. Batch payout confirmation.** `confirmPayout` one at a time wastes the shared continuity
proof; add `confirmPayouts` taking arrays, same batch overload.
*Files:* `src/asc/KittyLedger.sol`, `worker/src/worker.ts`.

## 4. Track B — Kitty Steward, an agent whose only power is proof

Three layers, deliberately mirroring the structure that won CRE & AI, with our own twist that
layer 1 is *cryptographic* rather than a policy list.

**Layer 1 — structural authority limit (already true, now stated and demonstrated).**
The steward holds a key with no role, no ownership, no allowance. Its entire action space is:
submit a proof, close a round whose deadline is attested, confirm a payout that matches. Anything
else the ledger rejects. The demo proves it: hand the steward's key to the "attacker" scenario and
watch every abuse revert.

**Layer 2 — deterministic decision engine (no LLM).** The real decisions in Kitty are economic and
temporal, and they have right answers:
- *Prove now or wait?* Waiting fills the batch and saves gas; waiting past the grace window costs a
  member 120 score points. Score the trade-off from measured gas, batch fill, attestation lag and
  blocks-to-deadline.
- *Which payments go in this batch?* Prefer payments closest to their deadline, then cross-circle
  fill to 10.
- *Close now?* Only when full or when `closeHeight` is attested; never one block early.
- *Escalate?* A member who has missed twice, a circle whose vault fell out of the allowlist, a proof
  that fails preflight — these get flagged, not silently retried.
Every decision is recorded with its inputs and its outcome, so the log is auditable without an LLM.
*Files:* `worker/src/agent/policy.ts`, `worker/src/agent/decide.ts`, `worker/src/agent/log.ts`.

**Layer 3 — cited reasoning (LLM, advisory only).** Claude explains each decision and each score in
plain language, and **every factual claim must carry a citation** — a query id, a block height, or
a transaction hash. A validator checks each citation against chain state before the text is shown;
uncited or unverifiable claims are stripped, not displayed. The model never signs anything and
never changes a number.
*Files:* `worker/src/agent/explain.ts` (Anthropic SDK, `claude-sonnet-5`),
`worker/src/agent/citations.ts` (validator), `web/src/pages/Steward.tsx`.

**What the agent gives a member.** "Your payment is provable in 9 blocks, roughly 2 minutes. I will
include it in a batch with two payments from circle 3, which costs you 34% less gas than proving
alone. If the batch is not full by block 11,657,400 I will prove yours anyway, because your grace
window closes at 11,657,412." Every number in that sentence is cited and checkable.

## 5. Track C — proving the agent is safe (the demo moment)

Add to the attack lab, alongside the five existing scenarios:
- **"Steal from the steward"** — take the agent's key and try to move a pot, change a score, or
  close a round early. Each attempt reverts with its decoded error. The point: the agent's key is
  worth nothing.
- **"Fire the agent"** — stop the steward, prove the round from the browser instead, show the
  circle completing normally. The point: the agent is a convenience, not a dependency.
- **"Poison the reasoning"** — feed the explainer a fabricated claim; the citation validator strips
  it. The point: even the words are checked against the chain.

## 5b. Status — Tracks A, B and C landed 8 Sept

| Item | State |
|---|---|
| A1 cross-circle batching | done — pooled across circles behind `agent/policy.ts`, 8 unit tests |
| A2 free preflight | done — worker and browser both ask the view `verify` before spending gas |
| A3 attestation bounds | done; interface widened to 8 functions and tested against the mock; the dashboard reads bounds and lowest-after; 5 of 11 on the hot path |
| A4 per-circle chain key | done — circles settle from Sepolia or Ethereum mainnet; the vault allowlist is keyed by chain |
| A5 batch payout confirmation | done at contract level; the steward uses the single path since payouts are one per round |
| B Layer 1 | already structural; now demonstrated rather than asserted |
| B Layer 2 | done — deterministic policy plus a decision log every entry of which carries chain state |
| B Layer 3 | done — cited reasoning with a validator that strips unverifiable *and* uncited figures; degrades to the deterministic sentence with no API key |
| C three scenarios | done — all eight lab scenarios pass; `pnpm scenarios` runs them and exits with the tally |

103 Foundry tests, 26 agent unit tests, 8 attack scenarios, all in CI.

## 6. Schedule (9–13 Sept)

| Day | Work |
|---|---|
| **Tue 9** | A1 cross-circle batching, A2 preflight, measure the new gas numbers on the live precompile. Deploy the Creditcoin side the moment tCTC lands. |
| **Wed 10** | A3 attestation bounds in the interface and the UI. A4 per-circle chain key with tests. A5 batch payout. |
| **Thu 11** | Layer 1 hardening and its lab scenarios; Layer 2 decision engine with a decision log. |
| **Fri 12** | Layer 3 explainer with the citation validator; the Steward page; README section "Files using Attestcoin" refreshed with the new call sites. |
| **Sat 13** | Testnet soak with the steward running, re-record the demo, print the deck, submit. |

## 7. Deliberately not doing

Multi-agent swarms, an agent that holds funds, on-chain LLM output, a token, a mobile app, and
anything that needs a service we cannot demo offline. Every one of those adds risk without adding a
point on the scoring sheet.

## 8. Submission framing

Primary track stays **DeFi**; the write-up leads with the credit story and ends with the agent, so
the AI-track judges see it too. The one-line version becomes:

> Savings circles where every payment is proven, not promised — run by an agent whose only power is
> to submit proofs.
