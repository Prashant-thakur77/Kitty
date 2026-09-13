# Data formats

Every JSON file and configuration file the off-chain side reads or writes, as a table per format, with a real example where one is committed to the repository (long hashes trimmed to their first and last characters). Field names and types are taken from the TypeScript interfaces and the code that writes each file; the source is named in each section.

Where the behaviour behind a file is described elsewhere, this document links rather than repeats: the worker in [`STEWARD.md`](STEWARD.md), the lab API and recordings in [`LAB_API.md`](LAB_API.md), the bot in [`BOT.md`](BOT.md), deployment and environment keys in [`../OPERATIONS.md`](../OPERATIONS.md).

## Contents

- [Worker state: `worker/state*.json`](#worker-state-workerstatejson)
- [Steward decision log: `worker/steward*.json`](#steward-decision-log-workerstewardjson)
- [Dashboard steward samples: `web/src/data/steward.sample.json`, `steward.explain.sample.json`](#dashboard-steward-samples)
- [Lab recordings: `web/public/lab-recorded.json`, `lab-testnet.json`](#lab-recordings)
- [Proof bundles: `pnpm receipts` and the Score page](#proof-bundles)
- [`deployments.json`](#deploymentsjson)
- [Web environment: `web/.env.production`, `web/.env`, `web/.env.local`](#web-environment)
- [`worker/demo-members.local.json`](#workerdemo-memberslocaljson)
- [Bot state: `bot/state.json`](#bot-state-botstatejson)
- [Proof Builder responses and the `BatchProof` interface](#proof-builder-responses-and-the-batchproof-interface)
- [Which files are committed](#which-files-are-committed)

## Worker state: `worker/state*.json`

Written by `saveState` in `worker/src/config.ts` (`JSON.stringify(s, null, 2)`) to `worker/<WORKER_STATE_FILE>` (default `state.local.json`) at the end of every tick and immediately after a payout. Read by `loadState`; a missing or unparsable file loads as `{ lastSourceBlock: 0, recorded: {}, paid: {}, confirmed: {} }`.

| Field | Type | Meaning |
|---|---|---|
| `lastSourceBlock` | number | Last source-chain block fully scanned. Pinned to `oldestPendingBlock - 1` while payments are pending, so a restart rescans them. `0` means a fresh state; the first scan then starts at `WORKER_FROM_BLOCK` or `head - 200`. |
| `recorded` | `Record<txHash, true>` | Source transaction hashes the ledger has recorded, or that the worker has quarantined as unrecordable (unknown circle, completed circle, closed round, before start height, non-member, wrong amount, duplicate). Never scanned again. |
| `paid` | `Record<"circleId:round", txHash>` | Source-chain `KittyVault.payout` transaction per closed round. Written before the proof-back; the recovery procedure for a lost hash edits this map. |
| `confirmed` | `Record<payoutTxHash, true>` | Payout transactions proven back with `confirmPayout` or `confirmPayouts`. |

Example, `worker/state.e2e.json` (a complete two-round local run):

```json
{
  "lastSourceBlock": 97,
  "recorded": {
    "0xc8ef21ee…25d2e": true,
    "0x63b548fe…e93f3": true,
    "0x7e9c88b5…ba0e2": true,
    "0x7aa618b0…c4a7": true,
    "0x3d4f80d3…d383": true
  },
  "paid": {
    "1:0": "0xeaad334e…fa955",
    "1:1": "0xe3170f30…427ba"
  },
  "confirmed": {
    "0xeaad334e…fa955": true,
    "0xe3170f30…427ba": true
  }
}
```

## Steward decision log: `worker/steward*.json`

Written by `record` in `worker/src/agent/log.ts` to `worker/<STEWARD_LOG_FILE>` (default `steward.local.json`) as a JSON array, `JSON.stringify(all.slice(-500), null, 1)`: the last 500 entries, oldest first, indented with one space. `read(limit)` returns the last `limit` entries newest first.

One entry (`Decision`):

| Field | Type | Meaning |
|---|---|---|
| `at` | string | ISO 8601 UTC timestamp set by `record`. |
| `kind` | `"prove" \| "wait" \| "close" \| "payout" \| "confirm" \| "skip" \| "error"` | What was decided or done. |
| `summary` | string | One sentence; for `prove` and `wait` it is `explainBatch`'s sentence. |
| `evidence` | object | Numbers, strings and booleans that came from chain state. These are the only values layer 3 may cite. |
| `txs` | `{ chain: "source" \| "creditcoin", hash: string }[]`, optional | The transactions the decision produced or covered. |

Evidence keys by kind (the complete list is in [`STEWARD.md`](STEWARD.md#the-decision-log)):

| kind | evidence keys | txs |
|---|---|---|
| `wait`, nothing provable | `pending`, `provable` (0), `attestedHeight`, `waitingOnAttestation` | none |
| `wait`, something provable | `chainKey`, `queries`, `circles`, `attestedHeight`, `sourceHead`, `blocksOfSlack`, `roundsCompleted`, `blockSpan`, `leftBehind`, `waitedSeconds`, `stillWaitingForAttestation`, and when held `heldForRoundmates`, `holdUntilAttested` | none |
| `prove` | the `wait` keys plus `preflight: "passed"`, `queriesInCall`, `fromHeight`, `toHeight`, `continuityRoots` | one `creditcoin` (the `recordContributions` tx) then one `source` per payment |
| `skip` | the `wait` keys plus `preflight: "rejected"` | none |
| `error` | the `wait` keys plus `revert` | none |
| `close` | `circleId` (string), `round`, `closeHeight` (string), `proven`, `members`, `everyoneProven` | one `creditcoin` |
| `payout` | `circleId` (string), `round`, `recipient`, `amount_tUSD` | one `source` |
| `confirm`, single | `circleId` (string), `round`, `sourceHeight` | one `creditcoin`, one `source` |
| `confirm`, batch | `payouts`, `circles` (comma-joined string), `heights` (comma-joined string), `continuityRoots` | one `creditcoin`, one `source` per payout |

Examples from `worker/steward.testnet4.json` (the CC3 Testnet campaign of 12 and 13 September 2026):

```json
{
 "at": "2026-09-12T06:33:18.380Z",
 "kind": "prove",
 "summary": "proving 3 payment(s) from 1 circle(s) on chain key 1 in one call: 1 round(s) complete, so proving now lets them close",
 "evidence": {
  "chainKey": 1, "queries": 3, "circles": 1,
  "attestedHeight": 11687150, "sourceHead": 11687183, "blocksOfSlack": 218,
  "roundsCompleted": 1, "blockSpan": 7, "leftBehind": 0, "waitedSeconds": 396,
  "stillWaitingForAttestation": 0,
  "preflight": "passed", "queriesInCall": 3,
  "fromHeight": 11687142, "toHeight": 11687149, "continuityRoots": 9
 },
 "txs": [
  { "chain": "creditcoin", "hash": "0xac2a637f…652fe9" },
  { "chain": "source", "hash": "0xe896669f…87a4b" },
  { "chain": "source", "hash": "0xbff79eb5…ecfa1d" },
  { "chain": "source", "hash": "0x02b511aa…1dd204" }
 ]
}
```

```json
{
 "at": "2026-09-12T07:11:07.325Z",
 "kind": "wait",
 "summary": "waiting: 2 query(ies) ready but 3 roundmate payment(s) not yet attested (need source block 11687346); 323 blocks of slack, holding for one call",
 "evidence": {
  "chainKey": 1, "queries": 2, "circles": 1, "attestedHeight": 11687340, "sourceHead": 11687374,
  "blocksOfSlack": 323, "roundsCompleted": 0, "blockSpan": 1, "leftBehind": 0, "waitedSeconds": 431,
  "stillWaitingForAttestation": 6, "heldForRoundmates": 3, "holdUntilAttested": 11687346
 }
}
```

```json
{
 "at": "2026-09-12T08:37:47.723Z",
 "kind": "close",
 "summary": "closed circle 1 round 1 — close height 11687601 attested",
 "evidence": { "circleId": "1", "round": 1, "closeHeight": "11687601", "proven": 2, "members": 3, "everyoneProven": false },
 "txs": [ { "chain": "creditcoin", "hash": "0xef146316…9f01ca" } ]
}
```

```json
{
 "at": "2026-09-12T06:33:52.100Z",
 "kind": "payout",
 "summary": "paid circle 1 round 0: 300 tUSD to 0xB077B088E668386Bc57af87F175d250f459f0791",
 "evidence": { "circleId": "1", "round": 0, "recipient": "0xB077B088E668386Bc57af87F175d250f459f0791", "amount_tUSD": 300 },
 "txs": [ { "chain": "source", "hash": "0xfee30618…7263c3" } ]
}
```

```json
{
 "at": "2026-09-13T15:07:18.544Z",
 "kind": "confirm",
 "summary": "2 payouts (circle 6 round 0, circle 7 round 0) proven back to Creditcoin in one call",
 "evidence": { "payouts": 2, "circles": "6,7", "heights": "11696611,11696612", "continuityRoots": 10 },
 "txs": [
  { "chain": "creditcoin", "hash": "0x5496258b…700953" },
  { "chain": "source", "hash": "0x4cce8892…7168ab" },
  { "chain": "source", "hash": "0x54685f67…057c863" }
 ]
}
```

```json
{
 "at": "2026-09-12T07:13:31.667Z",
 "kind": "error",
 "summary": "batch failed: nonce has already been used",
 "evidence": { "chainKey": 1, "queries": 8, "circles": 2, "attestedHeight": 11687350, "sourceHead": 11687383, "blocksOfSlack": 266, "roundsCompleted": 2, "blockSpan": 11, "leftBehind": 0, "waitedSeconds": 546, "stillWaitingForAttestation": 0, "revert": "nonce has already been used" }
}
```

No committed log contains a `skip` entry; its shape is the `wait` evidence plus `"preflight": "rejected"` and the summary `0x0FD2 preflight rejected the batch: <detail>`.

## Dashboard steward samples

`web/src/data/steward.sample.json` is the file the hosted `/steward` page shows when no lab API is reachable (`web/src/pages/Steward.tsx`). Unlike the worker's log it is an object wrapping the entries; the page accepts either a bare array or this wrapper (`Array.isArray(rec) ? rec : rec.entries`) and reverses the list to show newest first.

| Field | Type | Meaning |
|---|---|---|
| `mode` | string | `"testnet"` in the committed file; the page uses a non-`local` mode to add explorer links. |
| `recordedAt` | string | Date of the extract (`"2026-09-13"`). |
| `note` | string | How the extract was trimmed. |
| `entries` | `Decision[]` | Worker log entries, oldest first, exactly the format above. |

Committed values: `mode: "testnet"`, `recordedAt: "2026-09-13"`, `note: "wait decisions trimmed to the one before each proof; last 24 decisions"`, 24 entries from `2026-09-12T09:06:50Z` to `2026-09-13T08:45:31Z`.

`web/src/data/steward.explain.sample.json` is the recorded layer-3 answer the hosted page shows in place of the live form:

| Field | Type | Meaning |
|---|---|---|
| `question` | string | The question that was asked. |
| `recordedAt` | string | Date. |
| `recordedWith` | string | Provenance note. |
| `text`, `source`, `verified`, `stripped` | | The `Explanation` returned by `explain()` ([`STEWARD.md`](STEWARD.md#the-explain-contract)). |

Committed file, in full:

```json
{
 "question": "why did you prove one payment alone?",
 "recordedAt": "2026-09-12",
 "recordedWith": "pnpm explain, run against the CC3 Testnet log in steward.sample.json with no ANTHROPIC_API_KEY on the worker",
 "text": "payout for circle 1 round 0 proven back to Creditcoin",
 "source": "deterministic",
 "verified": [],
 "stripped": []
}
```

## Lab recordings

Written by `worker/src/record-lab.ts` (`pnpm lab:record`) to `LAB_RECORD_OUT` (default `web/public/lab-recorded.json`), `JSON.stringify(…, null, 1)`. The hosted `/lab` page fetches `lab-testnet.json` first and falls back to `lab-recorded.json` (`web/src/pages/Lab.tsx`, type `Recorded`).

| Field | Type | Meaning |
|---|---|---|
| `commit` | string | `git rev-parse HEAD` at recording time. |
| `date` | string | ISO timestamp of the write. |
| `mode` | `"local" \| "testnet"`, optional | `cfg.mode`. Absent from the committed `lab-recorded.json`, which predates the field; the page treats it as optional. |
| `chainId` | number, optional | `102031` in testnet mode; `undefined` (omitted) in local mode. |
| `results` | `Recorded[]` | One per scenario, in the fixed order `replay, wrongChain, revertedTx, late, spoofEmitter, stealFromSteward, fireTheAgent, poisonReasoning`. |

`Recorded` (`ScenarioResult` plus the scenario's metadata and its log):

| Field | Type | Meaning |
|---|---|---|
| `name` | `ScenarioName` | One of the eight names. |
| `title` | string | From `SCENARIOS` in `worker/src/scenarios.ts`. |
| `expected` | string | The custom error name or outcome the ledger must produce. |
| `description` | string | From `SCENARIOS`. |
| `lines` | string[] | Every `log()` line emitted during the run, each prefixed `HH:MM:SS`. |
| `ok` | boolean | Verdict. |
| `got` | string | What actually happened, for example `QueryAlreadyProcessed(0x…)`. |
| `skipped` | `true`, optional | Present only when the scenario could not run in this environment. |

Committed files: `web/public/lab-testnet.json` (`commit 1f065848…`, `date 2026-09-12T05:50:01.223Z`, `mode "testnet"`, `chainId 102031`, 8 results, all `ok: true`) and `web/public/lab-recorded.json` (`commit f30433dd…`, `date 2026-09-11T21:13:50.263Z`, no `mode` or `chainId`, 8 results, all `ok: true`).

Example, the `late` result from `lab-testnet.json`:

```json
{
 "name": "late",
 "title": "Late payment",
 "expected": "ContributionRecorded onTime=false",
 "description": "A member pays after the round deadline block. The proof is accepted, but the proven height marks it late in the credit record.",
 "lines": [
  "05:40:59 ── Late payment · expecting ContributionRecorded onTime=false",
  "05:41:01 circle 1 round 1 · deadline block 11686925 · source head 11686933",
  "05:41:14 0x128aC52048072BeEb5b930Cc5D9F8c91EDE5bEBA contributed at source block 11686934 (deadline 11686925) · tx 0xff8484c8…8fdade",
  "05:41:14 waiting for Sepolia block 11686934 to be attested on Creditcoin…",
  "05:49:52 attested. requesting batch proof for 1 tx(s)…",
  "05:49:54 → KittyLedger.recordContributions(1 tx, heights 11686934–11686934) gas=1500000",
  "05:50:01    ✓ verified by 0x0FD2 in one call · cc tx 0x41eb39bf…7dd362",
  "05:50:01 ✓ ContributionRecorded onTime=false (height 11686934, deadline 11686925)",
  "05:50:01 PASS late · expected ContributionRecorded onTime=false · got ContributionRecorded onTime=false (height 11686934, deadline 11686925)"
 ],
 "ok": true,
 "got": "ContributionRecorded onTime=false (height 11686934, deadline 11686925)"
}
```

## Proof bundles

Two writers produce a member's proof bundle and their shapes differ slightly. No bundle is committed to the repository (`pnpm receipts` writes `kitty-receipts-<first 10 chars of address>.json` in the working directory unless an output file is given; the browser downloads a file of the same name).

### `pnpm receipts <member> [outFile]` (`worker/src/receipts.ts`)

Scans `KittyLedger` events on Creditcoin from `LEDGER_DEPLOY_BLOCK` (or `head - 50000`) to head, keeps the rows where `member` or `recipient` equals the address, sorts them by Creditcoin block, attaches the source-chain `Contributed` transaction to each `ContributionRecorded` row, then reads `creditScore` and `getRecord`. Written with `JSON.stringify(bundle, null, 2)`.

| Field | Type | Meaning |
|---|---|---|
| `member` | string | The address as given on the command line. |
| `issuedAt` | string | ISO timestamp. |
| `score` | number | `creditScore(member).score`. |
| `tier` | string | `creditScore(member).tier`. |
| `record` | `{ onTime, late, missed, received, volume_tUSD }` | `getRecord(member)`; `volume_tUSD` is `volume / 1e6`. |
| `ledger` | `{ address, chainId, rpc }` | `cfg.ledger`, the Creditcoin chain id as a string, `cfg.creditcoinRpc`. |
| `sourceChain` | `{ chainKey, vault, rpc }` | `cfg.chainKey`, `cfg.vault`, `cfg.sepoliaRpc`. |
| `attestcoin` | `{ blockProver, chainInfo, proofBuilder }` | `0x…0FD2`, `0x…0fD3`, `cfg.proofBuilderUrl`. |
| `howToVerify` | string[] | Four fixed sentences naming `pnpm verify:live <sourceTx>` and the ledger reads. |
| `entries` | `Row[]` | See below. |

`Row` (fields absent when the event does not carry them):

| Field | Type | From |
|---|---|---|
| `event` | `"ContributionRecorded" \| "ContributionMissed" \| "RoundClosed" \| "PayoutConfirmed"` | event name |
| `circleId` | string | `args.circleId` |
| `round` | number | `args.round` |
| `amount` | string, e.g. `"100 tUSD"` | `args.amount / 1e6` with the unit appended (`ContributionRecorded`, `PayoutConfirmed`; `RoundClosed` carries `pot`, not `amount`, so the field is absent there) |
| `sourceHeight` | number | `args.sourceHeight` (`ContributionRecorded`) |
| `onTime` | boolean | `args.onTime` (`ContributionRecorded`) |
| `deadlineHeight` | number | `args.deadlineHeight` (`ContributionMissed`) |
| `queryId` | string | `args.queryId` (`ContributionRecorded`, `PayoutConfirmed`) |
| `creditcoinTx` | string | the Creditcoin transaction that emitted the event |
| `creditcoinBlock` | number | its block |
| `sourceTx`, `sourceBlock` | string, number | the vault `Contributed` transaction matched by member, circle and round (`ContributionRecorded` only) |

### The Score page's "Proof bundle" button (`web/src/pages/Score.tsx`, `exportBundle`)

Built in the browser from the ledger event feed (`useLedgerEvents({ member })`) and downloaded as a Blob.

| Field | Difference from the CLI bundle |
|---|---|
| `member`, `issuedAt` | same |
| `score`, `tier` | `null` when the ledger has not answered yet (the button is disabled in that case) |
| `record` | same keys; `undefined` (omitted) if not loaded |
| `ledger` | `chainId` is a number (`cfg.creditcoinChainId`) |
| `sourceChain` | same |
| `attestcoin` | `{ blockProver, chainInfo }` only, no `proofBuilder` |
| `howToVerify` | four sentences with slightly different wording, mentioning the Re-verify button |
| `entries` | `{ event, text, circleId, round, queryId, creditcoinTx, creditcoinBlock }` where `text` is the feed's one-line description and `creditcoinBlock` is a string; no `amount`, `sourceHeight`, `onTime`, `deadlineHeight`, `sourceTx` or `sourceBlock` |

## `deployments.json`

Rewritten by `scripts/deploy.sh` after every deployment (a heredoc at the end of the script); committed so the hosted dashboard and the documents share one source of addresses.

| Field | Type | Meaning |
|---|---|---|
| `sepolia.chainId` | number | `11155111` |
| `sepolia.TestUSD`, `sepolia.KittyVault`, `sepolia.FakeVault` | address | Source-chain contracts. |
| `creditcoinTestnet.chainId` | number | `102031` |
| `creditcoinTestnet.KittyLedger`, `.KittyViewer`, `.KittyUSD`, `.KittyCreditLine`, `.KittyBadge` | address | Creditcoin contracts. |
| `creditcoinTestnet.deployBlock` | number | `LEDGER_DEPLOY_BLOCK`, the Creditcoin block number read right after the ledger was created. |
| `creditcoinTestnet.BlockProverPrecompile`, `.ChainInfoPrecompile` | address | The two Attestcoin precompiles, constant. |
| `sourceChainKey` | number | `SOURCE_CHAIN_KEY`, `1` for Sepolia on CC3 Testnet. |

Committed file:

```json
{
  "sepolia": { "chainId": 11155111, "TestUSD": "0xc6fe7fd411681E07a44523f87F6aB0805903c2dE", "KittyVault": "0xa27eD42Ce06AaBe1D5924272fDb913b4CBC0DA84", "FakeVault": "0xf6f984c6aa6806a8afcc8713a2adea7fa05cf1fb" },
  "creditcoinTestnet": { "chainId": 102031, "KittyLedger": "0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276", "KittyViewer": "0xFfA85A21eBa3e46EFe3C53c77f1AF4f4Cdddc947",
    "KittyUSD": "0x1172ABd45724069749E9EB98A0349177435B284E", "KittyCreditLine": "0xB54943A1cEd46aE1bB844260B77896b9A134B1ED", "KittyBadge": "0x17EcDc95Be4f238e26F8f2005ED60D2bd22C1F46", "deployBlock": 5473533,
    "BlockProverPrecompile": "0x0000000000000000000000000000000000000FD2",
    "ChainInfoPrecompile": "0x0000000000000000000000000000000000000fD3" },
  "sourceChainKey": 1
}
```

Nothing under `worker/` or `bot/` reads `deployments.json`; they read the same addresses from `.env`.

## Web environment

Dotenv files read by Vite for the dashboard. Every key is read in `web/src/config.ts` unless noted; the default applies when the key is absent.

| Key | Default in code | Meaning |
|---|---|---|
| `VITE_KITTY_LEDGER_ADDRESS` | `''` | `KittyLedger` |
| `VITE_KITTY_VIEWER_ADDRESS` | `''` | `KittyViewer` |
| `VITE_KITTY_VAULT_ADDRESS` | `''` | `KittyVault` |
| `VITE_FAKE_VAULT_ADDRESS` | `''` | `FakeVault` (the spoof emitter shown on the lab page) |
| `VITE_TEST_USD_ADDRESS` | `''` | The stablecoin |
| `VITE_KITTY_CREDIT_ADDRESS` | `''` | `KittyCreditLine` |
| `VITE_KITTY_BADGE_ADDRESS` | `''` | `KittyBadge` |
| `VITE_KITTY_USD_ADDRESS` | `''` | `KittyUSD` |
| `VITE_SOURCE_CHAIN_KEY` | `1` | Chain key of the source chain |
| `VITE_SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | |
| `VITE_CREDITCOIN_RPC_URL` | `https://rpc.cc3-testnet.creditcoin.network` | |
| `VITE_SEPOLIA_CHAIN_ID` | `11155111` | |
| `VITE_CREDITCOIN_CHAIN_ID` | `102031` | |
| `VITE_SEPOLIA_EXPLORER` | `https://sepolia.etherscan.io` | |
| `VITE_CREDITCOIN_EXPLORER` | `https://creditcoin-testnet.blockscout.com` | |
| `VITE_LEDGER_DEPLOY_BLOCK` | `0` | Start of the dashboard's ledger event scans (`BigInt`) |
| `VITE_LAB_API` | `http://localhost:8790` in dev, `''` in production builds | Lab API base URL; empty means the pages go straight to the committed recordings |
| `VITE_REPO_URL` | `https://github.com/Prashant-thakur77/Kitty` | |
| `VITE_PROOF_BUILDER_URL` | `https://prover.cc3-testnet.creditcoin.network` | read in `web/src/lib/prover.ts` |
| `VITE_TELEGRAM_BOT_URL` | `https://t.me/KittyCirclesBot` | read in `web/src/lib/telegram.ts` |
| `VITE_BASE` | `/` | read in `web/vite.config.ts` as the router base (`/Kitty/` on GitHub Pages) |

Files:

- `web/.env.example`: the template (nine keys, addresses empty).
- `web/.env.production`: committed; written by `scripts/deploy.sh` with the eight addresses, `VITE_LEDGER_DEPLOY_BLOCK` and `VITE_SOURCE_CHAIN_KEY`. Committed content, in full:

  ```
  VITE_TEST_USD_ADDRESS=0xc6fe7fd411681E07a44523f87F6aB0805903c2dE
  VITE_KITTY_VAULT_ADDRESS=0xa27eD42Ce06AaBe1D5924272fDb913b4CBC0DA84
  VITE_FAKE_VAULT_ADDRESS=0xf6f984c6aa6806a8afcc8713a2adea7fa05cf1fb
  VITE_KITTY_LEDGER_ADDRESS=0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276
  VITE_KITTY_VIEWER_ADDRESS=0xFfA85A21eBa3e46EFe3C53c77f1AF4f4Cdddc947
  VITE_KITTY_USD_ADDRESS=0x1172ABd45724069749E9EB98A0349177435B284E
  VITE_KITTY_CREDIT_ADDRESS=0xB54943A1cEd46aE1bB844260B77896b9A134B1ED
  VITE_KITTY_BADGE_ADDRESS=0x17EcDc95Be4f238e26F8f2005ED60D2bd22C1F46
  VITE_LEDGER_DEPLOY_BLOCK=5473533
  VITE_SOURCE_CHAIN_KEY=1
  ```

- `web/.env`: the same keys, written by `deploy.sh`; gitignored.
- `web/.env.local`: written by `scripts/local-setup.sh` with the anvil RPCs, chain ids, `VITE_LAB_API=http://localhost:<PORT>`, `VITE_LEDGER_DEPLOY_BLOCK=1` and the local addresses; gitignored. `web/.env.local-demo` is a hand-written template for the same purpose; it is matched by the `.env.*` ignore rule and is not tracked.

## `worker/demo-members.local.json`

Written and read by `memberWallets(n)` in `worker/src/members.ts` in testnet mode only (local mode uses anvil's default accounts 1..N and never touches the file). Gitignored: it holds private keys.

| Shape | Meaning |
|---|---|
| `string[]` | Private keys (`0x` plus 64 hex characters) of the demo members, index `i` being member `i`. `memberWallets(n)` appends random keys until the array has at least `n` entries, rewrites the file, and returns the first `n` as wallets on the source chain. |

The local file currently holds 5 keys; they are not reproduced here.

## Bot state: `bot/state.json`

Written by `saveState` in `bot/src/state.ts` (`JSON.stringify(s, null, 2)`) to `BOT_STATE_FILE` (default `bot/state.json`, directories created as needed). `loadState` fills missing fields with defaults. Gitignored (`bot/state*.json`).

| Field | Type | Meaning |
|---|---|---|
| `lastBlock` | number | Last Creditcoin block whose ledger events were delivered. `0` means no cursor: the first tick starts at `max(LEDGER_DEPLOY_BLOCK, head - BOT_LOOKBACK_BLOCKS)`, or at the deploy block when the lookback is `all`. |
| `chats` | `Record<chatId, { members: string[]; circles: string[] }>` | Subscriptions per Telegram chat id (or `"sim"` and `"dry"` in the simulate and dry-run modes). Members are checksummed addresses, circles are decimal strings. |
| `reminded` | `Record<"circleId:round:member", true>` | Reminders already sent; `member` is lowercased. |

The local file at the time of writing:

```json
{
  "lastBlock": 5482029,
  "chats": {
    "7222883424": {
      "members": [],
      "circles": [
        "5"
      ]
    }
  },
  "reminded": {}
}
```

## Proof Builder responses and the `BatchProof` interface

The worker consumes the hosted Proof Builder through `@gluwa/usc-sdk@0.18.0` (`proofProvider.service.ProofBuilder`) and normalises everything into one interface, `BatchProof` in `worker/src/proofs.ts`, which is what `preflight`, `submitRecordContributions`, `submitConfirmPayout` and `submitConfirmPayouts` take.

```ts
interface MerkleProof     { root: string; siblings: { hash: string; isLeft: boolean }[] }
interface ContinuityProof { lowerEndpointDigest: string; roots: string[] }
interface BatchProof {
  chainKey: number;
  heights: number[];              // source block per transaction, in txHashes order
  txBytes: string[];              // prover-format encoded transaction + receipt, hex
  merkleProofs: MerkleProof[];    // one per transaction
  continuity: ContinuityProof;    // one shared continuity proof
  txHashes: string[];             // the caller's order
}
```

| Field | Ledger argument |
|---|---|
| `chainKey` | `chainKey` |
| `heights` | `heights[]` (or `heights[0]` for `confirmPayout`) |
| `txBytes` | `encodedTxs[]` |
| `merkleProofs` | `merkleProofs[]` as `(bytes32 root, (bytes32 hash, bool isLeft)[] siblings)` |
| `continuity` | `continuity` as `(bytes32 lowerEndpointDigest, bytes32[] roots)` |
| `txHashes` | not sent; used to mark `state.recorded` and to fill `txs` in the decision log |

SDK shapes the worker flattens from (`node_modules/@gluwa/usc-sdk/dist/proof-provider/index.d.ts`):

| Endpoint | SDK method | `data` shape |
|---|---|---|
| `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` | `getProof(txHash)` | `{ chainKey, headerNumber, txIndex, txHash, txBytes, continuityProof: { lowerEndpointDigest, roots }, merkleProof: { root, siblings } }` |
| `POST /api/v1/proof-batch-by-tx/{chainKey}` with a JSON array of hashes | `getBatchProof(hashes)` | `{ chainKey, fromHeader, toHeader, continuityProof, merkleProofs: Map<height, Map<txIndex, { txHash, txBytes, merkleProof }>> }` |
| `GET /api/v1/attested-height/{chainKey}` | `waitUntilHeightAttested` (polling) | `{ attestedHeight }` as read directly by `worker/src/verify-live.ts` |

Both SDK methods return `{ success, data?, error? }`. Over plain HTTP (as `verify-live.ts` reads it) the batch `merkleProofs` is a JSON object keyed by height and then by transaction index, which the SDK turns into nested `Map`s. `flattenBatch` reorders the entries into the caller's hash order; the single-proof fallback groups singles by `headerNumber` and, when the SDK's `mergeProofs` can join their continuity proofs, produces one `BatchProof` whose `continuity.roots` covers every Merkle root ([`STEWARD.md`](STEWARD.md#proof-building)).

In local mode the same interface is filled without a Proof Builder: real `txBytes` from `encoding.abiEncode`, `merkleProofs[i] = { root: keccak256(txHash), siblings: [] }`, `continuity = { lowerEndpointDigest: 0x00…00, roots: [keccak256("local")] }`.

## Which files are committed

From `.gitignore`: `.env` and every `.env.*` except `.env.example` and `web/.env.production`; `web/.env.local`; `worker/state*.json`; `worker/steward*.json`; `worker/demo-members.local.json`; `bot/state*.json`; `deployments.local.json`. Tracked (`git ls-files`): `deployments.json`, `web/.env.production`, `web/public/lab-recorded.json`, `web/public/lab-testnet.json`, `web/src/data/steward.sample.json`, `web/src/data/steward.explain.sample.json`, `.env.example`, `web/.env.example`.
