# Kitty against the five evaluation pillars

The organisers evaluate BUIDL CTC entries on five pillars: user base expansion, technical alignment, product vision, execution capability and proven models. This document answers each one directly, with the evidence that exists in this repository and on chain.

## 1. User base expansion

**Who the users are.** People who already save in rotating circles: chit funds in India, susu in Ghana and the Caribbean, tandas in Mexico, chamas in Kenya, stokvels in South Africa, paluwagan in the Philippines. These are savers and small borrowers, usually without a formal credit file. The World Bank's Global Findex counts about 1.4 billion adults without an account at a financial institution (2021), and informal savings groups are one of the main ways those adults save. A circle member is a Creditcoin user the moment their circle settles through Kitty, without holding CTC or knowing what a precompile is.

**How they arrive.** A circle is a group chat before it is anything else, so Kitty meets it there: the self-hosted Telegram bot ([`@KittyCirclesBot`](https://t.me/KittyCirclesBot) in the demo) answers `/circle` and `/score`, pushes every proof and payout, reminds members before a deadline, and opens the dashboard as a Mini App. An organiser opens a circle in one transaction from the browser and shares signed invite links; members consent by joining or by paying once. Payments are ordinary stablecoin transfers on the chain where members already hold money; Creditcoin is where the proof and the credit record live.

**What Creditcoin gains.** Every settled round writes proof-derived state to Creditcoin: contributions, deadlines, misses with the attestation that proved them, payouts proven back, and a Kitty Score. `KittyCreditLine` and `KittyBadge` show that other Creditcoin contracts can consume that state today; any Creditcoin lender can call `creditScore(address)` and `getRecord(address)`. The user base Kitty brings is the group of savers whose history is worth underwriting and who, until now, had nowhere to record it.

**Evidence so far.** Seven circles run on testnet by simulated members (127 linked transactions, [`TESTNET_LOG.md`](TESTNET_LOG.md)); the bot is live; a 32-step guided tour and a [`/guide`](https://prashant-thakur77.github.io/Kitty/guide) page onboard a first-time visitor without documentation.

## 2. Technical alignment

Kitty is built on the Attestcoin Protocol rather than beside it. The ledger acts on nothing but transactions the block-prover precompile has verified and heights the ChainInfo precompile has attested. The full account is in [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) and [`TECH.md`](TECH.md); the summary:

- `verifyAndEmit` in batch for up to ten payments pooled across every open circle under one continuity proof, and in batch again for payouts (`confirmPayouts`); the view `verify` as a free preflight from the steward and from the browser; `calculateTxIndex` for query ids identical to `ASCBase`.
- Six ChainInfo functions on the hot path, with `is_height_attested(deadline + 64)` as the only clock a round can close on and `find_lowest_attested_after` recording which attestation proved every missed deadline.
- Every proven transaction decoded with `EvmV1Decoder` and bound to the trusted vault, the member, the amount and the round.
- Exercised on the live precompile: a whole round in one call, eight payments from two circles in one call, batch proof-back, browser-side proving by a member wallet, an Ethereum mainnet transaction under chain key 3, and all eight attack scenarios.
- Deployed on Creditcoin CC3 Testnet with four ledger iterations in one day, each closing a gap found by running live (attested-frontier bound on start heights, payments that predate a circle, one vault per ledger).

## 3. Product vision

Kitty starts where credit starts for most of the world: a group that saves together. The roadmap keeps that anchor and grows outward.

| Horizon | Milestone | What it needs |
|---|---|---|
| Now | Circles on Sepolia settled on CC3 Testnet; score, credit line, badge; Telegram bot; browser proving | Shipped (this repository) |
| Next 30 days | Ethereum mainnet circles under chain key 3 with a USDC vault; score-gated circle sizes; seat bidding for early payout; pot cover funded by proven events | Mainnet vault deployment; the chain key path is already verified live |
| 60 to 90 days | Loan defaults on `KittyCreditLine` feeding the score; lender integrations on Creditcoin reading `creditScore`; organiser tooling in Telegram (open a circle from the group) | Partner lenders; bot write paths |
| Writability | Payouts sent by the ledger itself through Attestcoin writability, removing the last operator key | Writability audited and live on Creditcoin |
| CC3 mainnet | Circles settling from Ethereum mainnet and other attested chains into a mainnet ledger | CC3 mainnet Attestcoin availability |

The one constant across every horizon: a number on a Kitty Score is never an operator's word. Features that would need one are not on the roadmap.

## 4. Execution capability

**What shipped, and when.** The repository has 100 commits between 8 and 13 September 2026 by one builder. In that window: the vault and ledger with 162 Foundry tests including stateful invariants; the steward with a batch policy, decision log and citation validator; a dashboard with browser-side proving, circle creation, invites, a rotation wheel, a score dial, a guided tour and 3D scenes; a Telegram bot; a technical note, protocol specification, threat model, five ADRs, an operations runbook, user scenarios, an audit checklist, a static-analysis report and gas measurements; four ledger deployments on CC3 Testnet with 127 linked transactions; a 5:27 demo recorded against the live testnets. Every claim in the README links to a transaction or a file.

**How the work is run.** Each ledger change lands with tests first (`forge test`, invariants, fuzz), then a local two-chain rehearsal with the precompiles mocked at their real addresses (`pnpm e2e:local`, `pnpm scenarios`), then testnet, then the log. Problems found live were fixed the same day and recorded: the nonce clash when two processes shared the operator key, the lost payout hash, the shared vault across ledger deployments, the roundmate hold that turns two proofs into one. [`OPERATIONS.md`](OPERATIONS.md) is the runbook for all of it.

**Team.** Prashant Thakur, computer science undergraduate at NIT Hamirpur, Google Summer of Code 2026 contributor at Learning Equality, hackathon builder across frontend, blockchain and AI. The execution record above is the strongest statement of capability available; the plan for the next ninety days is in the table under Product vision, and every item in it is a change to code that already exists rather than a new system.

## 5. Proven models

**The savings circle is one of the oldest proven financial models.** Rotating savings and credit associations have run for centuries on every continent under local names, and in some jurisdictions they are regulated financial products: India's Chit Funds Act 1982 governs registered chit funds, with a foreman who runs the circle and takes a capped commission. Kitty keeps the mechanism exactly as people already run it (fixed installments, a pot per round, a rotation, a penalty for missing) and replaces the one part that fails, the treasurer, with proofs.

**The credit-history model is proven too.** Credit bureaus turn repayment behaviour into a score lenders price against; microfinance showed that group savings discipline predicts repayment. Kitty applies both: proven payments and attested deadlines become a score with the same shape lenders already understand (500 base, on-time and missed events, tiers), and a credit line underwrites from it.

**Business model.** The chit-fund foreman's commission is the reference price for running a circle. Kitty can run one for the cost of a batch proof: the steward proves up to ten payments in one precompile call (measured 24% cheaper than singles, and the saving grows with batch size), so a per-round protocol fee well below a foreman's commission covers operations. The credit line's spread and lender integrations reading the score are the second revenue line. Both are the same models the incumbents use, priced by proof instead of by trust.

**Technical models.** Nothing in Kitty is novel for its own sake: escrow with purpose-named events, a ledger that verifies before it writes, query-id replay protection identical to `ASCBase`, ECDSA invites, an ERC-5192 soulbound badge, an agent that proposes while the contract disposes. The novelty is in the composition and in insisting that every state change trace to a proof.
