# Kitty — hackathon strategy (BUIDL CTC 2026 Fall)

> **Status, 12 September 2026.** This is the pre-build strategy document, kept as written. Idea A shipped: contracts live on Creditcoin CC3 Testnet and Ethereum Sepolia (`deployments.json`), three circles settled through the live precompiles, eight attack scenarios recorded against them, 162 Foundry tests, 29 agent tests and 11 bot tests in CI, the demo video and the twelve-slide deck published. The current description is in [`TECH.md`](TECH.md), [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) and [`SUBMISSION.md`](SUBMISSION.md); every transaction is in [`TESTNET_LOG.md`](TESTNET_LOG.md).

Target: **BUIDL CTC 2026 Fall — "BUIDL For The Real World"** (DoraHacks, Creditcoin + Credit Labs).
Prize: $10k / $3k / $2k + CEIP fast-track for the top three. Track chosen: **DeFi** (prizes are
awarded overall, not per track — the track is a label; depth of Attestcoin use is a scored criterion).

## 1. Winners studied

The first BUIDL CTC edition (Dec 2025 → Mar 2026) has no public winners list reachable from
outside DoraHacks' bot wall (the hackathon page and `/winner` route return 403/405 to non-browser
clients, and Creditcoin's blog has no results post). So the sample mixes the closest analogues:
hackathons whose whole theme is "smart contracts acting on verified off-chain / cross-chain data",
plus the one on-chain ROSCA that has already won a sponsor prize.

| # | Project | Hackathon · year | Prize | What it did | Tech | Why judges picked it | Link |
|---|---|---|---|---|---|---|---|
| 1 | **YieldCoin** | Chainlink Chromion · 2025 | Grand prize $35,000 | Fully on-chain stablecoin yield optimiser re-allocating capital across chains/protocols | Solidity, CCIP, Automation, Functions | "Stood out across all categories": one loop (observe → verify → move money) shown end-to-end across chains | https://devfolio.co/submissions/yieldcoin-112a |
| 2 | **Yieldx** | Chainlink Chromion · 2025 | 1st Tokenization/RWA $16,500 | Tokenised invoices; investors earn yield on real-world receivables | Solidity, Functions, Data Feeds | Real cash-flow problem (trade finance); verifiable off-chain data feeding an on-chain decision | https://devfolio.co/submissions/yieldx-2ea4 |
| 3 | **TokenIQ** | Chainlink Chromion · 2025 | 1st DeFi $16,500 | "Autonomous CFO" treasury manager proposing and executing yield strategies | CCIP, Automation, Data Feeds | Deterministic execution gated on verified data; strong dashboard demo | https://devfolio.co/projects/tokeniq-240e |
| 4 | **HTTPayer** | Chainlink Chromion · 2025 | 1st Cross-chain $10,000 | Automated stablecoin payments for SaaS/API subscriptions, off-chain→on-chain settlement | CCIP, Functions | Payments-shaped, tiny surface, obviously useful, every step visible in the demo | https://devfolio.co/projects/httpayer-2357 |
| 5 | **FlowVault** | Chainlink Convergence · 2026 | 1st DeFi & Tokenization | ERC-4626 vault ingesting cross-chain indicators and re-allocating autonomously | CRE, ERC-4626 | Verified multi-chain inputs → deterministic on-chain action | https://chain.link/hackathon/winners/flowvault |
| 6 | **SentinelCRE** | Chainlink Convergence · 2026 | 1st CRE & AI | 3-layer risk monitoring (compliance, behaviour scoring, multi-AI consensus) | CRE | Judges reward "a score you can audit" | https://chain.link/hackathon/winners/sentinel-cre |
| 7 | **Saving Circles** | ETHGlobal Buenos Aires · 2025 | Chainlink "Connect the World" track winner | On-chain ROSCA (tanda/chama/consórcio) with VRF draws and NFT seats | Solidity, Chainlink VRF, ERC-721, Foundry, Sepolia | Hundreds of millions use ROSCAs; real-world framing + fairness angle | https://ethglobal.com/showcase/saving-circles-bmgxr |
| 8 | **ConvenantX** *(current field)* | BUIDL CTC 2026 Fall | competitor | Attestcoin proves Aave activity; Creditcoin restricts lending when a covenant is breached | Attestcoin readability | Representative of the field: single-tx proof → one flag flipped | https://dorahacks.io/buidl/48233 |

Field snapshot (64 BUIDLs, 246 hackers): ≈9 RWA, ≈8 DeFi, ≈4 AI, ≈3 DePIN, 1 Gaming among visible
entries. Nearly every entry is "prove one Ethereum event → flip one flag on Creditcoin".

## 2. Winning patterns

**Problem framing** — one sentence a non-crypto person nods at; a named real-world population
(CEIP scores "emerging markets" and "tangible real-world problems"); the trust gap stated as *who
you no longer have to trust* (no oracle operator, no bridge, no treasurer).

**Demo style** — one loop shown end to end with the sponsor primitive visibly in the middle (the
"verifying via 0x0FD2…" moment); the explorer, not slides; something that *fails safely* on camera
(a spoofed event rejected, a late payment flagged); a dashboard that reads like a product.

**Features judges reward** — depth: batch verification, decoding calldata *and* logs, using the
chain-info precompile as a clock, replay protection, emitter binding; deterministic on-chain rules
over off-chain discretion; evidence of understanding the protocol's edges ("the precompile proves
inclusion, not success — we check receipt status").

**Pitch structure (2–3 min)** — problem (20s) → who trusts whom today (15s) → the loop live (60s)
→ the Attestcoin detail that makes it possible (30s) → what's next / CEIP ask (15s).

**What losing projects lacked** — a working cross-chain path (mock oracle instead of the sponsor
primitive); a reason the sponsor chain is *necessary*; tests; docs explaining the integration; any
moment where the system says "no".

## 3. Ideas chosen

### A (built): **Kitty — proof-settled savings circles**
Modified from *Saving Circles* (ETHGlobal BA) plus the batch-verification capability nobody in the
current field uses.

- **Different angle**: the original proves *fairness* with a random draw on one chain. Kitty
  proves *payment behaviour* across chains: money stays in stablecoins on Ethereum, while the
  ledger, deadlines, rotation and credit history live on Creditcoin — the chain whose thesis is
  credit history for the under-banked.
- **Stronger features**: one precompile call verifies a whole round (≤10 txs sharing a continuity
  proof); deadlines enforced from *attested source-chain block height* via the ChainInfo
  precompile (no timestamps, no oracle); missed/late/on-time become a Kitty Score any Creditcoin
  lender can read; payouts are proven back so "Paid" is never an operator's claim.
- **Why this beats the original**: (1) real stablecoin rails, not a test token on one chain;
  (2) output is portable credit data, not just a pot; (3) deterministic rotation beats VRF for a
  savings group (no randomness gas, no "luck" narrative in an emerging-markets pitch); (4) a
  visibly deeper sponsor integration than any competitor in the field.

### B (documented, not built): **Attested Cover — parametric DeFi insurance**
Policies on Creditcoin pay out when a registered Ethereum event (a protocol `Paused`, a depeg
swap, an oracle failure) is proven through 0x0FD2. Strong, but harder to demo honestly (the
trigger must be staged) and overlaps Deadswitch / Collateral Eligibility Ledger in the field.
Kept as a follow-on: a Kitty circle could insure its own pot.
