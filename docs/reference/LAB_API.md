# Lab API and attack scenarios

The attack lab is three pieces of code that share one scenario catalogue: the HTTP and SSE server in `worker/src/api.ts` (`pnpm lab:api`), the scenarios themselves in `worker/src/scenarios.ts` (`pnpm scenario`), and the recorder in `worker/src/record-lab.ts` (`pnpm lab:record`) whose output the hosted dashboard replays. This document is the reference for all three and for how `web/src/pages/Lab.tsx` consumes them.

Related: the runbook entries for starting the API and recording the lab are in [`../OPERATIONS.md`](../OPERATIONS.md#the-lab-api-pnpm-labapi); the ledger checks each scenario exercises are in [`../TECH.md`](../TECH.md#how-a-sepolia-payment-becomes-creditcoin-state); the threats they map to are in [`../THREAT_MODEL.md`](../THREAT_MODEL.md); the file formats are in [`DATA_FORMATS.md`](DATA_FORMATS.md).

## Contents

- [The server](#the-server)
- [Routes](#routes)
- [The SSE stream](#the-sse-stream)
- [Errors](#errors)
- [Scenario catalogue](#scenario-catalogue)
- [Running scenarios from the command line](#running-scenarios-from-the-command-line)
- [The recorder: `pnpm lab:record`](#the-recorder-pnpm-labrecord)
- [How the Lab page consumes the API and the recordings](#how-the-lab-page-consumes-the-api-and-the-recordings)

## The server

`worker/src/api.ts` is a plain `node:http` server.

| Property | Value |
|---|---|
| Port | `PORT`, default `8790` |
| CORS | `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`, headers `Content-Type`; `OPTIONS` answers `204` |
| Authentication | none |
| Key | it imports `worker/src/config.ts` and `runScenario` calls `contracts()`, so the process holds `PRIVATE_KEY`; it is local-only by design |
| Concurrency | one scenario at a time (`running: string | null`) |
| Startup log | `kitty lab api · http://localhost:<port> · mode=<mode> · vault <address> · ledger <address>` then `GET /scenarios · POST /run/{replay|spoofEmitter|wrongChain|revertedTx|late|stealFromSteward|fireTheAgent|poisonReasoning} (SSE) · GET /status · GET /steward/log · POST /steward/explain` |

It shares the worker's configuration (`.env`, `KITTY_ENV_FILE` overlay) and reads two extra variables for `/status`: `KITTY_VIEWER_ADDRESS` and `FAKE_VAULT_ADDRESS`. Against the local world: `KITTY_ENV_FILE=worker/.env.world pnpm lab:api`.

## Routes

All JSON responses are `Content-Type: application/json`.

### `GET /scenarios`

Response `200`: `ScenarioMeta[]`, the `SCENARIOS` array from `worker/src/scenarios.ts` verbatim, in its declared order (`replay, spoofEmitter, wrongChain, revertedTx, stealFromSteward, fireTheAgent, poisonReasoning, late`).

```ts
interface ScenarioMeta { name: ScenarioName; title: string; expected: string; description: string }
```

### `GET /status`

Response `200`:

| Field | Type | Source |
|---|---|---|
| `mode` | `"testnet" \| "local"` | `cfg.mode` |
| `chainKey` | number | `cfg.chainKey` |
| `vault`, `ledger`, `token` | address | `cfg.vault`, `cfg.ledger`, `cfg.token` |
| `viewer` | address, only if `KITTY_VIEWER_ADDRESS` is set | |
| `fakeVault` | address, only if `FAKE_VAULT_ADDRESS` is set | |
| `sourceHead` | number | `sourceProvider.getBlockNumber()` |
| `ccHead` | number | `ccProvider.getBlockNumber()` |
| `attestedHeight` | number or `null` | `chainInfo.get_latest_attestation_height_and_hash(cfg.chainKey).height`; if that call fails, the mock's `attestedHeight(uint64)` at the same address (the local anvil's `MockChainInfo`); `null` if both fail |
| `running` | `ScenarioName` or `null` | the scenario currently streaming |

### `GET /steward/log`

Response `200`: `Decision[]`, `read(20)` from `worker/src/agent/log.ts`: the last 20 entries of `worker/<STEWARD_LOG_FILE>`, newest first, `[]` if the file is missing. Entry format in [`DATA_FORMATS.md`](DATA_FORMATS.md#steward-decision-log-workerstewardjson).

### `POST /steward/explain`

Request body: JSON `{ "question": string }`, optional. The body is read as text and parsed; a missing body, a missing `question`, a non-string or a blank string all resolve to the default question `What have you done recently, and why?`. A string is trimmed and cut to its first 500 characters. A body that is not valid JSON throws and returns `500`.

Response `200`: `Explanation` from `explain(question, fallback, { entries })` with `entries = read(12)` and `fallback = entries[0]?.summary ?? 'No decisions logged yet.'`:

```ts
interface Explanation {
  text: string;
  source: 'claude' | 'deterministic';
  verified: string[];
  stripped: { sentence: string; reason: string; value: string }[];
}
```

Without `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the API process's environment the answer is always `source: "deterministic"` with `text = fallback`. The key never leaves this process; the dashboard only ever sees the checked text. The full contract is in [`STEWARD.md`](STEWARD.md#the-explain-contract).

### `POST /run/:name`

`:name` must match `/^\/run\/([A-Za-z]+)$/` and be one of the eight scenario names. Response: `200 text/event-stream` (see below), or one of the JSON errors.

## The SSE stream

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

The stream is written by `send(event, data)` as `event: <name>\n` (omitted for the default event) followed by `data: <JSON>\n\n`:

| Order | Event | Data |
|---|---|---|
| 1 | `event: start` | `{ "name": "<scenario>", "expected": "<expected>" }` |
| 2..n | (default, no `event:` line) | `{ "line": "<log line>" }`, one per `log()` call during the run, each line prefixed `HH:MM:SS` |
| last | `event: done` | `ScenarioResult`: `{ "ok": boolean, "expected": string, "got": string, "skipped"?: true }` |

Every 15 s while the run is in progress the server writes the comment `: ping\n\n` to keep the connection open. Log lines reach the stream through `logSinks` in `worker/src/config.ts`: `runScenario` adds the stream's `send` as a sink for the duration of the run and removes it in `finally`, so lines logged by the worker modules the scenario calls (`proofs.ts`, `chain.ts`) appear too. If the client closes the connection, `open` becomes false and further writes are dropped; the scenario still runs to completion and `running` is cleared.

If `runScenario` itself throws (it catches scenario errors internally, so this is rare), the `done` event carries `{ ok: false, expected, got: "error: <message>" }`.

Example of the bytes on the wire for a `replay` run against the local world (lines from `web/public/lab-recorded.json`):

```
event: start
data: {"name":"replay","expected":"QueryAlreadyProcessed"}

data: {"line":"21:12:43 ── Replay a proven contribution · expecting QueryAlreadyProcessed"}

data: {"line":"21:12:43 replaying already-recorded contribution 0x41333ee0…0d5a6"}

data: {"line":"21:12:43 proof: height 48 · 1 continuity root(s) — identical query id"}

event: done
data: {"ok":true,"expected":"QueryAlreadyProcessed","got":"QueryAlreadyProcessed(0x8bf1b087…6d25d)"}
```

## Errors

| Status | Body | When |
|---|---|---|
| `404` | `{ "error": "unknown scenario <name>" }` | `POST /run/:name` with a name not in `SCENARIOS` |
| `409` | `{ "error": "a scenario is already running", "running": "<name>" }` | `POST /run/:name` while another run is streaming |
| `404` | `{ "error": "not found", "routes": ["GET /scenarios", "POST /run/:name", "GET /status", "GET /steward/log", "POST /steward/explain"] }` | any other method or path |
| `500` | `{ "error": "<message>" }` | an exception before headers were sent (an RPC failure in `/status`, a JSON parse error in `/steward/explain`); after headers are sent the response is simply ended |

## Scenario catalogue

`runScenario(name, emit)` in `worker/src/scenarios.ts` resolves the metadata, calls `contracts()`, adds `emit` to `logSinks`, logs `── <title> · expecting <expected>`, runs the scenario, logs `PASS|SKIP|FAIL <name> · expected <expected> · got <got>`, and returns `ScenarioResult`. An exception becomes `{ ok: false, expected, got: "error: <message>" }` and `FAIL <name> · error: <message>`.

Shared helpers:

- `currentCircle(ledger)`: the circle `SCENARIO_CIRCLE_ID` or `circleCount()` (throws `no circle on the ledger yet — run \`pnpm demo create\`` when there is none), with its current round and `deadlineHeight`.
- `firstRecordedTx()`: the first key of `state.recorded` in `worker/<WORKER_STATE_FILE>` (throws `nothing recorded yet — run \`pnpm worker --once\` first`).
- `expectRevert(ledger, proof, expected)`: `submitRecordContributions`; if it succeeds the result is `{ ok: false, got: "ACCEPTED (cc tx <hash>)" }` and the line `✗ ledger accepted the proof — this must never happen`; if it reverts, `got = revertReason(e, ledger.interface)` and `ok = got.startsWith(expected)`, logged as `✓|✗ KittyLedger reverted: <got>`.
- `waitMined(txHash)`: `waitForTransaction` that returns the receipt even for status 0.
- Member keys come from `memberWallets(n)` in `worker/src/members.ts` (anvil accounts 1..n locally, `worker/demo-members.local.json` on testnet).

The catalogue, in `SCENARIOS` order. "Ledger check" refers to the numbered checks in [`../TECH.md`](../TECH.md#how-a-sepolia-payment-becomes-creditcoin-state).

### `replay`: Replay a proven contribution

- **expected**: `QueryAlreadyProcessed`
- **description**: Re-submits the batch proof of a contribution the ledger already counted. Query id (chainKey ‖ height ‖ txIndex) is marked processed.
- **steps**: take `firstRecordedTx()`; log `replaying already-recorded contribution <tx>`; `buildBatchProof([tx])`; log `proof: height <h> · <n> continuity root(s) — identical query id`; `expectRevert`.
- **ledger check**: step 0, the batch prologue: the query id `keccak256(chainKey ‖ height ‖ calculateTxIndex(merkleProof))` is already in `processedQueries`, so `_prepareBatch` reverts `QueryAlreadyProcessed(queryId)` before the precompile is called.
- **recorded result**: `QueryAlreadyProcessed(0x35e1f248…c6204)` on testnet.

### `spoofEmitter`: Spoofed emitter

- **expected**: `WrongEmitter`
- **description**: A look-alike contract on Sepolia emits a byte-identical Contributed event. The log address is bound to the registered vault.
- **steps**: requires `FAKE_VAULT_ADDRESS`, otherwise `{ ok: false, skipped: true, got: "skipped: FAKE_VAULT_ADDRESS not set" }`. With the operator key, call `FakeVault.emitContributed(circleId, round, members[0], contribution)` (log `FakeVault <addr> emits Contributed(circle <id>, round <r>, <member>, <amount> tUSD)`), wait for it (`mined in source block <n> · tx <hash> · building proof of the spoofed event…`), build a genuine proof of that transaction, `expectRevert`.
- **ledger check**: check 4: the only `Contributed` log comes from an address not in `trustedVault[chainKey]`, so `_rejectEmitter` reverts `WrongEmitter(logs[0].address_, address(0))`. (Check 11, the circle's own vault, and check 12, `to == sourceVault`, would also fail.)
- **recorded result**: `WrongEmitter(0xf6F984C6…cF1fb, 0x0000000000000000000000000000000000000000)` on testnet.

### `wrongChain`: Wrong chain key

- **expected**: `WrongChain, or the precompile rejects the continuity proof`
- **description**: Each circle stores its own chain key, validated against get_chain_by_key. Under another key the live 0x0FD2 rejects the continuity proof itself; if a proof ever got past it, the ledger reverts WrongChain(got, want).
- **steps**: `buildBatchProof([firstRecordedTx()])`, replace `chainKey` with `3` (log `submitting proof of <tx> with chainKey 3 instead of <chainKey>`), `expectRevert(…, 'WrongChain')`. If the revert instead starts with `Error(Continuity proof does not match`, the scenario logs `  the live 0x0FD2 rejected the forged chain key before KittyLedger's WrongChain check could run` and marks itself `ok`.
- **ledger check**: against the live precompile, step 1: `verifyAndEmit` reverts because the continuity proof does not match chain key 3's attestations. Against the mock (which accepts everything), check 8: `chainKey != c.chainKey` reverts `WrongChain(3, 1)`.
- **recorded results**: `Error(Continuity proof does not match attestation or checkpoint)` on testnet; `WrongChain(3, 1)` locally.

### `revertedTx`: Reverted source transaction

- **expected**: `SourceTxFailed`
- **description**: A contribute() call that mined but reverted (no allowance). Inclusion is proven, receipt status 0 is rejected.
- **steps**: locally, anvil account 4; on testnet a fresh random wallet funded from the operator with `200_000 * maxFeePerGas * 2` wei (log `funding fresh wallet <addr> with <eth> ETH from <operator>`). The wallet, which has no token allowance, calls `KittyVault.contribute(circleId, round, contribution)` with `gasLimit 200000` (log `<addr> (zero tUSD allowance) calls contribute(<id>, <r>, <amount> tUSD) with gasLimit 200000`). `waitMined`; if `status !== 0` the result is `source tx unexpectedly succeeded (status <s>)`. Otherwise build the proof (`inclusion proof built for the reverted tx — submitting…`) and `expectRevert`.
- **ledger check**: check 2: `decodeReceiptFields(encodedTx).receiptStatus == 1` fails, `SourceTxFailed()`.
- **recorded result**: `SourceTxFailed()`.

### `stealFromSteward`: Steal the steward's key

- **expected**: `every privileged call reverts`
- **description**: Takes a fresh key with the steward's on-ledger powers and tries to move a pot, trust a vault, close a round early and bind a circle to its own vault. The steward has no ledger role, so its key is worth nothing.
- **steps**: a random `thief` wallet is funded with `0.01` ETH on the source chain and `0.5` tCTC on Creditcoin (log `stolen key <addr> — funding it with gas on both chains so nothing fails for the wrong reason`). Four attempts, each logged `✓ <what> → <revertReason>` or `✗ <what> — SUCCEEDED, which must never happen`:
  1. `KittyVault.payout(circleId, 0, thief, 1)`
  2. `KittyLedger.setTrustedVault(chainKey, thief, true)`
  3. `KittyLedger.closeRound(circleId)`
  4. `KittyLedger.createCircle('stolen', members, contribution, roundBlocks, startHeight, thief)`
- **rejections**: `NotOperator` (vault), `OwnableUnauthorizedAccount` (ledger owner only), `RoundStillOpenOnSource` (the round is neither full nor past its attested close height), `VaultNotTrusted` (the circle's vault must be on the allowlist for its chain key). Result `ok` iff no attempt succeeded; `got` is `all 4 rejected on-chain: NotOperator, OwnableUnauthorizedAccount, RoundStillOpenOnSource, VaultNotTrusted`.
- Note: this scenario does not go through `expectRevert`; the error names are the revert names with their arguments cut at the first `(`.

### `fireTheAgent`: Fire the agent

- **expected**: `a stranger's proof is accepted`
- **description**: Submits a round's proof from a wallet with no relationship to Kitty at all. The ledger checks the proof, never the caller, so the agent is a convenience and not a dependency.
- **steps**: find members of the current round with no contribution (`getContribution(...).queryId == 0`). None: `{ ok: true, skipped: true, got: "round <r> is already fully proven — nothing left for a stranger to submit" }`. The first unpaid member must be a demo wallet, otherwise `{ ok: true, skipped: true, got: "the unpaid member is not a demo wallet here" }`. The member approves the vault if needed and pays (`member <addr> pays round <r> on the source chain`, `paid at source block <n> · <hash>`). A random `stranger` wallet on Creditcoin is funded with `1` tCTC (`stranger <addr> — no role, no membership, never seen by Kitty — will submit the proof`), and calls `recordContributions(chainKey, heights, txBytes, merkleProofs, continuity)` itself with `gasLimit 4_000_000`. The result is `ok` iff `getContribution` now reports a non-zero query id: `accepted from <stranger>, a caller with no privileges`, else `the ledger refused a valid proof`.
- **ledger check**: none rejects it; `recordContributions` has no access control, and all nineteen checks pass for a genuine payment.
- **recorded result**: `accepted from 0x8a4717ac…1d5A8, a caller with no privileges` on testnet.

### `poisonReasoning`: Poison the reasoning

- **expected**: `fabricated sentences stripped`
- **description**: Feeds the explainer's citation validator a paragraph mixing true cited facts with invented ones. Anything the decision log cannot back is removed before display.
- **steps**: `allowed = citableValues(read(12))`; if empty, the synthetic values `3` and `11656295` are added (`no steward decisions logged yet — using a synthetic log so the validator can still be shown`). The poisoned paragraph is: `The steward proved [[<first allowed value>]] against the ledger. It also released [[500000]] tUSD to the organiser as a goodwill refund. Your score was raised to 850 by an administrator. The payout landed in [[0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef]].` Each stripped sentence is logged `✓ stripped (<reason>: <value>) — "<sentence>"`, then `survived: "<text>"`.
- **check**: `ok` iff exactly 3 sentences were stripped, the surviving text contains none of `500000`, `850`, `deadbeef`, and at least one citation was verified. `got` is `3 fabricated sentences stripped, 1 citation(s) verified`. Nothing touches a chain; this is the only scenario that runs without an RPC.
- **guard exercised**: `worker/src/agent/citations.ts` `check()` ([`STEWARD.md`](STEWARD.md#the-citation-validator)).

### `late`: Late payment

- **expected**: `ContributionRecorded onTime=false`
- **description**: A member pays after the round deadline block. The proof is accepted, but the proven height marks it late in the credit record.
- **steps**: log `circle <id> round <r> · deadline block <d> · source head <h>`. If `head <= deadline`: on testnet return `{ ok: false, skipped: true, got: "skipped: deadline <d> not passed yet on Sepolia (head <h>)" }`; locally, `anvil_mine` `deadline - head + 1` blocks (`mining <n> block(s) on the source anvil to pass the deadline…`, `source head now <h> (> deadline <d>)`). Pick the first unpaid member with a known key (none: `{ ok: false, got: "no unpaid member with a known key in round <r> — run \`pnpm worker --once\` to close it" }`), approve if needed, `contribute` (`<addr> contributed at source block <n> (deadline <d>) · tx <hash>`), build the proof and `submitRecordContributions` directly. The receipt's logs are parsed for `ContributionRecorded`; `got` is `ContributionRecorded onTime=<bool> (height <h>, deadline <d>)` and `ok = !onTime`. No event: `accepted (cc tx <hash>) but no ContributionRecorded event found`. A revert: `ok: false` with the reason.
- **ledger check**: none rejects it; step 3 records `onTime = height <= deadlineHeight(circleId, round)` as `false` and increments `rec.late`. Note that `late` can only be accepted while the round is still `Open`, that is, before `closeHeight = deadline + 64` is attested and `closeRound` has run (check 18, `RoundNotOpen`).
- **recorded result**: `ContributionRecorded onTime=false (height 11686934, deadline 11686925)` on testnet.

## Running scenarios from the command line

`pnpm scenario <name>… | --all` runs `worker/src/scenarios.ts` as a script against whatever `.env` (and `KITTY_ENV_FILE`) points at, prints the log to stdout and exits with the number of failures (`SKIP` counts as a failure unless the scenario returned `ok: true`, as `fireTheAgent` does when nothing is left to submit). With no names it prints the usage and the catalogue and exits 1.

`pnpm scenarios` (`scripts/scenarios.sh`) brings up the two-anvil world, proves one round, then runs the eight scenarios in the order `replay wrongChain revertedTx late spoofEmitter stealFromSteward fireTheAgent poisonReasoning`, moving the mocked `0x0FD3` frontier to the source head before each, and exits with the failure count. CI runs it on every push (`.github/workflows/ci.yml`). `pnpm judge` (`scripts/judge.sh`) includes it as step 3 of 5. `worker/src/attack.ts` (`pnpm -s tsx worker/src/attack.ts`, used by `scripts/local-e2e.sh`) runs only `replay` and exits 2 on failure.

## The recorder: `pnpm lab:record`

`worker/src/record-lab.ts` runs every scenario against the current world and writes one JSON file so the hosted `/lab` page can replay real runs without an API.

| Input | Meaning |
|---|---|
| `LAB_RECORD_OUT` | Output path relative to the repository root; default `web/public/lab-recorded.json`. |
| `LAB_ONLY` | Comma-separated scenario names to rerun. The other scenarios are copied from the existing output file (if it exists) so a slow testnet subset can be refreshed without rerunning everything. |
| `KITTY_MODE` | `local`: before each scenario the recorder calls `MockChainInfo.setAttestedHeight(chainKey, sourceHead)` on `0x…0fD3` with the operator key, because nothing else moves the mocked frontier. Unset (testnet): the attestor network is the clock and every proof waits an attestation lag. |
| `WORKER_STATE_FILE` | Needed by `replay` and `wrongChain` (`firstRecordedTx`); on testnet the worker's own state file, for example `state.testnet.json`. |
| `SCENARIO_CIRCLE_ID`, `FAKE_VAULT_ADDRESS` | As for the scenarios themselves. |

Behaviour:

1. Scenarios run in the fixed order `replay, wrongChain, revertedTx, late, spoofEmitter, stealFromSteward, fireTheAgent, poisonReasoning` (not the `SCENARIOS` declaration order), each printing `PASS <name>` or `FAIL <name>`.
2. Every log line is captured into `lines`; the record is `{ name, title, expected, description, lines, ok, got, skipped? }`.
3. The file is `{ commit, date, mode, chainId, results }` with `commit = git rev-parse HEAD`, `date` now, `mode = cfg.mode`, `chainId = 102031` unless local (then omitted), written with one-space indentation ([`DATA_FORMATS.md`](DATA_FORMATS.md#lab-recordings)).
4. `wrote <path> · <n> scenarios, <failed> failed · commit <first 10 chars>` and exit code 1 if any result is not `ok`, so a broken recording never ships.

Testnet mode as documented in the source: `KITTY_MODE` unset, a funded `PRIVATE_KEY`, and the steward stopped so it does not race the scenarios for the same payments:

```bash
LAB_RECORD_OUT=web/public/lab-testnet.json WORKER_STATE_FILE=state.testnet.json pnpm -s lab:record
LAB_ONLY=late,fireTheAgent LAB_RECORD_OUT=web/public/lab-testnet.json WORKER_STATE_FILE=state.testnet.json pnpm -s lab:record
```

`late` reports `skipped` until the current round's deadline has passed on Sepolia, which is why the subset rerun exists. `scripts/local-lab.sh` runs the local recording and then keeps `pnpm lab:api` in the foreground.

## How the Lab page consumes the API and the recordings

`web/src/pages/Lab.tsx`, with `cfg.labApi` from `VITE_LAB_API` (`http://localhost:8790` in `pnpm web:dev`, empty in production builds).

Live mode (`cfg.labApi` set and reachable):

1. On mount, `GET /scenarios` replaces the page's built-in `FALLBACK` list (a copy of `SCENARIOS`, same order, descriptions verbatim), and `GET /status` fills the header (`mode <mode> · source head <n> · attested <n|n/a>`).
2. A "Run" button issues `POST /run/<name>` with `fetch` and reads the body with a `ReadableStream` reader, splitting on blank lines: a chunk with `event: done` sets the verdict from its `data`, any chunk whose `data.line` is defined appends a log line. `409` shows `another scenario is still running — wait for it to finish`; a network failure appends `lab api unreachable at <url> — start it with \`pnpm lab:api\``.
3. Hashes in log lines become explorer links (`linkify`) only when the run is on the testnets (`status.mode !== 'local'`), and only for 64-hex values preceded by `tx`; a value preceded by `cc tx` or a recent `creditcoin` links to the Creditcoin explorer, otherwise to Sepolia's.

Offline mode (`cfg.labApi` empty, or `/scenarios` failed):

1. `fetch(BASE_URL + 'lab-testnet.json')`, falling back to `lab-recorded.json`.
2. The recording's `results` replace the scenario list, `lines` fill each log panel, `{ ok, expected, got, skipped }` fill each verdict, and the header shows `recorded on Sepolia + CC3 Testnet · <date> · <commit>` when `mode === 'testnet'` or `recorded run · <date> · <commit>` otherwise.
3. Run buttons are disabled (`run()` returns immediately when `cfg.labApi` is empty).
4. If neither file loads, the `FALLBACK` list is shown with the per-scenario `WHY` explanations and no verdicts.

The Steward page (`web/src/pages/Steward.tsx`) follows the same pattern with `GET /steward/log` and `POST /steward/explain`, falling back to `web/src/data/steward.sample.json` and `steward.explain.sample.json`, and adds explorer links only when the mode reported by `/status` or by the sample file is not `local`.
