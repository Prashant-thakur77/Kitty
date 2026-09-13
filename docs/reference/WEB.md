# The dashboard: `web/`

Reference for the Kitty dashboard, the React application in [`web/`](../../web/) that is published to GitHub Pages and opened inside Telegram as a Mini App. It reads two chains and one proof service directly from the browser, holds no key of its own, and can prove a round from a member's wallet with no operator involved.

Companion documents: [`USER_SCENARIOS.md`](../USER_SCENARIOS.md) walks every flow from the user's side with the UI states rendered; [`TECH.md`](../TECH.md) explains the checks the ledger performs; [`specs/PROTOCOL.md`](../specs/PROTOCOL.md) is the contract interface; [`ATTESTCOIN_INTEGRATION.md`](../ATTESTCOIN_INTEGRATION.md) covers the precompiles and the Proof Builder; [`OPERATIONS.md`](../OPERATIONS.md) has the environment files and the lab API; [`TELEGRAM.md`](../TELEGRAM.md) sets up the bot and the Mini App. Contract-side references: [`CONTRACTS.md`](CONTRACTS.md), [`STORAGE_LAYOUT.md`](STORAGE_LAYOUT.md), [`DATA_FORMATS.md`](DATA_FORMATS.md); the worker and the bot: [`STEWARD.md`](STEWARD.md), [`LAB_API.md`](LAB_API.md), [`BOT.md`](BOT.md).

## Contents

- [Stack and build](#stack-and-build)
- [Configuration](#configuration)
- [Routes and pages](#routes-and-pages)
- [Hooks reference](#hooks-reference)
- [The proving flow](#the-proving-flow)
- [Create, invite and join](#create-invite-and-join)
- [Components catalogue](#components-catalogue)
- [The 3D system](#the-3d-system)
- [The story timeline](#the-story-timeline)
- [The guided tour](#the-guided-tour)
- [Telegram Mini App](#telegram-mini-app)
- [Accessibility and reduced motion](#accessibility-and-reduced-motion)
- [Hosted deployment](#hosted-deployment)

## Stack and build

Versions are the ones resolved in `web/node_modules` at the time of writing; the ranges are in [`web/package.json`](../../web/package.json).

| Layer | Package | Version | Used for |
|---|---|---|---|
| Build | `vite` | 8.2.2 | Dev server on port 5173, production bundle. `tsc -b` runs first (`pnpm build` is `tsc -b && vite build`). |
| Build | `@vitejs/plugin-react`, `@tailwindcss/vite` | 6.1.0, 4.3.3 | The only two plugins in [`vite.config.ts`](../../web/vite.config.ts). |
| Language | `typescript` | 6.0.3 | `oxlint` 1.82.0 is the linter (`pnpm lint`). |
| UI | `react`, `react-dom` | 19.2.8 | `createRoot` in [`main.tsx`](../../web/src/main.tsx), `StrictMode` on. |
| Routing | `react-router-dom` | 7.18.3 | `BrowserRouter` with `basename={import.meta.env.BASE_URL}`. |
| Chain | `wagmi`, `viem`, `@tanstack/react-query` | 3.7.7, 2.56.3, 5.102.8 | Reads, writes, simulation, event scans. One `QueryClient` with `refetchInterval: 8000, retry: 1` for every query that does not set its own. |
| Styling | `tailwindcss` | 4.3.3 | `@import "tailwindcss"` at the top of [`index.css`](../../web/src/index.css) plus a `@theme` block that adds three header breakpoints (`nav`, `tools`, `wide`). Design tokens are CSS variables on `:root`. |
| Motion | `motion` | 13.2.0 | Page transitions, reveals, the wheel and gauge springs, toasts, the tour. `MotionConfig reducedMotion="user"` wraps the app. |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` | 0.186.0, 9.7.0, 10.7.8 | The landing hero, the architecture flow stage and the story chapters. |
| Dialogs | `@radix-ui/react-dialog` | 1.1.23 | The mobile nav sheet, the payment modal, the re-verify modal. |
| Icons | `lucide-react` | 1.42.0 | |
| Unused | `recharts` | 3.10.1 | Listed in `dependencies`; nothing under `web/src` imports it. |

### Chunking

three.js is never in the page's own chunk. Three dynamic imports keep it apart:

- [`pages/Landing.tsx`](../../web/src/pages/Landing.tsx) and [`pages/Architecture.tsx`](../../web/src/pages/Architecture.tsx) pass `() => import('../three/HeroScene')` and `() => import('../three/FlowScene')` to `Canvas3D`, which itself lazy-loads `./Stage` together with the scene in one `Suspense` pass ([`three/Canvas3D.tsx`](../../web/src/three/Canvas3D.tsx), `loadStage`).
- [`story/Story.tsx`](../../web/src/story/Story.tsx) does `lazy(() => import('./StoryStage'))`.

`pnpm --dir web build` on this checkout produced:

| Chunk | Size | gzip |
|---|---|---|
| `index-*.js` (app, wagmi, viem, router, motion) | 1,042.19 kB | 313.40 kB |
| `events-156d8d12.esm-*.js` (three r186 and `@react-three/fiber`; only requested when a stage mounts) | 886.86 kB | 234.05 kB |
| `StoryStage-*.js` | 35.37 kB | 10.28 kB |
| `HeroScene-*.js` | 10.83 kB | 4.11 kB |
| `FlowScene-*.js` | 8.57 kB | 2.99 kB |
| `Stage-*.js` | 8.09 kB | 3.32 kB |
| `Html-*.js`, `ContactShadows-*.js`, `Sparkles-*.js` (drei helpers) | 7.78, 4.23, 3.67 kB | 3.16, 1.42, 1.41 kB |
| `ccip-*.js` (viem CCIP read) | 2.84 kB | 1.31 kB |
| `index-*.css` | 52.23 kB | 11.87 kB |

Two build notes are expected. Rolldown reports `INEFFECTIVE_DYNAMIC_IMPORT` for `src/data/steward.sample.json`, which [`pages/Steward.tsx`](../../web/src/pages/Steward.tsx) imports dynamically while [`pages/Presentation.tsx`](../../web/src/pages/Presentation.tsx) imports it statically, so it stays in the main chunk. And the main chunk is above the 500 kB warning threshold; the three chunk is the one that is deferred.

## Configuration

Everything the app knows about its environment is read once in [`config.ts`](../../web/src/config.ts) into the `cfg` object. All values come from `VITE_*` variables; the defaults below are the literal fallbacks in that file and in [`lib/prover.ts`](../../web/src/lib/prover.ts) and [`lib/telegram.ts`](../../web/src/lib/telegram.ts).

| Variable | `cfg` key | Default when unset | Meaning |
|---|---|---|---|
| `VITE_KITTY_LEDGER_ADDRESS` | `ledger` | `''` | `KittyLedger` on Creditcoin. Empty disables every ledger hook (`enabledLedger()` in `hooks.ts`) and shows the amber banner in `App.tsx`. |
| `VITE_KITTY_VIEWER_ADDRESS` | `viewer` | `''` | `KittyViewer`. Read into `cfg` but not used by any page or hook. |
| `VITE_KITTY_VAULT_ADDRESS` | `vault` | `''` | `KittyVault` on the source chain: payments, `Contributed` scans, `trustedVault` checks in Create. |
| `VITE_FAKE_VAULT_ADDRESS` | `fakeVault` | `''` | The attack-lab spoof emitter. Read into `cfg`; not referenced by pages. |
| `VITE_TEST_USD_ADDRESS` | `token` | `''` | `TestUSD` on the source chain: `allowance`, `balanceOf`, `approve`, `mint`. |
| `VITE_KITTY_CREDIT_ADDRESS` | `credit` | `''` | `KittyCreditLine`. Empty renders the "Credit line not deployed" state on `/borrow`. |
| `VITE_KITTY_BADGE_ADDRESS` | `badge` | `''` | `KittyBadge`. Empty hides `BadgeCard`. |
| `VITE_KITTY_USD_ADDRESS` | `kusd` | `''` | `KittyUSD`, the lending asset. |
| `VITE_SOURCE_CHAIN_KEY` | `sourceChainKey` | `1` | Attestcoin chain key used for `useAttestation`, the Proof Builder paths and the default chain in Create. |
| `VITE_SEPOLIA_RPC_URL` | `sepoliaRpc` | `https://ethereum-sepolia-rpc.publicnode.com` | Source-chain transport. |
| `VITE_CREDITCOIN_RPC_URL` | `creditcoinRpc` | `https://rpc.cc3-testnet.creditcoin.network` | Creditcoin transport. |
| `VITE_SEPOLIA_CHAIN_ID` | `sepoliaChainId` | `11155111` | Overrides the id of the `sepolia` chain definition in [`lib/wagmi.ts`](../../web/src/lib/wagmi.ts). |
| `VITE_CREDITCOIN_CHAIN_ID` | `creditcoinChainId` | `102031` | Id of the `creditcoinTestnet` chain definition; also part of the invite digest. |
| `VITE_SEPOLIA_EXPLORER` | `sepoliaExplorer` | `https://sepolia.etherscan.io` | Explorer links for source transactions. |
| `VITE_CREDITCOIN_EXPLORER` | `creditcoinExplorer` | `https://creditcoin-testnet.blockscout.com` | Explorer links for Creditcoin transactions; also the `blockExplorers` entry of the chain definition. |
| `VITE_LEDGER_DEPLOY_BLOCK` | `ledgerDeployBlock` | `0` | Start of every ledger event scan. When `0`, `useLedgerEvents` scans the last 20,000 blocks instead. |
| `VITE_LAB_API` | `labApi` | `http://localhost:8790` in dev, `''` in a production build | See [labApi in DEV versus hosted](#labapi-in-dev-versus-hosted). |
| `VITE_REPO_URL` | `repo` | `https://github.com/Prashant-thakur77/Kitty` | Source links on the landing and architecture pages. |
| `VITE_PROOF_BUILDER_URL` | (`BASE` in `lib/prover.ts`) | `https://prover.cc3-testnet.creditcoin.network` | The Attestcoin Proof Builder. |
| `VITE_TELEGRAM_BOT_URL` | (`TELEGRAM_BOT_URL` in `lib/telegram.ts`) | `https://t.me/KittyCirclesBot` | The nav's Telegram pill. |
| `VITE_BASE` | (`base` in `vite.config.ts`) | `/` | Vite `base`; the Pages workflow sets `/Kitty/`. Read from `process.env` at build time, not `import.meta.env`. |

Two constants sit beside `cfg` and are not configurable: `CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3` and `VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2`. `ZERO32` is the empty query id used by `isProven`.

### Which env file is read

Vite loads `.env`, then `.env.local`, then `.env.[mode]`, with later files overriding earlier ones for the keys they set (`.env.[mode].local` would override all of them; none is present). The repository ships four files in `web/`:

| File | Committed | Written by | Contents |
|---|---|---|---|
| `.env.example` | yes | hand | Empty addresses, the public RPC URLs and chain ids, `VITE_LEDGER_DEPLOY_BLOCK=0`. |
| `.env` | no | `scripts/deploy.sh` | Testnet addresses and deploy block. |
| `.env.production` | yes | `scripts/deploy.sh` | The same testnet addresses; the file the hosted build reads. No RPC URL, no `VITE_LAB_API`, so the defaults in `config.ts` apply. |
| `.env.local` | no | `scripts/local-setup.sh` | `127.0.0.1:8545` and `:8546` as the two RPC URLs with the public chain ids, `VITE_LAB_API=http://localhost:8790`, `VITE_LEDGER_DEPLOY_BLOCK=1`, and the anvil addresses. `.env.local-demo` is a hand-written template of the same shape. |

So `pnpm dev` with `.env.local` present talks to the two local anvils and the lab API; delete `.env.local` and the dev server points at the testnets through `.env`. `pnpm build` runs in `production` mode, and `.env.production` overrides the addresses. It does not set the RPC URLs or `VITE_LAB_API`, so a local production build made while `.env.local` exists still carries the anvil RPC URLs and the lab API URL from that file; the CI build has no `.env.local` and gets the defaults. The chain definitions in [`lib/wagmi.ts`](../../web/src/lib/wagmi.ts) take their ids and URLs from `cfg`, so the same `sepolia` and `creditcoinTestnet` objects describe either world.

### labApi in DEV versus hosted

`cfg.labApi` is `VITE_LAB_API` when set, otherwise `http://localhost:8790` under `import.meta.env.DEV` and the empty string in a production build. Two pages branch on it:

- [`pages/Lab.tsx`](../../web/src/pages/Lab.tsx): with `labApi` empty it sets `offline` immediately and fetches `${BASE_URL}lab-testnet.json`, falling back to `${BASE_URL}lab-recorded.json` (both in `web/public/`, written by `pnpm lab:record`). With `labApi` set it requests `GET /scenarios` and `GET /status`; a failed fetch flips to `offline` and loads the recording. `POST /run/:name` streams `text/event-stream`; the page parses `event:`/`data:` pairs, appends `{line}` payloads to the card's log and stores the `done` payload as the result. A `409` means another scenario is running.
- [`pages/Steward.tsx`](../../web/src/pages/Steward.tsx): with `labApi` empty it imports `data/steward.sample.json` (the recorded CC3 Testnet log, newest first after `reverse()`) and shows the recorded `pnpm explain` answer from `data/steward.explain.sample.json` in place of the question form. With `labApi` set it fetches `GET /steward/log` and `GET /status` (for `mode`, which decides whether transaction hashes get explorer links) and posts `{question}` to `/steward/explain`.

The lab API holds the operator key and has no authentication (see [`OPERATIONS.md`](../OPERATIONS.md#the-lab-api-pnpm-labapi)); the hosted build never calls it.

## Routes and pages

[`App.tsx`](../../web/src/App.tsx) declares the routes inside an `AnimatePresence mode="wait"` so one page leaves before the next arrives; a thin `RouteProgress` bar runs during the switch. Unknown paths redirect to `/`. [`main.tsx`](../../web/src/main.tsx) provides, outermost first: `WagmiProvider`, `QueryClientProvider`, `BrowserRouter`, `MotionConfig`, `ToastProvider`; `App` adds `TourProvider`, the skip link, the `Nav`, and the "ledger not configured" banner.

| Route | Component | Renders | Hooks and reads |
|---|---|---|---|
| `/` | [`Landing`](../../web/src/pages/Landing.tsx) | Hero with the 3D circle (or the `RotationWheel` under 640 px, without WebGL2 or with reduced motion), the live proof marquee, four counters, the four settlement steps, the trust table, the score panel. The hero follows the circle with the newest `ContributionRecorded` event, else the newest circle. | `useCircleCount`, `useGlobalStats`, `useLedgerEvents()`, `useCircle` (twice), `useAttestation`, `useCan3D`. |
| `/circles` | [`Circles`](../../web/src/pages/Circles.tsx) | One card per circle, newest last, with a live strip: pot, deadline block, blocks to go against the attested frontier. | `useCircleCount`, then `useReadContracts` over `getCircle(1..n)`, then one `useReadContracts` with `getRound` and `deadlineHeight` per circle (`refetchInterval: 12000`), `useAttestation`. |
| `/circle/:id` | [`CirclePage`](../../web/src/pages/Circle.tsx) | The urgency band, `BlockProgress`, four stats, the organiser's `InvitePanel` on an open circle, `RotationWheel`, the member table, `RoundTimeline`, `ProvePanel` while the round is open with unproven members, `ProofFeed`, the pay modal, `ReverifyModal`. | `useAttestation`, `useCircle`, `useRoundDetail`, `useRounds`, `useLedgerEvents({circleId})`, `useVaultPayments`, `useDeadlineBounds`; direct reads of `TestUSD.allowance`/`balanceOf` and `KittyLedger.accepted`; writes `approve`, `contribute`, `mint`, `closeRound`, `acceptMembership`. |
| `/create` | [`Create`](../../web/src/pages/Create.tsx) | The create form. | `useCircleCount`, `useBalance` (tCTC, 12 s), `get_supported_chains` on 0x0FD3, `trustedVault(chainKey, vault)` per chain, `get_latest_attestation_height_and_hash` (8 s). Writes `createCircle` / `createOpenCircle`, optionally `setRotation`. |
| `/join/:circleId` | [`Join`](../../web/src/pages/Join.tsx) | Invite redemption from the link's query string. | `useCircle`, `usedInviteNonces(circleId, nonce)` (8 s), client-side `recoverMessageAddress`. Writes `redeemInvite`. |
| `/score`, `/score/:address` | [`ScorePage`](../../web/src/pages/Score.tsx) | `ScoreRing`, `ScoreBreakdown`, `ScoreSparkline`, the lender JSON, the proof bundle download, `BadgeCard`, the history table. Address from the route, else the connected wallet. | `useScore`, `useLedgerEvents({member})`. `BadgeCard` reads `balanceOf` and `tokenURI(uint256(address))` on `KittyBadge` and writes `claim`. |
| `/borrow`, `/borrow/:address` | [`Borrow`](../../web/src/pages/Borrow.tsx) | Underwriting card and the pool card. Subject is the route or `?address=` param, else the wallet, else the latest circle's current recipient. | `useCircleCount`, `useCircle`; `underwrite`, `outstanding`, `totalDeposits` on `KittyCreditLine`; `balanceOf`, `allowance` on `KittyUSD`. Writes `borrow`, `approve`, `repay`. |
| `/steward` | [`Steward`](../../web/src/pages/Steward.tsx) | The decision log and the "ask the steward" panel. | No chain reads; lab API or the committed samples. |
| `/lab` | [`Lab`](../../web/src/pages/Lab.tsx) | Eight scenario cards with logs and results. | No chain reads; lab API or the recorded run. |
| `/architecture` | [`Architecture`](../../web/src/pages/Architecture.tsx) | The flow stage (or a text fallback), seven nodes linking to source files, the "why not ASCBase" panel. | `useAttestation`, `useLedgerEvents()`. |
| `/presentation` | [`Presentation`](../../web/src/pages/Presentation.tsx) | Thirteen slides. Arrow keys, Space, Enter and Backspace move; `Print to PDF` prints every slide via `@media print`. The live-circle slide reads circle 1 and degrades to the recorded testnet figures. | `useCircleCount`, `useCircle(1n)`, `useRoundDetail`, `useRounds`, `useVaultPayments`, `useGlobalStats`, `useAttestation`. |
| `/story` | [`Story`](../../web/src/pages/Story.tsx) | The three-chapter 3D explainer; captions as text without WebGL. | None. |
| `/guide` | [`Guide`](../../web/src/pages/Guide.tsx) | One card per tab with what it can do, its data sources, and a "take the tour from here" button. | `useTour`. |

The `Nav` link list is seven entries: Circles, Score, Borrow, Steward, Attack lab, Architecture, Present. `/create`, `/guide` and `/story` are reached from buttons and the mobile sheet.

## Hooks reference

All hooks live in [`hooks.ts`](../../web/src/hooks.ts). There is no `hooks.viz.ts` in this checkout; the visual helpers `memberStatus`, `scoreSeries` and `tierOf` are exported from the components that use them (see the [components catalogue](#components-catalogue)). Every read below targets `creditcoinTestnet` unless stated; "8 s" means the `QueryClient` default `refetchInterval: 8000`, which applies whether the hook writes it explicitly or not. `useBlockNumber({ watch: true })` polls through viem's client at its default interval, 4 s for both chain definitions (viem derives it from `chain.blockTime ?? 12_000`, halved and clamped to 4,000 ms).

| Hook | Reads | Contract and function | Interval | Returns |
|---|---|---|---|---|
| `useAttestation()` | Source head and the attested frontier. | `useBlockNumber` on `sepolia`; ChainInfo `get_latest_attestation_height_and_hash(sourceChainKey)` on 0x0FD3. | head 4 s, attestation 8 s | `{ head?: bigint, attested?: bigint, lag?: number }`; `attested` is set only when the result's `exists` is true; `lag = max(0, head - attested)`. |
| `useCoveringAttestations(chainKey, heights)` | Which attestation covers each payment block. One multicall over the unique heights. | ChainInfo `find_lowest_attested_after(chainKey, h)` on 0x0FD3. | 8 s | `Map<bigint, { height: bigint, exists: boolean }>` keyed by input height. |
| `useDeadlineBounds(chainKey, deadline)` | The attested bounds around a deadline. | ChainInfo `get_attestation_bounds(chainKey, deadline)` on 0x0FD3. | 8 s, enabled when `deadline` is defined | `{ parentHeight, parentHash, parentIsAttestation, childHeight, childHash, childIsAttestation, isAttested }` or `undefined`. |
| `useCircleCount()` | Number of circles. | `KittyLedger.circleCount()` | 8 s | The raw `useReadContract` result; `.data` is a `bigint`. |
| `useCircle(id)` | One circle, its current round, the round's deadline and close heights. | `getCircle(id)`, then `getRound(id, currentRound)`, `deadlineHeight(id, currentRound)`, `closeHeight(id, currentRound)`. Enabled when the ledger is configured and `id > 0`. | 8 s | `{ circle?: Circle, round?: Round, deadline?: bigint, closeAt?: bigint, isLoading, error, refetch }`. |
| `useRoundDetail(id, round, members)` | Per member for one round. Three multicalls, one contract per member each. | `getContribution(id, round, m)`, `getRecord(m)`, `creditScore(m)`. | 8 s | `{ contributions?: (Contribution\|undefined)[], records?: (Record_\|undefined)[], scores?: ([number, string]\|undefined)[] }`, index-aligned with `members`. |
| `useRounds(id, count)` | Every round of a circle. One multicall. | `getRound(id, r)` for `r` in `0..count-1`. | 8 s | `(Round \| undefined)[]` or `undefined`. |
| `useScore(address)` | Score and counters of one address. | `creditScore(address)`, `getRecord(address)`. | 8 s | `{ score?: [number, string], record?: Record_, isLoading, error }`. |
| `useLedgerEvents(filter?)` | Every ledger event in `NAMES`, optionally for one `circleId` or one `member`. Re-runs on every Creditcoin block. | `publicClient.getContractEvents` on `KittyLedger` from `ledgerDeployBlock` (or `head - 20000` when it is 0) to the head; on an RPC error it retries the last 2,000 blocks; on a second error the list is empty. | each new Creditcoin block (4 s watcher) | `{ items: FeedItem[], loading }`, newest first. `FeedItem = { kind, text, tx, block, qid?, args }` where `text` comes from `describe()`. |
| `useGlobalStats()` | Aggregates over `useLedgerEvents()`. | (derived) | as above | `{ proven, onTimePct, missed, settled, batches, batched }`: `ContributionRecorded` count and on-time share, `ContributionMissed` count, the sum of `PayoutConfirmed.amount` in tUSD, the number of `BatchVerified` events and the sum of their `count`. |
| `useVaultPayments(circleId, round, fromBlock)` | `Contributed` events on the source vault for one (circle, round). | `publicClient.getContractEvents` on `sepolia`, `eventName: 'Contributed'`, `args: { circleId, round }`, from `fromBlock - 20` to the head; on an RPC error it walks back in 2,000-block windows, at most 10. Re-runs on every Sepolia block. | each new Sepolia block (4 s watcher) | `VaultPayment[]` with `{ member, amount, tx, block }`. |

Two exports are not hooks: `isProven(c)` is `c.queryId !== ZERO32`, and `describe(name, args)` turns an event into its feed sentence. The `NAMES` list is `CircleCreated`, `BatchVerified`, `ContributionRecorded`, `ContributionMissed`, `RoundClosed`, `RoundOpened`, `PayoutConfirmed`, `CircleCompleted`, `InviteRedeemed`; other ledger events are dropped by the scan.

The ChainInfo ABI in [`lib/abi.ts`](../../web/src/lib/abi.ts) declares five functions; the dashboard calls four of them: `get_latest_attestation_height_and_hash` (`useAttestation`, `Create`), `find_lowest_attested_after` (`useCoveringAttestations`), `get_attestation_bounds` (`useDeadlineBounds`) and `get_supported_chains` (`Create`). `is_height_attested` is declared but only the contract and the worker call it. The ledger, vault and token ABIs are the JSON exports under [`src/abi/`](../../web/src/abi/); the credit line, badge and kUSD ABIs are hand-written `parseAbi` subsets in [`lib/creditAbi.ts`](../../web/src/lib/creditAbi.ts).

## The proving flow

Three files: [`components/ProvePanel.tsx`](../../web/src/components/ProvePanel.tsx) drives the flow, [`lib/prover.ts`](../../web/src/lib/prover.ts) talks to the Proof Builder, [`lib/verifier.ts`](../../web/src/lib/verifier.ts) holds the 0x0FD2 ABI. The panel is mounted by `CirclePage` only while the circle is active and the current round is `Open`, and it returns `null` when every member is proven.

Inputs, in order of derivation:

1. `pending`: members whose `Contribution.queryId` is still zero.
2. `provable`: pending members with a `VaultPayment` whose `amount === circle.contribution` (a payment of the wrong amount would make the ledger revert `WrongAmount`, so it is never offered).
3. `covering`: `useCoveringAttestations(chainKey, blocks of provable payments)`; a payment is `ready` when its `find_lowest_attested_after` result has `exists === true`. The covering block comes from the precompile, never from arithmetic on the attested head.
4. `waiting`: `provable.length > 0 && ready.length === 0`. The button then reads `Waiting for attestation of Sepolia block N (attested M, lag N-M)` and step 1 of the stepper sits in the `waiting` state.

The stepper has four labels, `Attested`, `Proof fetched`, `Preflight ok`, `Verified on Creditcoin`. `done` counts completed steps (0 to 4), `failed` is the index of the failed step or `null`; a step's `data-state` is one of `error`, `done`, `active`, `waiting`, `idle`. Step 1 is shown complete as soon as at least one payment is `ready`, before any click (`shownDone = max(done, ready.length > 0 ? 1 : 0)`).

Clicking `Prove N payments in one call` runs `prove()`:

1. `advance(1)`; a toast opens with `busy: true, duration: 0` (it stays until updated). The same toast id is updated at every later step through `useToast().update`.
2. `attestedHeight()`: `GET {PROOF_BUILDER}/api/v1/attested-height/{sourceChainKey}`; the height is logged next to the highest payment block. A non-2xx response throws `proof builder <status>`.
3. `batchProof(hashes)` with the first ten ready payments: `POST {PROOF_BUILDER}/api/v1/proof-batch-by-tx/{sourceChainKey}` with the JSON array of transaction hashes. The response's `merkleProofs` map (height, then tx index) is flattened and re-ordered to match the request; a hash without a proof throws `proof missing for <hash>`. The result is `BatchArgs = { chainKey, heights, txBytes, merkleProofs, continuity, txHashes }`. `advance(2)`.
4. Preflight on 0x0FD2: `publicClient.readContract` on `verify`, choosing the single-query overload `(chainKey, height, txBytes, merkleProof, continuity)` when there is one proof and the batch overload `(chainKey, heights[], txBytes[], merkleProofs[], sharedContinuityProof)` otherwise. `false` or a revert marks step index 2 failed with `Preflight failed` and the note that nothing was submitted; the revert text is cleaned by `precompileReason`, which strips the viem wrapper down to the precompile's own reason line.
5. `simulateContract` on `KittyLedger.recordContributions(chainKey, heights, txBytes, merkleProofs, continuity)` from the connected account. A `ContractFunctionRevertedError` is decoded to `ErrorName(args)`; failure marks step 2 with `Ledger would reject`. This is the check that catches `WrongAmount`, `NotCurrentRound`, `QueryAlreadyProcessed` and the rest before any gas is spent.
6. `advance(3)`; the toast reads `Preflight passed`. Gas is `estimateContractGas` times 1.3, with a floor of 4,000,000 if the estimate is lower or fails. If the wallet is on another chain, `switchChainAsync` to Creditcoin.
7. `writeContractAsync` on `recordContributions` with that gas. The hash is logged and the toast reads `Submitted to Creditcoin`.
8. `waitForTransactionReceipt(wagmiConfig, { hash, chainId })`. `status === 'success'` gives `advance(4)` and a mint toast `Verified on Creditcoin` that closes after 7 s; a reverted receipt marks step index 3 with `Reverted on chain`. In both cases `onDone()` (the page's `refetch`) runs.
9. Any other throw lands in the catch: step `min(stage, 3)` is failed with `Could not fetch the proof` when `stage < 2`, `Proving stopped` otherwise; the first line of the error message is the description.

The log under the stepper is a `role`-less panel with `aria-live="polite"`; each line is appended with `push()`. The button is disabled while busy, when nothing is ready, or without a connected address.

`ReverifyModal` ([`components/ReverifyModal.tsx`](../../web/src/components/ReverifyModal.tsx)) reuses the same library for a recorded payment: `singleProof(tx)` (`GET /api/v1/proof-by-tx/{chainKey}/{tx}`), then `calculateTxIndex(merkleProof)` and the single-query `verify` on 0x0FD2, then a second `verify` with the last byte of `txBytes` flipped, which is expected to revert; the reason is printed.

## Create, invite and join

### Create ([`pages/Create.tsx`](../../web/src/pages/Create.tsx))

The form mirrors the ledger's own checks so a revert is the exception. Constants: `MAX_MEMBERS = 10` (the ledger's `MAX_MEMBERS`) and `START_LEAD = 20n`, the number of blocks past the attested frontier at which round 0 opens by default. The chain picker reads `get_supported_chains()` from 0x0FD3 and, for each row, `trustedVault(chainKey, cfg.vault)` from the ledger; a chain whose vault is not trusted is disabled with the note that `createCircle` would revert `VaultNotTrusted`. The start height follows `attested + 20` until the field is touched; a `reset` button restores it. The problem list refuses, among others, a first deadline at or below the attested frontier (the ledger's `InvalidCircle("round 0 already attested")`).

`submit()`:

1. `fn` is `createCircle` (listed members: `[name, members, contribution, roundBlocks, startHeight, vault, chainKey]`) or `createOpenCircle` (`[name, contribution, roundBlocks, startHeight, vault, maxMembers, chainKey]`). The installment is `round(input * 1e6)`, six decimals.
2. `simulateLedger(client, address, fn, args)` from [`lib/tx.ts`](../../web/src/lib/tx.ts): a `simulateContract` against the ledger. A revert is shown as `Ledger would reject: Name(args). Nothing submitted.` through `revertReason`, which walks the error for a `ContractFunctionRevertedError` and formats `errorName(args)`, else the first line of the short message.
3. Switch chain if needed, `writeContractAsync`, `waitForTransactionReceipt`.
4. The new id is parsed from the receipt's `CircleCreated` log with `parseEventLogs`; if that fails, `circleCount()` is read.
5. If rotation `By proven score` was chosen, `setRotation(id, 1)` is simulated and sent as a second transaction. A failed simulation navigates to the circle anyway with a toast saying the rotation stays fixed.
6. Navigate to `/circle/:id`.

### Invite ([`components/InvitePanel.tsx`](../../web/src/components/InvitePanel.tsx))

Shown on `/circle/:id` to the organiser while `circle.open` is true. Invites are stored in `localStorage` under `kitty:invites:<ledger lowercased>:<circleId>` as `{ invitee, nonce, sig }[]`; nothing goes on chain until redemption.

`generate()`:

1. `nonce = randomNonce()`: 32 bytes from `crypto.getRandomValues`, as a `bigint`.
2. `raw = inviteMessage(circleId, invitee, nonce)` = `keccak256(encodePacked(['address','uint256','uint256','address','uint256'], [cfg.ledger, creditcoinChainId, circleId, invitee, nonce]))`. This is the inner hash; the ledger's `inviteDigest` applies the EIP-191 prefix on top of it (`MessageHashUtils.toEthSignedMessageHash`, [`KittyLedger.sol`](../../src/asc/KittyLedger.sol) `inviteDigest`).
3. The page reads `inviteDigest(circleId, invitee, nonce)` from the ledger and compares it to `hashMessage({ raw })`. A mismatch (different chain id or ledger address) aborts before any signature is requested.
4. `signMessageAsync({ message: { raw } })`: the wallet signs the 32 raw bytes, so its `personal_sign` prefix is exactly what `inviteDigest` expects.
5. `recoverMessageAddress({ message: { raw }, signature })` must equal `circle.organiser`; otherwise the invite is discarded with an explanation.
6. The link is `${origin}${BASE_URL without trailing slash}/join/${circleId}?invitee=…&nonce=…&sig=…`.

`closeInvites()` simulates `closeInvites(circleId)`, then writes it, waits for the receipt and reports `Invites closed`. The button is disabled with fewer than two members.

### Join ([`pages/Join.tsx`](../../web/src/pages/Join.tsx))

The route reads `invitee`, `nonce` and `sig` from the query string; the link is well-formed when the invitee is an address, the nonce is decimal and the signature is 65 bytes (`isHex(sig) && sig.length === 132`). The page recovers the signer client-side with the same `inviteMessage` and blocks redemption when it is not the organiser. Other blockers: the circle is no longer open, it is full, `usedInviteNonces(circleId, nonce)` is already true, the wallet is already a member, or the connected wallet is not the invitee. `redeem()` runs `simulateLedger(..., 'redeemInvite', [circleId, nonce, sig])`, then `writeContractAsync`, then `waitForTransactionReceipt`, refetches the circle and navigates to it. The ledger recovers the signer with `ECDSA.recover(inviteDigest(...), sig)` and marks the nonce used (`redeemInvite` in `KittyLedger.sol`).

Listed members of a non-open circle consent through `acceptMembership` on the circle page instead; the page reads `accepted(circleId, address)` and shows the button while it is `false`.

## Components catalogue

### `RotationWheel`, `RoundTimeline`, `WheelLegend` ([`components/RotationWheel.tsx`](../../web/src/components/RotationWheel.tsx))

An SVG ring, `viewBox 500`, radius 150, pot radius 76. Members sit at `-90 + 360/n * i` degrees; node radius shrinks from 19 to 17 to 15 as `n` passes 5 and 8. The recipient arc is a `motion` value in degrees that always sweeps forward (`((target - cur) % 360 + 360) % 360`) with a spring of stiffness 60, damping 16; under reduced motion it is set instantly. Each member's status is `memberStatus(contribution, paidOnSource, roundClosed)`:

| Result | Condition |
|---|---|
| `on-time`, `late` | `isProven(c)` and `c.onTime` |
| `paid-pending` | a `Contributed` event on the vault but no proof yet |
| `missed` | the round is no longer `Open` and there is no proof |
| `pending` | otherwise |

Spokes are drawn for every non-pending member (dashed for `missed` and `paid-pending`), a status dot sits on the node's outer edge, past recipients (rounds with `status !== 0`) get a check mark and 55 % opacity, and hovering or focusing a node (`tabIndex=0`, `role="button"`) shows a tooltip with the status, proven block, score and record. The pot count uses `CountUp`. `WheelLegend` is the six-item key. `RoundTimeline` is one node per round, `paid` / `closed` / `current` / `upcoming` from `rounds[r].status`, with connectors that draw in and a right-edge fade while the strip overflows.

### `ScoreRing`, `ScoreBreakdown`, `ScoreSparkline` ([`components/ScoreRing.tsx`](../../web/src/components/ScoreRing.tsx))

Constants exported from the file, matching `KittyLedger.creditScore`: `SCORE_MIN = 300`, `SCORE_MAX = 850`, `SCORE_BASE = 500`, `POINTS = { onTime: 15, late: -20, missed: -120 }`, `TIERS` with A at 700, B at 600, C at 500, D at 300; `tierOf(v)` and `tierColor(grade)`.

- `ScoreRing` is an arc from 140 degrees sweeping 260 degrees; the fraction `(clamp(v) - 300) / 550` is a motion value with a spring (stiffness 42, damping 14, mass 1.1). Tier bands are drawn under the value arc, boundary ticks at 500, 600 and 700, the tier letter of the current grade highlighted. `role="img"` with an `aria-label` naming the score and tier.
- `ScoreBreakdown` shows the four `getRecord` counters as bars scaled to the largest, with the points column `pts * n` for on-time, late and missed.
- `scoreSeries(events)` is the replay formula: filter `ContributionRecorded` and `ContributionMissed`, sort ascending by Creditcoin block, and after each event compute `clamp(500 + 15*onTime - 20*late - 120*missed)` with the running counters. `ScoreSparkline` draws that series as a line from a `start 500` origin, one dot per event coloured by kind, y axis snapped to 50-point gridlines with 30 points of padding, and a note saying whether the last point equals the live `creditScore` (it differs when the event window is partial).

### `ProofFeed` and `describe()` ([`components/ProofFeed.tsx`](../../web/src/components/ProofFeed.tsx), [`hooks.ts`](../../web/src/hooks.ts))

`ProofFeed` lists `FeedItem`s in a `Section`, a coloured dot per event kind, the sentence, then `block N · <tx link> · query <qid>`. `compact` shows the first eight. `describe(name, args)` produces the sentence; rounds are printed 1-indexed for people with the 0-based on-chain index appended as `(rN)`, which `FeedText` renders as a small mono chip. Examples from the code:

| Event | Sentence |
|---|---|
| `ContributionRecorded` | `Proven: 0xAB…CD paid 100 tUSD for round 1 at Sepolia block N (on time \| LATE) (r0)` |
| `BatchVerified` | `0x0FD2 verified 3 tx in ONE call · Sepolia blocks A–B` |
| `ContributionMissed` | `Missed: 0xAB…CD did not pay round 2 by attested block D · proven by attestation @ H 0xhash… (r1)`; the attestation suffix appears only when `attestedHeight > 0` |
| `RoundClosed` | `Round 1 closed → 0xAB…CD receives 300 tUSD (0 missed) · attested @ H (r0)` |
| `RoundOpened` | `Round 2 open · pay by Sepolia block D (r1)` |
| `PayoutConfirmed` | `Payout proven: 0xAB…CD received 300 tUSD on Ethereum` |
| `CircleCreated` | `Circle "name" created · 3 members · 100 tUSD/round` |
| `CircleCompleted` | `Circle completed`, then the note that every member has received a pot (the source string joins the two with a dash) |
| `InviteRedeemed` | `0xAB…CD joined by invite` |

### `BlockProgress`, `Stat`, `Tag`, `Blockie`, `Section` ([`components/ui.tsx`](../../web/src/components/ui.tsx))

`BlockProgress({ start, deadline, now, attested })` draws 48 ticks, or 24 when `(max-width: 640px)` matches at mount, across the round's block span. Tick classes: the last tick is `deadline`, the tick at the source head is `head`, ticks up to the attested position are `on` (mint), ticks between attested and head are `late` (amber). `Blockie` is a deterministic 5 by 5 identicon: seed is the first eight hex characters, an LCG with 1103515245 and 12345, fifteen mirrored cells, hue `seed % 360`; [`three/blockie.ts`](../../web/src/three/blockie.ts) rasterises the same cells for the 3D coins. `Section` accepts `tour`, which becomes the `data-tour` attribute the guided tour targets. `Tag` tones are `mint`, `amber`, `rose`, `sky`, `muted`; `wrap` lets a long tag break on phones.

### `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonStat`, `SkeletonRows`, `Empty` ([`components/Skeleton.tsx`](../../web/src/components/Skeleton.tsx))

Shimmer placeholders, all `aria-hidden`; the parents that use them set `aria-busy="true"` and an `aria-label`. `Empty` is `role="status"` with an icon, a title, a body and one action that is a `Link` (`to`), an anchor (`href`) or a button (`onClick`).

### `Toast` ([`components/Toast.tsx`](../../web/src/components/Toast.tsx))

`ToastProvider` keeps at most five toasts (`s.slice(-4)` plus the new one). `toast({ title, description?, tone?, duration?, busy?, id? })` returns an id; `tone` defaults to `sky`, `duration` to 5,000 ms, and `duration: 0` keeps a toast until it is updated or dismissed. `update(id, patch)` re-arms the timer to the patch's `duration` when it sets one; otherwise it re-arms to 5,000 ms unless the patch sets `busy: true`, in which case the existing timer is left alone (`busy` itself is reset to `false` whenever a patch omits it). The viewport is `role="region"` `aria-label="Notifications"`; an `sr-only` `aria-live="polite"` list announces every toast; each toast is `role="alert"` when `rose`, `role="status"` otherwise, with a progress bar that shrinks over the duration (hidden under reduced motion).

### `Nav` ([`components/Nav.tsx`](../../web/src/components/Nav.tsx))

Sticky header with a `data-scrolled` attribute after 12 px of scroll (`useScrolled`). Breakpoints:

| Width | Behaviour |
|---|---|
| under `md` (Tailwind's 48 rem) | Only the logo and the menu button; the attestation pill, Telegram pill, tour button and wallet control move into the sheet. |
| `md` and up | Attestation lag pill, Telegram pill, tour button and wallet control in the header. |
| under `nav` (68.75 rem, set in `index.css` `@theme`) | The seven links live in a Radix `Dialog` sheet that slides in from the right; it closes on route change. |
| `tools` (75 rem) and up | The Telegram pill shows the word next to its icon; the read-only wallet pill shows `no wallet ·`. |
| `wide` (93.75 rem) and up | The attestation pill shows the words `Sepolia N → attested M` beside the `lag` pill. |

The active link carries a shared-layout pill (`layoutId`) that slides between links. The wallet control uses the `injected()` connector only; inside Telegram with no injected provider it shows a `read-only` pill, elsewhere without a wallet an amber `no wallet · read-only` pill.

### `motion.tsx` helpers ([`components/motion.tsx`](../../web/src/components/motion.tsx))

`Reveal` rises in once when 10 % inside the viewport, staggered by `i * 60 ms`; `Stagger` and `Item` cascade a list; `Spotlight` lights a card where the pointer is; `CountUp` eases from 0 (or from the last value) over 900 ms with a cubic ease-out and renders the final value immediately under reduced motion; `useScrolled`; `prefersReducedMotion()`; `EASE_OUT = [0.22, 1, 0.36, 1]`.

## The 3D system

### `Canvas3D` and `useCan3D` ([`three/Canvas3D.tsx`](../../web/src/three/Canvas3D.tsx))

`useCan3D()` returns true only when `prefers-reduced-motion: reduce` does not match, `window.innerWidth >= 640` (`MIN_WIDTH`), and a `webgl2` context can be created (probed once, cached in `webglProbe`). It re-evaluates on changes to the reduced-motion and `min-width: 640px` media queries. When it is false, `Canvas3D` renders its `fallback` prop: the `RotationWheel` on the landing hero, `FlowFallback` (the flow as four labelled chips) on the architecture page, and `TextStory` on the story route.

When it is true, `Canvas3D` renders a `div.t3` (`pointer-events: none`, `aria-hidden` unless a `label` is given, in which case `role="img"`), tracks the pointer over `pointerFrom` (the hero section on the landing page) into a `-1..1` ref shared through `PointerContext`, and observes its own visibility with an `IntersectionObserver` (`rootMargin: 96px`): `active` is false while the stage is scrolled out of view, which sets the fiber `frameloop` to `never`.

### `Stage` ([`three/Stage.tsx`](../../web/src/three/Stage.tsx))

The single `@react-three/fiber` `Canvas`: `dpr={[1, 1.5]}`, `frameloop` `always` or `never` from `active`, camera `near 0.1, far 40`, `antialias`, `alpha`, `powerPreference: 'high-performance'`, no stencil, resize debounced 120 ms. `onCreated` installs the environment: a `RoomEnvironment` (three's procedural studio box, no network fetch) baked through `PMREMGenerator.fromScene(..., 0.04)` once per renderer and cached on the renderer object as `__t3env`; `scene.environmentIntensity = 0.42`. The same handler takes the `WEBGL_lose_context` extension before any loss and, on `webglcontextlost`, asks for a restore after 60 ms while the stage is still mounted; on `webglcontextrestored` the PMREM texture is baked again because render targets do not survive a loss. A console filter drops the one deprecation warning fiber 9.7 triggers by constructing `THREE.Clock` on three r183 and later.

### `HeroScene` ([`three/HeroScene.tsx`](../../web/src/three/HeroScene.tsx))

Props: `{ members?, items, attested?, circleId?, circle? }`. Member coins (cylinder radius 0.33, face texture from `blockieTexture`) orbit a pot at radius 1.95, ringed by 48 instanced block ticks. Nothing idles into invention: every pulse is a ledger event from `items` (newest first).

Event choreography, computed in an effect and consumed by the frame loop through a time-stamped `queue`:

| Ledger event | Cue |
|---|---|
| `ContributionRecorded` | `in`: a pulse travels coin to pot. Events sharing a transaction are queued at the same instant, with `batch: true`, so a batch proof leaves as one flight; the group advances the clock by 2.1 s. |
| `BatchVerified` alone in its transaction | `pot`: the pot flashes (0.5 s). |
| `RoundClosed` | `pot` flash, then 0.5 s later `out` from the pot to the recipient's coin; 1.4 s. |
| `PayoutConfirmed` | `out` to the recipient; 1.0 s. A recipient with a `PayoutConfirmed` for this circle keeps a persistent thin mint ring (`paidRings`). |
| `attested` increasing after the first reading | one sweep of the 48 ticks, 1.2 s tick to tick with a 0.9 s afterglow. |

On first load only the six most recent unseen events are replayed; after that only new ones fire. Events of other circles are dropped once `circleId` is known (`BatchVerified` carries no `circleId` and rides with its transaction). The pulse pool has 12 entries (`POOL`). Per frame: orbit angle advances 0.06 rad/s, coins bob and tilt, the pot breathes and flashes (`potPulse` decays over 1.4 s), pulses lerp along a lifted arc with `easeInOut`, and the camera drifts and follows the pointer (`0.5` on x, `0.28` on y) with an exponential lerp. `delta` is clamped to 50 ms. Lights: hemisphere, two directional, one point light at the pot; `ContactShadows` at 256 px re-rendered every frame (`frames={Infinity}`); `Sparkles` count 28. The camera position `[0, 4.9, 7.4]`, fov 33, is duplicated in `Landing.tsx` as `HERO_CAMERA`.

### `FlowScene` ([`three/FlowScene.tsx`](../../web/src/three/FlowScene.tsx))

Props: `{ attested?, items, proven }`. Two slabs, the vault at x = -3.3 and the ledger at x = 3.3, a prover node between them and a chain node above and behind. Each `ContributionRecorded` becomes a packet on a `CatmullRomCurve3` from the vault top through the prover to the ledger top (`PACKET_DUR` 3.4 s); packets of one transaction leave together on separate lanes; on first mount the last three (`REPLAY`) are replayed. The amber tick drops from the chain node to the ledger (`TICK_DUR` 2.6 s) whenever `attested` moves, including the first reading. The packet pool has 10 entries. `ContactShadows` here is `frames={1}` at 512 px, rendered once. The `proven` count is shown in a drei `Html` label next to the ledger. Camera `[0, 3.2, 8.0]`, fov 30, duplicated in `Architecture.tsx` as `FLOW_CAMERA`.

### Performance budgets

The budgets are the constants above rather than a profiler target: dpr capped at 1.5; frame loop stopped while off screen; all per-frame state in refs with preallocated `Vector3` and `Color` scratch objects (no allocation in `useFrame`); pooled pulses and packets (12 and 10); one PMREM bake per renderer; hero contact shadow at 256 px, flow contact shadow rendered once at 512 px; 48 instanced ticks in one `InstancedMesh`; coin materials and textures built once per member list and disposed on change; `delta` clamped to 50 ms so a background tab does not fast-forward.

### CSS ([`three/three.css`](../../web/src/three/three.css))

`.hero-scene` sits behind the copy at 34 % opacity with a radial mask on tablets and becomes a 560 px column at `min-width: 1024px` with a four-sided linear mask; `.flow-scene` is 420 px (340 px under 1024 px) and collapses to `height: auto` when it contains the fallback. `.t3-label` is the pill style shared by the drei `Html` labels and the flow fallback.

## The story timeline

[`story/timeline.ts`](../../web/src/story/timeline.ts) owns one global clock, `{ chapter, t, playing, chain }`, advanced by a `requestAnimationFrame` loop in `Story.tsx` with wall-clock deltas clamped to 0.25 s. Every scene is a pure function of `clock.t`, so seeking is exact and nothing is React state per frame. `CHAPTERS` has three entries with durations 34 s, 33 s and 26 s and their caption beats (`{ at, until, text }`).

Exports: `chapter(n)`, `subscribe(listener)`, `tick(dt)`, `play(n): Promise<void>` (resolves when the chapter finishes), `seek(n, t)`, `pause()`, `resume()`, and the pure keyframe helpers `clamp01`, `smooth`, `easeInOut`, `easeOut`, `easeIn`, `easeBack`, `seg`, `pulse`, `flash`, `lerp`, and `track(keys)`, a vector track that writes into a caller-supplied array.

Three ways to drive it ([`story/Story.tsx`](../../web/src/story/Story.tsx)):

- URL: `?chapter=1|2|3`, `&autoplay=1` (sets `clock.chain` so chapters run 1 to 3 back to back), `&hud=0` hides the HUD.
- Keyboard: ArrowRight and ArrowLeft change chapter, Space plays or pauses.
- `window.kittyStory`, the recorder API used by [`scripts/media/record-story.mjs`](../../scripts/media/record-story.mjs):

```ts
window.kittyStory = {
  play(chapter: number): Promise<void>   // clears `chain`, plays one chapter, resolves at its end
  seek(chapter: number, t: number): void
  duration(chapter: number): number      // seconds
  pause(): void
}
```

It is installed while `/story` is mounted and deleted on unmount. `StoryStage` ([`story/StoryStage.tsx`](../../web/src/story/StoryStage.tsx)) mounts one `Stage` with `Shadows`, the caption `Overlay` and the active chapter's scene (`Problem`, `Split`, `Enable` under [`story/scenes/`](../../web/src/story/scenes/)). Without WebGL or under reduced motion `TextStory` lists the chapter's captions and highlights the current one on the same clock.

## The guided tour

[`tour/steps.ts`](../../web/src/tour/steps.ts) is the content: 32 `TourStep`s in order. The schema:

```ts
type TourStep = {
  id: string                 // '?tour=<id>' starts here
  route: string              // may contain ':latest' (newest circle id) or ':member' (its first member)
  target: string             // a data-tour value on a real element; '' centres the card
  title: string
  body: string
  placement: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  mobileTarget?: string      // replaces target under 640 px
  tab: 'nav' | 'landing' | 'circles' | 'circle' | 'create' | 'score' | 'borrow' | 'steward' | 'lab' | 'architecture' | 'present' | 'telegram' | 'story'
}
```

`stepIndex(id)` and `firstStepOfTab(tab)` are the lookups the Guide page uses. Targets are `data-tour` attributes: `Section` and `Reveal`/`Stagger` accept a `tour` prop, and pages set `data-tour` directly (`hero`, `stats`, `circle-band`, `circle-ticks`, `circle-stats`, `circle-feed`, `create-open`, `arch-scene`, `arch-flow`, `present-controls`, `nav`, `nav-menu`, `attestation`, `telegram`, `create-button`, `circles-list`, `lab-grid`, and the `Section` targets such as `circle-prove` and `score-dial`).

[`tour/Tour.tsx`](../../web/src/tour/Tour.tsx):

- `TourProvider` owns the step index and resolves `:latest` and `:member` from `useCircleCount` and `useCircle`; while those are loading the route is `undefined` and the card says so; on an empty ledger the route falls back to `/circles` or `/score`. It navigates whenever the resolved route differs from the location.
- `useTour()` returns `{ active, index, step, start(at?), stop(), next(), back() }`. `start` accepts a step id or an index.
- URL parameters: `?tour=1` starts at step 0, `?tour=<stepId>` at that step; the parameter is removed from the address bar with a `replace` navigation.
- Storage: `TOUR_STORAGE_KEY = 'kitty.tour.v1'` in `localStorage`, a JSON object `{ completed?, skipped?, promptDismissed? }` of ISO timestamps. `stop('done')` writes `completed`, `stop('skip')` writes `skipped`, `start` writes `promptDismissed`. Reads and writes are wrapped in try/catch so blocked storage only loses memory of the tour.
- `FirstVisitPrompt` appears 2 s after load unless any of the three keys is set or `?tour` is in the URL, and is suppressed on `/presentation` and `/story`.
- The overlay is one fixed SVG with a masked hole and a mint ring, `z-index 80`, above the nav (30), the sheet (50), the route bar (60) and toasts (70). The target is polled every 120 ms until found, for up to `FIND_TIMEOUT` 6,000 ms; an element with no box is treated as missing after `HIDDEN_TIMEOUT` 1,500 ms, and the card then explains instead of pointing. Under 640 px (`(max-width: 639px)`) the card becomes a bottom or top sheet and `mobileTarget` replaces `target`.
- Keyboard, captured before the deck and the story see it: ArrowRight next, ArrowLeft back, Escape skip; Space, Enter and Backspace are swallowed unless a button or link is focused. Tab is trapped inside the card. The card is `role="dialog" aria-modal="true"` with `aria-labelledby` and `aria-describedby`, and receives focus on every step.

## Telegram Mini App

[`lib/telegram.ts`](../../web/src/lib/telegram.ts). `initTelegram()` is called once from `main.tsx` and is a no-op unless `isTelegramContext()` is true, which requires one of: `window.Telegram.WebApp.initData` already present, `?tg=1` in the query string, `tgWebAppData` or `tgWebAppPlatform` in the URL hash, or `Telegram` in the user agent. The bot's Mini App URL is the hosted dashboard with `?tg=1` (`bot/src/config.ts`, `webAppUrl`).

When it is, the page sets `data-telegram="1"` on `<html>`, injects `https://telegram.org/js/telegram-web-app.js`, and on load calls `ready()`, `expand()`, mirrors the theme (`--tg-bg`, `--tg-text`, `--tg-hint`, `--tg-link`, `--tg-button`, `--tg-button-text`, `--tg-bg-2`, and `data-tg-scheme`), paints Telegram's header and background with the page's own `--bg` (Kitty is a dark design; the chrome follows the page), subscribes to `themeChanged`, and wires the native `BackButton`: `onClick` navigates back through the router, and the button is shown only when the path is not `/` and there is history.

`useTelegram()` exposes `{ inTelegram, webApp, scheme, user }` through `useSyncExternalStore` and keeps the BackButton in step with the current route; it must render inside the router. `Nav` uses it to hide the Telegram pill inside Telegram and to show a `read-only` pill instead of a connect button, because a Mini App has no injected wallet. Bot setup, commands and the `tg=1` link are in [`TELEGRAM.md`](../TELEGRAM.md).

## Accessibility and reduced motion

- Skip link: `<a href="#main" class="skip-link">` is the first element in `App`; the routed page container has `id="main"` and `tabIndex={-1}`. Focus styles are global `:focus-visible` outlines in `index.css`.
- Live regions: the toast viewport's `sr-only` list, the proving log and the lab logs (`aria-live="polite"`), the create and join problem lists, the slide counter, the lab and steward status chips.
- Loading and empty states: skeletons are `aria-hidden` inside containers with `aria-busy="true"` and an `aria-label`; `Empty` is `role="status"`.
- Images and figures: `RotationWheel` and `ScoreRing` are `role="img"` with descriptive labels; wheel members are focusable buttons; the 3D stages are `aria-hidden` unless labelled; the hero wheel fallback is `aria-hidden` because it duplicates the text.
- Dialogs: Radix `Dialog` for the sheet, the pay modal and the re-verify modal (focus trap, `Dialog.Title`, close buttons with `aria-label`); the tour card is its own `role="dialog"` with a manual focus trap.
- Reduced motion: `MotionConfig reducedMotion="user"` in `main.tsx`; every animated component also checks `useReducedMotion()` or `prefersReducedMotion()` and sets `duration: 0` or `initial={false}` (page transitions, `Reveal`, `Stagger`, `CountUp`, the wheel arc and spokes, the score gauge, the sparkline, toasts, the nav sheet, the tour); `useCan3D()` refuses to mount any 3D stage; the story falls back to `TextStory`; `index.css` under `@media (prefers-reduced-motion: reduce)` disables every animation and transition, the skeleton shimmer, the card hover lift and smooth scrolling.
- Print: `@media print` hides `.noprint`, the skip link and the route bar, and paginates `.slide` one per page for the deck.

## Hosted deployment

[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) runs on pushes to `main` and on manual dispatch, gated by the repository variable `ENABLE_PAGES == 'true'`. The `build` job checks out, runs `actions/configure-pages@v5` with `enablement: true`, `pnpm/action-setup@v4`, `actions/setup-node@v4` on Node 22 with the pnpm cache keyed on `web/pnpm-lock.yaml`, `pnpm install --frozen-lockfile` and `pnpm build` in `web/` with `VITE_BASE: /Kitty/`, then `cp web/dist/index.html web/dist/404.html` and uploads `web/dist` with `actions/upload-pages-artifact@v3`. The `deploy` job publishes it with `actions/deploy-pages@v4` to the `github-pages` environment at `https://prashant-thakur77.github.io/Kitty/`.

The base path is threaded through three places: `vite.config.ts` reads `VITE_BASE` into `base`, so every asset URL is prefixed; `BrowserRouter basename={import.meta.env.BASE_URL}` makes the router treat `/Kitty/` as the root; and the code that builds absolute URLs uses `import.meta.env.BASE_URL` (the invite link in `InvitePanel`, the `lab-testnet.json` and `lab-recorded.json` fetches in `Lab`, the logo in `Nav`). The `404.html` copy is the SPA trick for GitHub Pages: a deep link such as `/Kitty/circle/3` has no file on the host, Pages serves `404.html`, which is the same bundle, and the router reads the real path from `location`. There is no `public/404.html` in the repository; the file exists only in the built artifact.

The companion [`ci.yml`](../../.github/workflows/ci.yml) `web` job runs the same install and build without `VITE_BASE`, so a bundle that fails to compile blocks every push. The hosted build has no lab API, reads [`web/.env.production`](../../web/.env.production), and serves the recorded lab and steward data as described under [labApi in DEV versus hosted](#labapi-in-dev-versus-hosted).
