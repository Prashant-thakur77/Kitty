# Kitty Operations Runbook

How to deploy, seed, run and recover Kitty on Ethereum Sepolia and Creditcoin CC3 Testnet, and how to bring up the local two-anvil world. Every command, flag, file and environment variable below is taken from `package.json`, `scripts/*.sh`, `worker/src/*.ts` and `.github/workflows/*.yml`.

## Contents

- [Prerequisites](#prerequisites)
- [Environment files and keys](#environment-files-and-keys)
- [Deploying: `scripts/deploy.sh`](#deploying-scriptsdeploysh)
- [Seeding: `pnpm demo`](#seeding-pnpm-demo)
- [The worker: `pnpm worker`](#the-worker-pnpm-worker)
- [The lab API: `pnpm lab:api`](#the-lab-api-pnpm-labapi)
- [Recording the lab: `pnpm lab:record`](#recording-the-lab-pnpm-labrecord)
- [Logging transactions: `pnpm txlog`](#logging-transactions-pnpm-txlog)
- [Other commands](#other-commands)
- [Recovery procedures](#recovery-procedures)
- [Local world scripts](#local-world-scripts)
- [CI](#ci)
- [GitHub Pages](#github-pages)

## Prerequisites

| Requirement | Used by |
|---|---|
| Foundry (`forge`, `cast`, `anvil`) | contracts, tests, `deploy.sh`, every local script |
| Node 22 and pnpm (`packageManager: pnpm@10.32.1`) | worker, web, scripts |
| `pnpm install` at the root and `pnpm --dir web install` | worker dependencies (`@gluwa/usc-sdk@0.18.0`, `@gluwa/asc-contracts@0.2.1`, `ethers@6`, `@anthropic-ai/sdk`, `tsx`, `playwright`) and the dashboard |
| A funded deployer key | Sepolia ETH (faucet: Alchemy) and tCTC (Creditcoin Discord `#token-faucet`, `/faucet address:0x…`). `docs/DEMO_RUNBOOK.md` suggests at least 0.03 ETH and 0.01 tCTC before a demo. |
| Internet | Proof Builder `https://prover.cc3-testnet.creditcoin.network`, RPCs |
| Docker | not needed |

`scripts/watch-funding.sh` polls the deployer's tCTC balance once a minute and prints `FUNDED` when it exceeds 0.002.

## Environment files and keys

### Root `.env` (loaded by `worker/src/config.ts` via dotenv; `.env.example` is the template)

| Key | Default | Meaning |
|---|---|---|
| `DEPLOYER_ADDRESS` | none | Informational; used by the demo runbook's `cast balance` lines. |
| `PRIVATE_KEY` | empty | Deployer, ledger owner, vault operator and steward key. Must be a 32-byte hex string or it is treated as absent. Required for `deploy.sh`, `pnpm demo`, `pnpm worker`, `pnpm scenarios`, `pnpm lab:api`, `pnpm receipts`; read-only commands (`verify:live`, `explain`, `test:agent`) run without it. |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Source chain RPC. |
| `CREDITCOIN_RPC_URL` | `https://rpc.cc3-testnet.creditcoin.network` | Creditcoin RPC. |
| `PROOF_BUILDER_URL` | `https://prover.cc3-testnet.creditcoin.network` | Attestcoin Proof Builder. |
| `SOURCE_CHAIN_KEY` | `1` | Sepolia on CC3 Testnet. Passed to the ledger constructor and to `setTrustedVault`. |
| `EVM_V1_DECODER_LIBRARY_ADDRESS` | set in `.env.example` | Present in the template; not read by any script or source file in this repository (`EvmV1Decoder` is an internal library compiled into the ledger). |
| `KITTY_VAULT_ADDRESS`, `KITTY_LEDGER_ADDRESS`, `TEST_USD_ADDRESS` | filled by `deploy.sh` | Required by `contracts()` in `config.ts`, hence by every signing command. |
| `FAKE_VAULT_ADDRESS`, `KITTY_VIEWER_ADDRESS`, `KITTY_USD_ADDRESS`, `KITTY_CREDIT_ADDRESS`, `KITTY_BADGE_ADDRESS`, `LEDGER_DEPLOY_BLOCK` | filled by `deploy.sh` | `FAKE_VAULT_ADDRESS` enables the `spoofEmitter` scenario; `LEDGER_DEPLOY_BLOCK` bounds `pnpm receipts`' event scan; the viewer and fake vault are reported by the lab API `/status`. |
| `OPERATOR_ADDRESS` | deployer | Read by `deploy.sh` and `script/DeploySepolia.s.sol` for the vault's operator. |
| `STEWARD_LOG_FILE` | `steward.local.json` | Decision-log file name under `worker/`. |

### Worker runtime variables (environment, or `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `KITTY_MODE` | `testnet` | `local` switches proofs to the SDK's `abiEncode` with placeholder Merkle and continuity data for the mocked precompiles, and sets a 6,000,000 gas limit. |
| `KITTY_ENV_FILE` | none | A second env file loaded after `.env` with `override: true`. `scripts/local-world.sh` writes `worker/.env.world` for this purpose. |
| `WORKER_POLL_MS` | `10000` | Tick interval. |
| `WORKER_BATCH_WAIT_MS` | `45000` | The batching timer (`waited` reason). |
| `WORKER_FROM_BLOCK` | none | First source block to scan on a fresh state file; otherwise `head - 200`. |
| `WORKER_STATE_FILE` | `state.local.json` | State file name under `worker/`. |
| `WORKER_DEBUG` | unset | `1` logs the first raw batch-proof response. |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` | none | Enables layer 3 (`pnpm explain`, `POST /steward/explain`). Without it the deterministic sentence is used. |
| `PORT` | `8790` | Lab API port. |
| `SCENARIO_CIRCLE_ID` | latest circle | Which circle the scenarios target. |
| `LAB_RECORD_OUT` | `web/public/lab-recorded.json` | Output of `pnpm lab:record`. |
| `LAB_ONLY` | all | Comma list of scenario names to rerun and merge into an existing recording. |

### Web env

`web/.env.example` lists the `VITE_*` keys. `deploy.sh` writes `web/.env` and the committed `web/.env.production`; `scripts/local-setup.sh` writes `web/.env.local`, which Vite prefers in dev and which points the dashboard at the anvils and at `VITE_LAB_API=http://localhost:8790`. Delete `web/.env.local` to point the dev server back at the testnets. `VITE_LAB_API` is empty in production builds, so the hosted pages never call a lab API. `VITE_PROOF_BUILDER_URL`, `VITE_SEPOLIA_EXPLORER`, `VITE_CREDITCOIN_EXPLORER` and `VITE_REPO_URL` have defaults in `web/src/config.ts` and `web/src/lib/prover.ts`.

### Files that must never be committed

`.gitignore` excludes `.env` and every `.env.*` except `.env.example` and `web/.env.production`, `worker/state*.json`, `worker/steward*.json`, `worker/demo-members.local.json`, `deployments.local.json`. `worker/demo-members.local.json` holds the demo members' private keys on testnet.

## Deploying: `scripts/deploy.sh`

```bash
cp .env.example .env      # set PRIVATE_KEY
scripts/deploy.sh
```

What it does, in order:

1. Sources `.env`, prints the deployer and both balances.
2. Sepolia, with `forge create --broadcast`: `TestUSD`, `KittyVault(TEST_USD_ADDRESS, OPERATOR_ADDRESS or deployer)`, `FakeVault`.
3. Creditcoin, with `forge create --broadcast --legacy` (`forge script` cannot simulate Creditcoin headers): `KittyLedger(SOURCE_CHAIN_KEY)`, then records `LEDGER_DEPLOY_BLOCK`.
4. `setTrustedVault(uint64,address,bool)(SOURCE_CHAIN_KEY, KITTY_VAULT_ADDRESS, true)` on the ledger if `trustedVault` is not already true.
5. `KittyViewer(ledger)`, `KittyUSD`, `KittyCreditLine(ledger, kUSD)`; on a fresh credit line it mints 100,000 kUSD to the deployer, approves 50,000 and deposits 50,000 into the pool; `KittyBadge(ledger)`.
6. Writes every `VITE_*` address plus `VITE_LEDGER_DEPLOY_BLOCK` and `VITE_SOURCE_CHAIN_KEY` to `web/.env` and `web/.env.production`, and rewrites `deployments.json`.

Idempotence: every captured address is written to `.env` immediately (`persist`), and any contract whose key is already set in `.env` is skipped (`have`). A failed run can be rerun and continues where it stopped. The trust step is guarded by a `cast call` so it does not resend.

`FORCE_REDEPLOY` is a comma list of `usd,vault,fake,ledger,viewer,kusd,credit,badge`. Redeploying the ledger forces a new vault: the script appends `vault` to the list and prints `ledger redeploy implies a fresh vault`, because a vault marks payouts per `(circleId, round)` and a new ledger reuses circle ids ([ADR 0005](adr/0005-one-vault-per-ledger.md)). After a ledger redeploy, `KittyViewer`, `KittyCreditLine` and `KittyBadge` still point at the old ledger unless forced too (their `LEDGER` is immutable); the three addresses in `deployments.json` all report `LEDGER() == 0xC2A1…F276`, the final ledger.

After deploying, commit `web/.env.production` and `deployments.json` so the hosted dashboard follows.

`script/DeploySepolia.s.sol`, `script/DeployCreditcoin.s.sol` and `script/DeployFakeVault.s.sol` are `forge script` equivalents; the Creditcoin one is documented as not simulating on CC3 and is kept for reference.

## Seeding: `pnpm demo`

`worker/src/demo.ts`. Requires `PRIVATE_KEY` and the three core addresses.

| Command | Effect |
|---|---|
| `pnpm demo fund [--members N] [--eth E]` | Testnet: sends `E` ETH (default 0.004; 0 in local mode) and mints 1,000 tUSD to each demo member. Member keys are generated into `worker/demo-members.local.json` on first use (local mode uses anvil accounts 1..N). |
| `pnpm demo create [--name "Lagos Susu #1"] [--members 3] [--amount 100] [--round-blocks 60] [--rotation fixed\|score]` | `createCircle` with `startHeight = source head + 1`; `--rotation score` follows with `setRotation(id, ByScore)`. Default round length is 60 blocks on testnet and 40 locally. Prints the members and round 0's deadline. |
| `pnpm demo contribute [--circle ID] [--skip i,j]` | Each demo member (except the skipped indices) approves the vault once and calls `contribute(circleId, currentRound, contribution)` on the source chain. Defaults to the latest circle. |
| `pnpm demo status` | Prints every circle, round, member status (pending, MISSED, on time @height, LATE @height) and score from Creditcoin, plus the source head and the latest attested height. |

Circles with invites are not created by the demo driver; `createOpenCircle`, `redeemInvite` and `closeInvites` are exercised by `test/KittyInvites.t.sol` and can be driven with `cast send`.

## The worker: `pnpm worker`

`worker/src/worker.ts`. One flag: `--once` runs a single tick, then a second tick so a round that is already attested can close and pay in the same pass, and exits. Without it the loop runs every `WORKER_POLL_MS` until Ctrl-C (a second Ctrl-C aborts immediately).

Each tick:

1. `scanSource`: `Contributed` events from the vault in 50-block windows (`MAX_LOG_RANGE`), grouped by `circleId:round`. `lastSourceBlock` never advances past the oldest pending payment, so a restart rescans it.
2. `flushBatches`: validates every pending payment against the ledger (unknown circle, completed circle or past round: quarantined as recorded; future round or open invites: left for later; pre-start height, non-member, wrong amount, duplicate, already proven: quarantined), builds candidates with `deadlineHeight` and `closeHeight`, calls `decideBatch`, records a `wait` or proceeds: `buildBatchProof` (waits for attestation with `waitUntilHeightAttested(chainKey, maxHeight, 15 s poll, 20 min timeout)`, then `getBatchProof`, falling back to single proofs merged with `mergeProofs`), `preflight` against the view `verify`, `submitRecordContributions` (`staticCall`, gas floor 1,500,000, send). Records `prove`, `skip` or `error`.
3. `closeRounds`: for every active circle with a closed invite list, `closeRound` when the round is full or `is_height_attested(chainKey, closeHeight)`. Records `close`.
4. `payouts`: for every `Closed` round with a recipient and a non-zero pot, `KittyVault.payout` on Sepolia unless `state.paid[key]` exists, then `buildSingleProof`, `preflight`, `submitConfirmPayout`. Records `payout` and `confirm`.
5. `saveState`.

State file (`worker/<WORKER_STATE_FILE>`, JSON): `lastSourceBlock`, `recorded` (source tx hash to true), `paid` (`circleId:round` to payout tx hash), `confirmed` (payout tx hash to true).

Decision log (`worker/<STEWARD_LOG_FILE>`, JSON array, last 500 entries): `{at, kind, summary, evidence, txs}` with `kind` in `prove | wait | close | payout | confirm | skip | error`. Read by `pnpm explain`, the lab API and `/steward`.

Log lines are ISO-time-prefixed and also fanned out to `logSinks` (the lab API's SSE stream). Every tick starts by calling `reset()` on both `NonceManager`s, so a nonce consumed outside the process (a seeding script, a redeploy) cannot collide, and the worker resets the relevant signer again after any failed send.

Run the worker with a dedicated state and log file per world to keep histories apart, for example `WORKER_STATE_FILE=state.testnet.json STEWARD_LOG_FILE=steward.testnet.json pnpm worker`. Run one worker per ledger; two workers on one ledger race for the same payments.

## The lab API: `pnpm lab:api`

`worker/src/api.ts`, port `PORT` (default 8790), CORS `*`, no authentication. It holds the operator key, so it is local-only; never expose the port and never set `VITE_LAB_API` to a public host.

| Route | Response |
|---|---|
| `GET /scenarios` | `ScenarioMeta[]` (name, title, expected, description) from `worker/src/scenarios.ts` |
| `POST /run/:name` | `text/event-stream`: `event: start` with `{name, expected}`, then one `{"line": …}` per log line, then `event: done` with `{ok, expected, got, skipped?}`. `409 {"error": "a scenario is already running"}` while another run is in progress. A `: ping` comment every 15 s. |
| `GET /status` | `{mode, chainKey, vault, ledger, token, viewer?, fakeVault?, sourceHead, ccHead, attestedHeight | null, running}`. `attestedHeight` comes from `get_latest_attestation_height_and_hash`, falling back to the mock's `attestedHeight(uint64)` on a local anvil. |
| `GET /steward/log` | The last 20 decisions, newest first. |
| `POST /steward/explain` `{question}` | `Explanation {text, source, verified, stripped}`; the question is trimmed to 500 characters; the last 12 decisions are the facts. |

Anything else returns 404 with the route list. Against a local world start it with `KITTY_ENV_FILE=worker/.env.world pnpm lab:api`.

## Recording the lab: `pnpm lab:record`

`worker/src/record-lab.ts` runs every scenario in the order `replay, wrongChain, revertedTx, late, spoofEmitter, stealFromSteward, fireTheAgent, poisonReasoning`, collects the log lines and verdicts, and writes `{commit, date, mode, chainId, results}` to `LAB_RECORD_OUT` (default `web/public/lab-recorded.json`). It exits 1 if any scenario failed so a broken recording never ships. In local mode it first moves the mocked `0x0FD3` frontier to the source head before each scenario.

Testnet mode (`KITTY_MODE` unset, funded `PRIVATE_KEY`, the steward stopped so it does not race the scenarios for the same payments):

```bash
LAB_RECORD_OUT=web/public/lab-testnet.json WORKER_STATE_FILE=state.testnet.json pnpm -s lab:record
```

Each proof waits an attestation lag. `late` only runs once the current round's deadline has passed on Sepolia; until then it reports `skipped`. Rerun a subset and merge it into the existing file with `LAB_ONLY=late,fireTheAgent`. The hosted `/lab` prefers `lab-testnet.json` over `lab-recorded.json` and labels the run with its mode, date and commit.

## Logging transactions: `pnpm txlog`

```bash
pnpm txlog <sepolia|creditcoin> <0xtxhash> "<action>"
```

`worker/src/txlog.ts` fetches the receipt, and inserts a row `| date | chain | action | link | gasUsed |` at the end of the main five-column table in `docs/TESTNET_LOG.md` (not at end of file, where later three-column tables would swallow the cells). A reverted transaction gets ` (reverted)` appended to the action.

## Other commands

| Command | What it does |
|---|---|
| `forge test` | 107 tests in 11 suites, precompiles mocked with `vm.etch`. |
| `pnpm test:agent` | 29 Node tests: `worker/test/policy.test.ts` (17) and `worker/test/citations.test.ts` (12). No network, no `.env`. |
| `pnpm typecheck` | `tsc -p worker/tsconfig.json`. |
| `pnpm scenario <name>… \| --all` | Runs scenarios against whatever `.env` points at and prints PASS/FAIL. |
| `pnpm scenarios` | `scripts/scenarios.sh`: two anvils, one proven round, all eight scenarios, exits with the failure count. |
| `pnpm e2e:local` | `scripts/local-e2e.sh`: two full rounds, a miss, a payout proven back, a replay rejected, a credit-line check. |
| `pnpm e2e:lab` | `scripts/local-lab.sh`: local world, recorded lab, then the lab API in the foreground. |
| `pnpm judge` | `scripts/judge.sh`: forge, agent tests, scenarios, e2e, then `verify:live` on three real Sepolia transactions against the live `0x0FD2`. |
| `pnpm verify:live <tx> [<tx>…]` | Real proof to the live precompile; single mode adds tampered-bytes and wrong-chain negatives; more than one hash uses the batch endpoint. |
| `pnpm receipts <address> [out.json]` | A member's proof bundle from ledger events; scans from `LEDGER_DEPLOY_BLOCK` or the last 50,000 Creditcoin blocks. |
| `pnpm explain ["question"]` | Layer 3 over the last 12 decisions, or the deterministic sentence. |
| `pnpm web:dev`, `pnpm web:build` | Dashboard dev server on 5173 and production build. |

## Recovery procedures

### A payout was sent but the worker lost the hash

Symptom: the worker logs `round <circleId>:<round> already paid on source but tx unknown — set worker/state paid[<circleId>:<round>] manually` every tick, and the round stays `Closed` on the ledger. This happens when `KittyVault.payout` mined but the process died before `state.paid` was written, or when the state file was reset. It happened on 12 September 2026 during the testnet campaign, and the procedure below is what the worker's own message asks for.

1. Find the payout on Sepolia: the `PaidOut(circleId, round, recipient, amount)` event on the vault, for example on Etherscan under the vault address, or `cast logs --rpc-url $SEPOLIA_RPC_URL --address $KITTY_VAULT_ADDRESS "PaidOut(uint256,uint32,address,uint256)"`.
2. Stop the worker.
3. Edit `worker/<WORKER_STATE_FILE>` and add the hash under `paid`:
   ```json
   "paid": { "1:0": "0x<payout tx hash>" }
   ```
4. Restart the worker. The next tick skips `payout`, builds the single proof for that hash, preflights it and calls `confirmPayout`; the round moves to `Paid` and `confirmed[hash]` is written.

Never call `payout` again for the same round: the vault reverts `AlreadyPaid`, and even if it did not, the ledger would refuse a second proof-back.

### RPC timeouts or `tick error`

The worker logs `tick error: <message>` and continues on the next poll. Nothing is lost: `lastSourceBlock` is pinned behind pending payments, and `recorded`, `paid` and `confirmed` are only written after the corresponding receipt. If a public Sepolia RPC keeps failing `eth_getLogs`, the 50-block windows are already the mitigation; switch `SEPOLIA_RPC_URL`. If a send fails with a nonce error, the worker has already called `reset()` on the signer; if it persists, restart the process.

### A batch keeps failing with a ledger error

The log shows `✗ batch failed: <Error(args)>` and the decision log records `error`. The worker's pre-validation quarantines the known causes (`ignoring … unknown circle`, `non-member`, `wrong-amount`, `duplicate`, `before the circle's start`). A cause it does not pre-validate (for example `CircleStillOpen` because invites were reopened, or `RoundNotOpen` because a stranger closed the round first) will repeat until the state changes; read the error, fix the state, and the next tick proceeds. A payment the ledger can never accept can be marked manually in `recorded` to drop it.

### Attestation appears stuck

`waiting: N payment(s) not yet attested (frontier at source block H)` repeats and `H` does not move. Check the Proof Builder directly: `curl $PROOF_BUILDER_URL/api/v1/attested-height/1`, and the precompile: `cast call --rpc-url $CREDITCOIN_RPC_URL 0x0000000000000000000000000000000000000fD3 "get_latest_attestation_height_and_hash(uint64)((uint64,bytes32,bool,bool))" 1`. If the frontier is genuinely stalled there is nothing to do but wait; the policy fires on `deadline-risk` as soon as attestation resumes, and `closeRound` cannot run against a member until `deadline + 64` is attested, so a stalled attestor cannot cause a miss. `waitUntilHeightAttested` gives up after 20 minutes and the tick errors; the next tick retries.

### The steward is down and a round needs to settle

Any wallet can finish it: on `/circle/:id` the Prove panel fetches the batch proof and submits `recordContributions` from the connected wallet, and `Close round on Creditcoin` appears when the round is full or the close height is attested. The payout leg still needs the operator key.

### A ledger redeploy

Use `FORCE_REDEPLOY=ledger scripts/deploy.sh` (which also deploys a fresh vault), then `FORCE_REDEPLOY=viewer,credit,badge` if those should follow the new ledger, then `pnpm demo fund` (members must approve the new vault; `demo contribute` does it), `pnpm demo create`, and a fresh `WORKER_STATE_FILE` and `STEWARD_LOG_FILE`. Do not reuse a state file across ledgers: its `recorded` map would hide payments the new ledger has never seen.

## Local world scripts

All of them source `scripts/local-setup.sh`, which starts two anvils (`--chain-id 11155111` on 8545, `--chain-id 102031` on 8546, 1-second blocks), deploys every contract with anvil account 0, trusts the vault for chain key 1, seeds the credit pool with 50,000 kUSD, etches `MockVerifier` at `0x…0FD2` and `MockChainInfo` at `0x…0fD3` with `anvil_setCode`, sets `setAccept(true)`, and writes `web/.env.local`. The mocked `0x0FD3` frontier is moved by hand with `setAttestedHeight(uint64,uint64)`; each script has an `attest` helper for it.

| Script | Purpose | Stays up |
|---|---|---|
| `scripts/local-world.sh` | Fund, create a 3-member by-score circle (`WORLD_ROUND_BLOCKS`, default 60), contribute, attest, `worker --once`; then unless `WORLD_ROUND1=0`, round 1 with member 2 missing. Writes `worker/.env.world`. | yes (`pkill -x anvil` to stop) |
| `scripts/local-e2e.sh` | Round 0, round 1 with a miss closed on the attested close height, the replay attack, a credit-line assertion. | no |
| `scripts/local-lab.sh` | One proven round, `pnpm lab:record`, then `pnpm lab:api` in the foreground. | while the API runs |
| `scripts/scenarios.sh` | One proven round, then every scenario; exits with the failure count. | no |

Run one local world at a time: every script kills any anvil on 8545 or 8546 first. To explore the dashboard against a world: `WORLD_ROUND1=0 scripts/local-world.sh`, `pnpm --dir web dev`, and `KITTY_ENV_FILE=worker/.env.world pnpm lab:api`.

## CI

`.github/workflows/ci.yml` on every push and pull request:

- `contracts` job: `pnpm install --frozen-lockfile`, `forge build --sizes`, `forge test -vv`, `pnpm typecheck`, `pnpm test:agent`, `pnpm scenarios` (two anvils in the runner, 20-minute timeout).
- `web` job: `pnpm install --frozen-lockfile` and `pnpm build` in `web/`.

## GitHub Pages

`.github/workflows/pages.yml` publishes `web/dist` to `https://prashant-thakur77.github.io/Kitty/` on pushes to `main` and on manual dispatch, built with `VITE_BASE=/Kitty/` and `index.html` copied to `404.html` for client-side routing. It is opt-in behind the repository variable `ENABLE_PAGES=true` and needs Settings, Pages, Source set to GitHub Actions and workflow permissions set to read and write. The hosted build reads `web/.env.production`, has no lab API, and serves `/lab` and `/steward` from the committed recordings (`web/public/lab-testnet.json`, `web/public/lab-recorded.json`, `web/src/data/steward.sample.json`, `web/src/data/steward.explain.sample.json`).
