# Kitty — Master Plan (BUIDL CTC 2026 Fall)

Detailed build-to-win plan. Every item names the exact repo, file, and license it is taken from.
Rule of the road: **take freely from MIT-licensed repos (copy files, keep the header), re-implement
from unlicensed repos (design only), never lift a current BUIDL CTC competitor's submission** — the
rules require original work and clean IP, and that is a disqualification risk, not a style choice.

Status (8 Sept 2026, evening): **days 1–4 of the plan are built** except the Creditcoin-side deploy —
65 Foundry tests; KittyLedger + KittyViewer + signed invites + KittyCreditLine + KittyUSD + KittyBadge;
worker with batch proofs, five attack scenarios and an SSE lab API; dashboard with landing, circles,
circle (urgency band, block progress, payment modal, browser-side proving), score + badge, borrow,
attack lab, architecture and presentation mode; README on the winner template with screenshots;
CI + GitHub Pages workflows. Sepolia contracts are live. The Creditcoin side waits on tCTC for
`0xD793169c516c9F9A334218608fbF6E1338b3DE56`; then `scripts/deploy.sh` → `pnpm demo …` → `pnpm worker`.

---

## 0. Reference library (clone once)

```bash
mkdir -p ~/refs && cd ~/refs
git clone --depth 1 https://github.com/gluwa/attestcoin-protocol-examples     # MIT · official Attestcoin patterns
git clone --depth 1 https://github.com/BreadchainCoop/saving-circles           # MIT · production-grade ROSCA contracts
git clone --depth 1 https://github.com/ProjectWaja/SentinelCRE                 # MIT · Convergence winner: dashboard, README, presentation mode
git clone --depth 1 https://github.com/1uizeth/front-savingcircles             # no license · ETHGlobal BA ROSCA UI (design reference only)
git clone --depth 1 https://github.com/contractlevel/yield                     # no license file · Chromion grand prize: README + landing structure
git clone --depth 1 https://github.com/TokenIQ-X/tokeniq                       # no license file · Chromion DeFi 1st: RainbowKit + recharts UI
git clone --depth 1 https://github.com/shadcn-ui/ui                            # MIT · component source
git clone --depth 1 https://github.com/scaffold-eth/scaffold-eth-2             # MIT · wagmi/RainbowKit hooks & components
```

| Winner / reference | What they won | What to take | License |
|---|---|---|---|
| **SentinelCRE** (ProjectWaja) | Convergence 2026 · 1st CRE & AI | README template ("Quick Judge Links", "Files Using Chainlink" table → "Files Using Attestcoin"), `dashboard/src/components/StatsOverview.tsx`, `VerdictFeedPanel.tsx`, `TabNavigation.tsx`, `ArchitecturePanel.tsx`, `PresentationClient.tsx` + `slides/*` (in-app judge deck), `ScenarioDemoPanel.tsx` (one-click attack scenarios) | MIT — copy |
| **YieldCoin** (contractlevel/yield) | Chromion 2025 · Grand prize $35k | README sections: "Transaction Flows" per scenario, "Testnet Deployments" + "Testnet Transactions" with explorer links, "Challenges I ran into"; frontend page order hero → how-it-works → stats → app | no license → structure only |
| **TokenIQ** (TokenIQ-X/tokeniq) | Chromion 2025 · DeFi 1st $16.5k | Stack proof: Next/React + Tailwind + RainbowKit + recharts + framer-motion; score gauge & allocation charts pattern | no license → pattern only |
| **Yieldx** (Osiyomeoh) | Chromion 2025 · RWA 1st $16.5k | Modular contracts to dodge stack-too-deep; risk-score narrative; invoice → NFT → investors flow (our Kitty Score is the analogue) | repo not public → idea only |
| **HTTPayer** (httpayer org) | Chromion 2025 · Cross-chain 1st $10k | Tiny surface area, payments-shaped demo, every step on screen | idea only |
| **FlowVault** | Convergence 2026 · DeFi & Tokenization 1st | "verified inputs → deterministic action" pitch line; video-only demo (Drive link) was enough | idea only |
| **Saving Circles** (1uizeth + BreadchainCoop) | ETHGlobal Buenos Aires 2025 · Chainlink track winner | Contracts: invites (`redeemInvite` signed nonce), `getMemberCircles`, `SavingCirclesViewer` one-call reads, `AutomaticSavingCircles` upkeep pattern; UI: urgency-coloured round status, 48-block progress bar, 2-step payment modal, context bar countdown, mobile bottom nav | contracts MIT — copy; UI no license → re-implement |
| **Attestcoin examples** (gluwa) | official | `shared/utils/index.ts` (`pollEvents` 50-block chunking, gas fallback), `ASCLoanManager` emitter-binding comments, README tone | MIT — already adapted |

---

## 1. Product scope (final)

**Kitty** — rotating savings circles. Money in `KittyVault` on Sepolia (stablecoin escrow). Rules,
deadlines, rotation, credit history in `KittyLedger` on Creditcoin CC3 Testnet, fed only by
Attestcoin-proven transactions (batch `verifyAndEmit` via 0x0FD2, attested-height clock via 0x0FD3).

**Screens (final list)**
1. **Landing** (`/`) — hero, "how it works" (3 steps), live stats, CTA. Structure from `yield/frontend` (hero.tsx → how-it-works.tsx → stats.tsx).
2. **Circle** (`/circle/:id`) — urgency-coloured round header (Saving Circles pattern), members grid, rotation, contribute modal (2-step), close-round button, proof feed.
3. **Score** (`/score/:address`) — Kitty Score gauge (recharts RadialBarChart, TokenIQ pattern), history table (on-time / late / missed with Sepolia block + Creditcoin tx links), "what a lender sees" card.
4. **Attack lab** (`/lab`) — buttons: Replay proof · Spoof emitter · Wrong chain key · Reverted source tx · Late payment. Each shows the exact revert (`QueryAlreadyProcessed`, `WrongEmitter`, `WrongChain`, `SourceTxFailed`) live. Pattern: SentinelCRE `ScenarioDemoPanel.tsx`.
5. **Architecture** (`/architecture`) — pipeline diagram verify → decode → bind → clock → score, each node linking to the source line. Pattern: SentinelCRE `ArchitecturePanel.tsx`.
6. **Presentation** (`/presentation`) — 10 keyboard-driven slides = the deck (export to PDF with the browser). Pattern: SentinelCRE `PresentationClient.tsx` + `slides/`.

**Contract additions (from BreadchainCoop, MIT)**
- `KittyViewer.sol` — one-call reads for the UI: `getCircleFull(id)` (circle + rounds + per-member contributions + scores), `getMemberDashboard(addr)`. Port `SavingCirclesViewer.getComprehensiveUserData` shape.
- Signed invites — `redeemInvite(circleId, nonce, sig)` so a creator shares a link; members join before `startHeight`. Port `SavingCircles.redeemInvite` + `app/invites.tsx` signer helper.
- `getMemberCircles(addr)` index for the Score page.
- Optional (day 3 if ahead): seat bidding for early payout — deterministic "highest bid takes this round" replaces rotation when enabled. Port `bid weighting` idea from Saving Circles, no VRF.

---

## 2. Day-by-day (8 → 13 Sept, deadline 13 Sept 23:59 ET)

### Day 1 · Tue 8 Sept — testnet live + UI foundation
- [ ] Faucets: Sepolia ETH (Alchemy https://www.alchemy.com/faucets/ethereum-sepolia, ~0.05), tCTC (Discord `#token-faucet` https://discord.gg/Gu43zTfmtc, ~0.5).
- [ ] `scripts/deploy.sh` → `pnpm demo fund && pnpm demo create && pnpm demo contribute && pnpm worker`. First real batch proof. Fix anything the real Proof Builder returns differently (map ordering, gas).
- [ ] Record the explorer links of every tx into `docs/TESTNET_LOG.md` (YieldCoin "Testnet Transactions" pattern).
- [ ] UI foundation:
  ```bash
  cd ~/projects/kitty/web
  pnpm add @rainbow-me/rainbowkit recharts framer-motion lucide-react react-router-dom
  pnpm dlx shadcn@latest init            # Vite preset, Tailwind v4
  pnpm dlx shadcn@latest add card badge button dialog tabs progress table tooltip separator
  ```
  Copy from `~/refs/SentinelCRE/dashboard/src/components/`: `StatsOverview.tsx` → `web/src/components/Stats.tsx` (labels: Proven payments · On time % · Missed · tUSD settled); `TabNavigation.tsx` → `Nav.tsx`. Keep the MIT header comment.
  Replace injected connector with RainbowKit `ConnectButton` (scaffold-eth-2 `RainbowKitCustomConnectButton.tsx` if you want the network pill).

### Day 2 · Wed 9 Sept — circle screen + contracts v2
- [ ] Circle screen with urgency header: calm (round open, >20 blocks to deadline), attention (≤20 blocks), urgent (deadline attested, round closable). Re-implement `round-status-display.tsx` + `progress-bar.tsx` (48 blocks) in our Tailwind. Countdown shows **blocks until attested** (`deadline − attestedHeight`), never seconds.
- [ ] Contribute modal: confirm → success (Saving Circles `payment-modal.tsx` flow) → success step shows "Proof pending · worker will submit after attestation (~8 min)" with a live attested-height ticker.
- [ ] `KittyViewer.sol` + `redeemInvite` + `getMemberCircles`; tests; redeploy; `pnpm demo` supports `invite`.
- [ ] Worker: add `--watch-invites` no-op? No. Keep worker as is; add `worker/src/scenarios.ts` (spoof emitter deploys a `FakeVault` on Sepolia that emits `Contributed`, proves it, expects `WrongEmitter`).

### Day 3 · Thu 10 Sept — score, lab, presentation
- [ ] Score page: recharts `RadialBarChart` gauge 300–850 with tier bands; history table from `ContributionRecorded`/`ContributionMissed` logs; "what a lender sees" JSON card (score, tier, volume, rounds).
- [ ] Attack lab page wired to `worker/src/scenarios.ts` via a tiny local API (`worker/src/api.ts`, Hono or plain `http`) so buttons run real scenarios and stream the revert. Fallback: pre-recorded results JSON if the API is down during judging.
- [ ] Architecture page + Presentation mode (copy `PresentationClient.tsx`, write 10 slides: Title · Problem · Who you trust today · Solution · Live loop · Attestcoin depth · Attack lab · Kitty Score → lending · Roadmap/CEIP · Team).
- [ ] Optional AI touch (your Vercel AI SDK experience): "Explain my score" button → Claude (`claude-sonnet-5`) turns the proven history into two plain sentences. Server-side only, key never in the browser.
- [ ] Deploy web to Vercel (`vercel --prod`), set `VITE_*` env from `deployments.json`.

### Day 4 · Fri 11 Sept — README + deck + testnet soak
- [ ] README rewrite on the SentinelCRE template: Quick Judge Links table (video, live dashboard, presentation mode, Blockscout contract links, deployer), 4 screenshots, **"Files Using Attestcoin"** table (every file that touches 0x0FD2 / 0x0FD3 / usc-sdk / EvmV1Decoder), TOC, "What makes Kitty different" (7 bullets), "Challenges I ran into" (prevrandao on forge script, ESM/CJS ethers typings, precompile gas estimation, log-range caps).
- [ ] Deck: open `/presentation`, print to PDF (Chrome → Save as PDF, landscape). Upload to Drive, public link.
- [ ] Run a full 3-round circle on testnet unattended overnight with `pnpm worker`; keep the log.

### Day 5 · Sat 12 Sept — video + submission draft
- [ ] Record per `docs/SUBMISSION.md` script (2:30). OBS is installed; narration via your existing `voiceover.py` / `gen_vo.py` TTS pipeline (chatterbox-env) — write the narration text, generate `voiceover_male.wav`, cut in Kdenlive/ffmpeg. Show: dashboard → MetaMask contribute → worker terminal → proof feed → attack lab → score.
- [ ] Upload to YouTube (unlisted is fine). Create the DoraHacks BUIDL, paste `docs/SUBMISSION.md` fields, save as draft.

### Day 6 · Sun 13 Sept — buffer, submit by 18:00 ET
- [ ] Re-run `forge test`, `pnpm e2e:local`, a live round. Tag `v1.0.0`. Submit. Post in Creditcoin Discord `#buidl-ctc-qna` with the link.

---

## 3. UI spec (what to copy, pixel-level)

**Design language**: dark, mono numerals, one accent per state — mint = proven/on-time, amber = late/closable, rose = missed/rejected, sky = attestation/infra. Cards: `rounded-2xl border border-white/10 bg-white/[0.03]` (SentinelCRE). Big numbers `text-5xl font-mono font-black` (SentinelCRE `StatsOverview`). Urgency zones: white / yellow / red full-width bands (Saving Circles) — we tone them to mint / amber / rose on dark.

| Component | Take from | File | Change |
|---|---|---|---|
| Stat cards ×4 | SentinelCRE | `dashboard/src/components/StatsOverview.tsx` | labels + colours |
| Tabs / nav | SentinelCRE | `TabNavigation.tsx` | routes: Circles · Score · Lab · Architecture · Present |
| Proof feed | SentinelCRE | `VerdictFeedPanel.tsx` | severity map → event kind; link to Blockscout |
| Scenario buttons | SentinelCRE | `ScenarioDemoPanel.tsx`, `DemoControlPanel.tsx` | 5 Kitty scenarios |
| Architecture rings | SentinelCRE | `ArchitecturePanel.tsx` | 4 rings: verify · decode · bind · clock |
| Presentation | SentinelCRE | `PresentationClient.tsx`, `slides/SlideLayout.tsx` | 10 slides |
| Round status header | Saving Circles | `components/round-status-display.tsx` | re-implement; blocks not seconds |
| Progress bar | Saving Circles | `components/progress-bar.tsx` | re-implement (48 blocks) |
| Payment modal | Saving Circles | `components/payment-modal.tsx` | re-implement; wagmi write + proof-pending state |
| Context bar | Saving Circles | `components/context-bar.tsx` | re-implement; attested-height ticker |
| Wallet button | scaffold-eth-2 | `packages/nextjs/components/scaffold-eth/RainbowKitCustomConnectButton/` | MIT copy |
| Score gauge | recharts docs | RadialBarChart example | tier bands |
| Landing order | YieldCoin | `frontend/components/{hero,how-it-works,stats}.tsx` | structure only |

**Screens, described**
- *Circle header*: `ROUND 2 OF 3` · `⛓ 14 BLOCKS UNTIL ATTESTED` · giant `PAY 100 tUSD` when the connected wallet has not been proven this round; `PROVEN ✓ @ block 11,656,012` after.
- *Members*: one row per member — avatar (blockies), address, status pill, score, tiny sparkline of last 5 rounds (mint/amber/rose squares).
- *Rotation*: vertical list, current round highlighted, pot amount, `Paid` only after `PayoutConfirmed`.
- *Proof feed*: newest first; `BatchVerified` rows get the sky dot and the text "0x0FD2 verified 3 tx in ONE call".
- *Lab*: each scenario card has Run → live log → final line in rose with the decoded custom error.

---

## 4. Contract work (exact)

```
src/asc/KittyLedger.sol      + redeemInvite(circleId, nonce, sig) [Breadchain MIT], + memberCircles index
src/asc/KittyViewer.sol      new — port SavingCirclesViewer (MIT): getCircleFull, getMemberDashboard
src/source/FakeVault.sol     test/demo only — emits Contributed from a wrong emitter (spoof scenario)
test/KittyViewer.t.sol       reads match ledger
test/KittyInvites.t.sol      signed nonce, replay of invite, wrong signer
```
Deploy sequence stays `scripts/deploy.sh`; add `KittyViewer` after the ledger and write `KITTY_VIEWER_ADDRESS`.

## 5. Worker work (exact)
- `worker/src/scenarios.ts`: `replay`, `spoofEmitter`, `wrongChain` (chainKey 3), `revertedTx` (contribute with zero allowance → status 0 → `SourceTxFailed`), `late` (contribute after deadline; expect `onTime=false`).
- `worker/src/api.ts`: `POST /run/:scenario` streams log lines (SSE) → Lab page. Local only; document it.
- Keep `pnpm worker` daemon on your laptop during judging week, or run it on a $5 VPS with `pm2`.

## 6. Docs & pitch (exact)
- `README.md` → SentinelCRE template (see Day 4).
- `docs/TESTNET_LOG.md` → every tx with links (YieldCoin pattern).
- `docs/ATTESTCOIN_INTEGRATION.md` → add "Files Using Attestcoin" table (same as README) and a gas table (batch of 1/3/10 vs 10 singles).
- `docs/SUBMISSION.md` → already has the video script; add narration text for TTS.

## 7. Risks → mitigations
| Risk | Mitigation |
|---|---|
| Faucet delay | thirdweb faucet gives 0.01 tCTC (enough for ~3 ledger txs at 0.5 gwei); Sepolia via Alchemy needs an account, no mainnet balance |
| Proof Builder batch response shape differs from SDK docs | `proofs.ts` logs the raw response on first run; fall back to N single proofs (`getProof`) automatically if `getBatchProof` fails |
| Attestation lag > 15 min on demo day | pre-record the worker segment; dashboard shows "waiting for attestation" honestly |
| Precompile gas estimation fails | SDK `computeGasLimit` fallback already wired; cap at 8M |
| Sepolia RPC log-range caps | worker chunks 50 blocks; add a second RPC in `.env` (`https://1rpc.io/sepolia`) |
| Judge can't run the worker | Lab page falls back to recorded scenario JSON; video shows the live run |

## 8. Definition of done (submission checklist)
- [ ] Live dashboard URL (Vercel) reading real CC3 + Sepolia deployments
- [ ] ≥1 full circle completed on testnet, all txs in `docs/TESTNET_LOG.md`
- [ ] README with Quick Judge Links + Files Using Attestcoin table + screenshots
- [ ] `/presentation` → PDF deck uploaded
- [ ] 2:30 video uploaded
- [ ] DoraHacks form: name, sector DeFi, description, integration summary, GitHub, deck, video, team
