# Kitty Steward: worker reference

The steward is the off-chain process in `worker/src/worker.ts` that watches `KittyVault.Contributed` on the source chain, proves payments to `KittyLedger` on Creditcoin, closes rounds, pays out on the source chain and proves the payout back. This document describes the process as the code implements it: every loop, rule, constant, log line, log entry and environment variable below is taken from `worker/src/*.ts` and `worker/src/agent/*.ts`.

What it does not repeat: the ledger's checks and the design rationale are in [`../TECH.md`](../TECH.md); the batch policy's history is in [`../adr/0003-batch-proofs-and-the-roundmate-hold.md`](../adr/0003-batch-proofs-and-the-roundmate-hold.md); the Attestcoin functions used are in [`../ATTESTCOIN_INTEGRATION.md`](../ATTESTCOIN_INTEGRATION.md); deployment, seeding and step-by-step recovery are in [`../OPERATIONS.md`](../OPERATIONS.md). File formats are in [`DATA_FORMATS.md`](DATA_FORMATS.md), the lab API in [`LAB_API.md`](LAB_API.md), the Telegram bot in [`BOT.md`](BOT.md).

## Contents

- [Process model](#process-model)
- [The tick loop](#the-tick-loop)
- [scanSource](#scansource)
- [The pending-payment model and quarantine](#the-pending-payment-model-and-quarantine)
- [The batch policy](#the-batch-policy)
- [Worked examples](#worked-examples)
- [Proof building](#proof-building)
- [Preflight and gas](#preflight-and-gas)
- [Submissions: recordContributions, closeRound, payout, confirmPayout, confirmPayouts](#submissions)
- [The decision log](#the-decision-log)
- [The citation validator](#the-citation-validator)
- [The explain contract](#the-explain-contract)
- [Recovery the code supports](#recovery-the-code-supports)
- [Environment variables](#environment-variables)

## Process model

`pnpm worker` runs `tsx worker/src/worker.ts` (`package.json`). The module graph, in import order, is `config.ts`, `proofs.ts`, `chain.ts`, `verifier.ts`, `agent/policy.ts`, `agent/log.ts`. The order matters once: `agent/log.ts` reads `STEWARD_LOG_FILE` at import time and deliberately does not import `config.ts`, so `config.ts` must have run dotenv first. `worker.ts` and `api.ts` both import `config.ts` before `agent/log.ts`.

`config.ts` at load time:

1. `ROOT` is resolved to the repository root (`path.resolve(import.meta.dirname, '../..')`).
2. `dotenv.config({ path: ROOT/.env })`, then, if `KITTY_ENV_FILE` is set, a second `dotenv.config` on that file with `override: true`. `scripts/local-world.sh` writes `worker/.env.world` for this.
3. `cfg` is built from the environment (table at the end of this document).
4. Two `ethers.JsonRpcProvider`s: `sourceProvider` (`cfg.sepoliaRpc`) and `ccProvider` (`cfg.creditcoinRpc`).
5. A signing key: `cfg.privateKey` if `PRIVATE_KEY` is a 32-byte hex string, otherwise a throwaway `ethers.Wallet.createRandom().privateKey`, so read-only entry points (`verify-live.ts`, `receipts.ts` up to `contracts()`) load with no `.env` at all. `sourceWallet` and `ccWallet` wrap the key; `sourceSigner` and `ccSigner` wrap those in `ethers.NonceManager`.
6. `chainInfo`: an `ethers.Contract` at `CHAIN_INFO_PRECOMPILE = '0x0000000000000000000000000000000000000fD3'` with the two functions the worker uses, `is_height_attested(uint64,uint64)` and `get_latest_attestation_height_and_hash(uint64)`.

`contracts()` is the gate for anything that signs. It throws `Set PRIVATE_KEY in .env (see .env.example); needed for deploy, demo, worker and scenarios` when the key is empty and `Set KITTY_VAULT_ADDRESS, KITTY_LEDGER_ADDRESS, TEST_USD_ADDRESS in .env (run scripts/deploy.sh)` when any address is missing, and otherwise returns `{ vault, ledger, token }` bound to `sourceSigner`, `ccSigner`, `sourceSigner` respectively. The worker calls it at module top level, so a misconfigured worker exits before the first tick.

Logging: `log(...)` prefixes each line with the UTC time `HH:MM:SS` (`new Date().toISOString().slice(11, 19)`), prints it, and fans it out to every function in `logSinks`. The lab API adds a sink per SSE stream; nothing else does.

Startup (`main()`): both networks are queried with `getNetwork()` and two lines are printed:

```
kitty worker · mode=<mode> · source chainId <id> (chainKey <key>) → creditcoin chainId <id>
vault <address> · ledger <address> · operator <ccWallet.address>
```

Signals: the first `SIGINT` sets `stop = true` and logs `stopping after this tick (Ctrl-C again to abort now)`; a second `SIGINT` calls `process.exit(130)`. On exit the worker logs `worker stopped`. An unhandled error in `main()` prints the error and exits 1.

## The tick loop

```
do {
  try { await tick(); } catch (e) { log('tick error:', e.message); }
  if (once) break;
  await sleep(cfg.pollMs);           // WORKER_POLL_MS, default 10_000
} while (!stop);
if (once) await tick();              // a second pass so an already-attested round can close and pay
```

`tick()` is four phases plus a save, in this order and always in this order:

1. `ccSigner.reset(); sourceSigner.reset();` Both `NonceManager`s drop their cached nonce so a transaction sent by another process with the same key (a seeding script, a redeploy) cannot cause a collision. Each phase also resets the relevant signer after a failed send.
2. `scanSource()`
3. `flushBatches()`
4. `closeRounds()`
5. `payouts()`
6. `saveState(state)` writes `worker/<WORKER_STATE_FILE>`.

An exception anywhere in a phase ends the tick: later phases do not run that tick, `saveState` is not reached (except where a phase saves on its own, see `payouts`), and the loop logs `tick error: <message>` and sleeps. Which exceptions are caught inside a phase and which escape is stated per phase below.

`--once` (`process.argv.includes('--once')`) does two things: it breaks the loop after the first tick and runs one more tick, and it is passed to the policy as `force: true`, so any provable payment is proven on that pass (reason `forced`).

## scanSource

- `head = sourceProvider.getBlockNumber()`.
- On a fresh state (`lastSourceBlock === 0`): `lastSourceBlock = WORKER_FROM_BLOCK - 1` if set, otherwise `max(0, head - 200)`.
- Events are fetched with `vault.queryFilter(vault.filters.Contributed(), from, to)` in windows of `MAX_LOG_RANGE = 50` blocks, because hosted Sepolia RPCs cap `eth_getLogs` ranges.
- Each event `(circleId, round, member, amount)` whose transaction hash is not already in `state.recorded` is appended to `pending[`${circleId}:${round}`]` unless that hash is already in the list, with `{ txHash, member, amount, block, seenAt: Date.now() }`, and logged as:

  ```
  Contributed · circle <id> round <r> · <member> · <amount/1e6> tUSD · sepolia block <n>
  ```

- After the scan, the cursor is pinned behind anything still pending: `lastSourceBlock = min(head, oldestPendingBlock - 1)`, or `head` when nothing is pending. A restart therefore rescans every payment that has not been recorded or quarantined yet, and a payment dropped from `pending` without being marked recorded (see the "left for later" rule below) is picked up again on the next scan.

`pending` itself is in-memory only; `state.recorded` is the durable record.

## The pending-payment model and quarantine

`flushBatches()` begins by reading the frontier: `attestedHeight` from `chainInfo.get_latest_attestation_height_and_hash(cfg.chainKey).height` (0 if the call fails) and `sourceHead` from the source provider. It then walks every `pending` key and validates each list against the ledger before anything is assembled, because a batch reverts as a whole if one element is bad.

Per key `circleId:round`, in order:

| Condition | Effect on `state.recorded` | Effect on `pending` | Log line |
|---|---|---|---|
| `ledger.getCircle(circleId)` reverts and `revertReason` starts with `UnknownCircle` | every tx in the list marked `true` | key deleted | `ignoring <n> payment(s) to unknown circle <circleId>` |
| `getCircle` fails for any other reason | none | none | none; the error is rethrown and ends the tick (`tick error: …`) |
| `circle.status !== 0` (Completed) or `round < circle.currentRound` (round already closed) | every tx marked | key deleted | `skip <circleId>:<round>: ledger is on round <currentRound> (circle completed) — <n> payment(s) can never be recorded` (the parenthesis appears only when the circle is completed) |
| `round > circle.currentRound` (future round) or `circle.open` (invites still open) | none | key deleted, not marked; rescanned next tick | `skip <circleId>:<round>: ledger is on round <currentRound> (invites still open)` (the parenthesis appears only when `circle.open`) |

Then, for the surviving list, sorted by source block ascending, per payment:

| Rule | Check | Effect | Log line |
|---|---|---|---|
| before start height | `p.block < circle.startHeight` (mirrors the ledger's `BeforeCircleStart`) | marked recorded, dropped | `ignoring payment by <member> at source block <block>, before the circle's start <startHeight> (<txHash first 12 chars>…)` |
| non-member | `member` (lowercased) not in `circle.members` | marked, dropped | `ignoring payment from non-member <member> (<tx12>…)` |
| wrong amount | `p.amount !== circle.contribution` | marked, dropped | `ignoring wrong-amount payment by <member>: <amount/1e6> tUSD, installment is <contribution/1e6> (<tx12>…)` |
| duplicate | the same member already kept in this list this tick | marked, dropped | `ignoring duplicate payment by <member> (<tx12>…)` |
| already recorded | `ledger.getContribution(circleId, round, member).queryId !== ZeroHash` | marked, dropped | none (silent) |

The order is deliberate and commented in the source: the start-height rule runs before the duplicate rule so a member's later valid payment is not the one dropped, and the amount rule runs before the duplicate rule so a corrected payment is not treated as a duplicate of the wrong-amount one.

What survives becomes a `PendingPayment` for the policy:

```ts
{ txHash, member, circleId, round, block,
  deadlineHeight: Number(await ledger.deadlineHeight(circleId, round)),
  closeHeight:    Number(await ledger.closeHeight(circleId, round)),
  chainKey:       circle.chainKey ?? cfg.chainKey,
  circleSize:     circle.members.length,
  seenAt }
```

If no candidate survives, `flushBatches` returns without logging a decision. After a submission attempt, the phase ends by dropping every pending payment whose hash is now in `state.recorded`.

## The batch policy

`decideBatch(pending, frontier, opts)` in `worker/src/agent/policy.ts` is a pure function; the worker calls it as `decideBatch(candidates, { attestedHeight, sourceHead }, { waitMs: cfg.batchWaitMs, force: once })` and logs `steward · <explainBatch(decision)>`. Its 17 unit tests are in `worker/test/policy.test.ts` (`pnpm test:agent`).

Constants, with the values in the source:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_BATCH` | `10` | Attestcoin verifies at most ten queries under one shared continuity proof. |
| `MAX_BATCH_RANGE` | `1000` | The Proof Builder batch endpoint rejects spans of 1000 or more blocks (`BatchSpanTooLarge`, verified against `prover.cc3-testnet`). |
| `URGENT_BLOCKS` | `24` | Prove with this much slack or less rather than wait for a fuller batch. |
| `ATTESTATION_LAG_BLOCKS` | `64` | How far the frontier may trail a roundmate's payment before holding for it stops being worth it. |

Derived functions:

```
provable(p, f) = p.block <= f.attestedHeight
slack(p, f)    = p.closeHeight - max(f.attestedHeight, f.sourceHead)
```

Inputs: `pending: PendingPayment[]` (the fields listed above), `frontier: { attestedHeight, sourceHead }`, `opts: { waitMs, now?, force? }` (`now` defaults to `Date.now()`).

Output, `BatchDecision`:

| Field | Type | Meaning |
|---|---|---|
| `act` | boolean | `reason !== 'wait'` |
| `chainKey` | number | the one chain key this call carries (0 when nothing is provable) |
| `batch` | `PendingPayment[]` | most urgent first, never more than `MAX_BATCH` |
| `reason` | `'full' \| 'round-complete' \| 'deadline-risk' \| 'waited' \| 'forced' \| 'wait'` | |
| `evidence` | `Record<string, number \| string \| boolean>` | what the decision log stores and what layer 3 may cite |

The algorithm, step by step:

1. `ready = pending.filter(provable)`. If empty: `{ act: false, chainKey: 0, batch: [], reason: 'wait', evidence: { pending, provable: 0, attestedHeight, waitingOnAttestation: pending.length } }`.
2. One chain key per call. Group `ready` by `chainKey`; pick the group whose minimum slack is smallest; on a tie, the larger group. `bestSlack` is that minimum.
3. Sort the chosen group by slack ascending, then by block ascending.
4. Greedy fill: take payments in that order until `batch.length >= MAX_BATCH`; skip any payment that would make `max(block) - min(block)` of the batch reach `MAX_BATCH_RANGE` (`hi - lo >= 1000`). Skipped payments stay pending and are counted as `leftBehind`.
5. `completes`: the `circleId:round` keys in the batch for which the batch carries a payment from at least `circleSize` distinct members (lowercased). This is computed on the batch, not the backlog, so the logged number describes this call.
6. Reason ladder, first match wins:
   - `forced` if `opts.force`
   - `full` if `batch.length >= MAX_BATCH`
   - `round-complete` if `completes.length > 0`
   - `deadline-risk` if `bestSlack <= URGENT_BLOCKS`
   - `waited` if `now - min(batch.seenAt) >= opts.waitMs`
   - otherwise `wait`
7. The roundmate hold. Only when the reason is `waited`: let `roundmates` be the pending payments that are not provable and belong to a `circleId:round` present in the batch. If `roundmates.length > 0` and `bestSlack > URGENT_BLOCKS + ATTESTATION_LAG_BLOCKS` (that is, more than 88 blocks), the reason is demoted to `wait` and the evidence gains `heldForRoundmates: roundmates.length` and `holdUntilAttested: max(roundmates.block)`. `full`, `round-complete`, `deadline-risk` and `forced` are never held.

Evidence keys when something is provable: `chainKey`, `queries` (batch length), `circles` (distinct circle ids in the batch), `attestedHeight`, `sourceHead`, `blocksOfSlack` (`bestSlack`, or `-1` if not finite), `roundsCompleted`, `blockSpan` (max block minus min block in the batch), `leftBehind`, `waitedSeconds` (rounded), `stillWaitingForAttestation` (`pending.length - ready.length`), plus `heldForRoundmates` and `holdUntilAttested` when held.

`explainBatch(decision)` renders one sentence, and every number in it comes from the evidence:

| Case | Sentence |
|---|---|
| nothing provable | `waiting: <pending> payment(s) not yet attested (frontier at source block <attestedHeight>)` |
| held | `waiting: <queries> query(ies) ready but <heldForRoundmates> roundmate payment(s) not yet attested (need source block <holdUntilAttested>); <blocksOfSlack> blocks of slack, holding for one call` |
| plain wait | `waiting: <queries> query(ies) ready, <blocksOfSlack> blocks of slack, batching for a fuller proof` |
| acting | `proving <queries> payment(s) from <circles> circle(s) on chain key <chainKey> in one call: <why>` where `why` is `the batch is full at the protocol maximum of ten queries`, `<roundsCompleted> round(s) complete, so proving now lets them close`, `only <blocksOfSlack> blocks before the grace window closes`, `waited <waitedSeconds>s for a fuller batch`, or `single pass requested` |

Cross-circle pooling follows from the fact that the policy never partitions by circle: payments from different circles under the same chain key sit in one sorted list and fill one batch together. The worker's testnet log has a `prove` entry at `2026-09-12T07:14:19Z` with `queries: 8, circles: 2` (`worker/steward.testnet4.json`; the transaction is in `docs/TESTNET_LOG.md`).

## Worked examples

Each example below was run through `decideBatch` and `explainBatch` as written; the evidence shown is the function's output. Every payment has `chainKey 1`, `circleSize 3`, round 0 unless stated.

### Example 1: the roundmate hold, then a round-complete call

Three members of circle 1 paid at source blocks 100, 102 and 104. `closeHeight` is 400. The frontier is `attestedHeight 101, sourceHead 101`, the oldest payment was seen 60 s ago and `waitMs` is 45 000.

- Only the block-100 payment is provable. Slack is `400 - max(101, 101) = 299`.
- Reason ladder: not forced, not full (1 of 10), not round-complete (1 of 3 members), not deadline-risk (299 > 24), but `waited` (60 s >= 45 s).
- Hold: two roundmates (blocks 102 and 104) are pending and not provable, and 299 > 88, so the decision becomes `wait`.

```
act=false reason=wait batch=[100]
waiting: 1 query(ies) ready but 2 roundmate payment(s) not yet attested (need source block 104); 299 blocks of slack, holding for one call
evidence: chainKey=1 queries=1 circles=1 attestedHeight=101 sourceHead=101 blocksOfSlack=299 roundsCompleted=0 blockSpan=0 leftBehind=0 waitedSeconds=60 stillWaitingForAttestation=2 heldForRoundmates=2 holdUntilAttested=104
```

When the frontier reaches 104 all three are provable, `completes` contains `1:0`, and the ladder stops at `round-complete`:

```
act=true reason=round-complete batch=[100,102,104]
proving 3 payment(s) from 1 circle(s) on chain key 1 in one call: 1 round(s) complete, so proving now lets them close
evidence: … blocksOfSlack=296 roundsCompleted=1 blockSpan=4 leftBehind=0 stillWaitingForAttestation=0
```

The real event behind this rule is in the testnet decision log: a `wait` at `2026-09-12T07:11:07Z` with `queries 2, heldForRoundmates 3, holdUntilAttested 11687346, blocksOfSlack 323`.

### Example 2: deadline risk beats the timer

One payment at block 900, `deadlineHeight 1000`, `closeHeight 1064`, seen 5 s ago, `waitMs` 45 000.

- With the frontier at `1050/1050`: slack is `1064 - 1050 = 14`, which is `<= URGENT_BLOCKS` (24), so the reason is `deadline-risk` even though the timer has 40 s to go and the batch has one query:

  ```
  proving 1 payment(s) from 1 circle(s) on chain key 1 in one call: only 14 blocks before the grace window closes
  evidence: … blocksOfSlack=14 waitedSeconds=5
  ```

- With the frontier at `1034/1034`: slack is 30, the timer has not elapsed, so the decision is `wait`:

  ```
  waiting: 1 query(ies) ready, 30 blocks of slack, batching for a fuller proof
  ```

### Example 3: the 1000-block span and `leftBehind`

Ten provable payments of one circle, one at block 100 and nine at blocks 1500 to 1508, all with `closeHeight 5000`, all seen 50 s ago; frontier `2000/2000`.

- All have slack 3000, so the sort falls back to block order and block 100 goes first.
- Adding block 1500 would make the span `1500 - 100 = 1400 >= 1000`, so it and the other eight are skipped: `leftBehind 9`.
- The batch is one query; the timer has elapsed; no unprovable roundmates exist, so `waited` stands:

  ```
  act=true reason=waited batch=[100]
  proving 1 payment(s) from 1 circle(s) on chain key 1 in one call: waited 50s for a fuller batch
  evidence: … blocksOfSlack=3000 blockSpan=0 leftBehind=9 waitedSeconds=50
  ```

  The nine remain pending and are proven as a batch of nine on the next tick (the test `never pools payments more than 1000 blocks apart` asserts exactly two calls).

### Example 4: one chain key per call, most urgent chain first

Three provable payments, frontier `1500/1500`: chain key 1 with `closeHeight 3000` (slack 1500), and two on chain key 3 with `closeHeight 1600` and `1700` (slack 100 and 200). The chain-key-3 group has the smaller minimum slack, so `chainKey 3` is served with a batch of two and the chain-key-1 payment waits for a later call. With nothing urgent and the timer not elapsed this particular call is a `wait` with `queries 2, blocksOfSlack 100`; the point is the grouping, which the test `never mixes chain keys in one call` asserts.

## Proof building

`worker/src/proofs.ts` exposes `buildBatchProof(txHashes): Promise<BatchProof[]>` and `buildSingleProof(txHash): Promise<BatchProof>`; the latter is `buildBatchProof([h])[0]`. `buildBatchProof` throws `batch must be 1..10 txs` outside that range. The returned shape is:

```ts
interface BatchProof {
  chainKey: number;
  heights: number[];
  txBytes: string[];
  merkleProofs: { root: string; siblings: { hash: string; isLeft: boolean }[] }[];
  continuity: { lowerEndpointDigest: string; roots: string[] };
  txHashes: string[];
}
```

Normally one `BatchProof` is returned; the testnet fallback may return several, which the caller submits one by one.

### Testnet mode (`KITTY_MODE` unset or `testnet`)

1. Receipts for every hash are fetched from the source provider; a missing receipt throws `tx <hash> not found on source chain`.
2. `pb = new proofProvider.service.ProofBuilder(cfg.chainKey, cfg.proofBuilderUrl)` from `@gluwa/usc-sdk@0.18.0`. The SDK's endpoints are `/api/v1/proof-by-tx/{chainKey}/{txHash}`, `/api/v1/proof-batch-by-tx/{chainKey}` (POST, JSON array of hashes) and `/api/v1/attested-height/{chainKey}`.
3. `log('waiting for Sepolia block <maxHeight> to be attested on Creditcoin…')`, then `pb.waitUntilHeightAttested(cfg.chainKey, maxHeight, 15_000, 20 * 60_000)`: poll every 15 s, give up after 20 minutes (the SDK default is 15 minutes; the worker passes 20). The SDK polls the Proof Builder's attested-height endpoint, not the precompile, and sleeps an extra 5 s after the height is reached. On timeout it throws `Timeout waiting for height <h> to be attested on chain key <k>`, which ends the tick.
4. `log('attested. requesting batch proof for <n> tx(s)…')`, then `pb.getBatchProof(txHashes)`. With `WORKER_DEBUG=1` the first raw response is logged once (`raw batch response: …`, Maps rendered as objects).
5. On success, `flattenBatch` walks the SDK's `merkleProofs: Map<height, Map<txIndex, { txHash, txBytes, merkleProof }>>`, indexes by lowercase hash, and reorders into the caller's hash order (a missing hash throws `proof builder response missing tx <hash>`). The continuity proof is copied as `{ lowerEndpointDigest, roots }`.
6. If the batch call fails or returns `success: false`, the worker logs `batch proof unavailable (<error>) — falling back to <n> single proof(s)` and calls `singleProofs`:
   - `pb.getProof(h)` per hash; a failure throws `getProof(<h>) failed: <error>`.
   - Singles are grouped by `headerNumber`, groups sorted by height ascending; each group becomes a `BatchProof` sharing its first member's continuity proof (transactions in one block share one).
   - One group: returned as is.
   - Several groups: `proofProvider.mergeProofs(parts.map(p => [p.heights[0], p.continuity]))` is tried. The merge is accepted only if every part's Merkle roots appear in `merged.roots`; then `merged <n> continuity proofs into one (<roots> roots)` is logged and one flattened `BatchProof` is returned. Otherwise `cannot merge continuity proofs (<reason>) — submitting <n> separate batches` is logged and the parts are returned as separate proofs.

### Local mode (`KITTY_MODE=local`)

Two anvils with `MockVerifier` at `0x…0FD2` and `MockChainInfo` at `0x…0fD3` (`scripts/local-setup.sh`). No Proof Builder is contacted. For each hash:

- `encoding.getTransactionWithRaw(sourceProvider, h)` and the receipt are fetched; `encoding.abiEncode(txRaw, receipt).abi` produces the same prover-format `txBytes` the real Proof Builder returns, so `KittyLedger`'s `EvmV1Decoder` path runs on genuine transaction and receipt bytes.
- The Merkle proof is a placeholder `{ root: keccak256(txHash), siblings: [] }`; `MockVerifier` derives `txIndex` from the root, so per-transaction roots keep query ids distinct.
- The continuity proof is `{ lowerEndpointDigest: ZeroHash, roots: [keccak256("local")] }`.

## Preflight and gas

`preflight(proof)` in `worker/src/verifier.ts` is a `staticCall` against the block-prover precompile `BLOCK_PROVER = '0x0000000000000000000000000000000000000FD2'`, choosing the overload by `proof.heights.length`:

- one height: `verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))` with `[chainKey, heights[0], txBytes[0], merkleProofs[0], continuity]`
- otherwise: `verify(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))` with the arrays

The result is `{ ok: true }`, `{ ok: false, detail: 'precompile returned false' }`, or on revert `{ ok: false, detail }` where `detail` is the error's `shortMessage` (or `message`) with a leading `execution reverted:` stripped. `txIndexOf(proof, i)` calls `calculateTxIndex(merkleProof)` on the same precompile and is available to callers; the worker does not use it in the loop.

Gas (`gasFor` in `worker/src/chain.ts`):

- local mode: a fixed `6_000_000n`.
- testnet: `sdkUtils.gas.computeGasLimit(ccProvider, contract, data, ccWallet.address, max(1, continuity.roots.length))`. The SDK estimates gas and multiplies by 135/100; when estimation fails (a known behaviour of precompile paths under `pallet-evm`) it falls back to `21000 + 5000 * continuityLength + 20000`. That fallback is far below what `recordContributions` costs, so the worker floors the result: `g < 1_500_000n ? 1_500_000n : g`.

## Submissions

All four submit helpers in `worker/src/chain.ts` follow the same sequence: encode the calldata, `staticCall` the ledger function with the same arguments (so a custom error surfaces before gas is spent), compute the gas limit, log the intent, send with `{ gasLimit }`, `wait()` for the receipt, log the result, return the receipt.

| Helper | Ledger call | Intent log | Result log |
|---|---|---|---|
| `submitRecordContributions(ledger, p)` | `recordContributions(chainKey, heights, txBytes, merkleProofs, continuity)` | `→ KittyLedger.recordContributions(<n> tx, heights <lo>–<hi>) gas=<g>` | `   ✓ verified by 0x0FD2 in one call · cc tx <hash>` |
| `submitConfirmPayout(ledger, p)` | `confirmPayout(chainKey, heights[0], txBytes[0], merkleProofs[0], continuity)` | `→ KittyLedger.confirmPayout(height <h>) gas=<g>` | `   ✓ payout proven · cc tx <hash>` |
| `submitConfirmPayouts(ledger, p)` | `confirmPayouts(chainKey, heights, txBytes, merkleProofs, continuity)` | `→ KittyLedger.confirmPayouts(<n> payouts, heights <lo>–<hi>) gas=<g>` | `   ✓ <n> payouts proven in one call · cc tx <hash>` |

`revertReason(e, iface)` turns an ethers error into `Name(arg, arg)` when ethers already parsed a custom error (`err.revert`), or by `iface.parseError(err.data ?? err.error?.data)`, and otherwise returns `shortMessage`, `message` or `String(e)`. The worker's quarantine and scenario matching both depend on this string form (`UnknownCircle(…)`, `WrongChain(3, 1)`, `Error(Continuity proof does not match attestation or checkpoint)`).

### recordContributions (inside `flushBatches`)

After a decision with `act: true`:

1. `proofs = await buildBatchProof(decision.batch.map(p => p.txHash))`.
2. For each proof: `preflight`. If rejected: log `✗ preflight rejected by 0x0FD2 (<detail>) — not submitting, will retry after the next attestation`, record `skip`, and continue with the next proof (the payments stay pending). If ok: log `   preflight ok · 0x0FD2.verify says this batch of <n> would verify`, then `submitRecordContributions`, mark every `proof.txHashes` in `state.recorded`, record `prove`.
3. Any throw in steps 1 or 2 (attestation timeout, Proof Builder failure, `staticCall` revert, send failure) is caught once for the whole batch: `ccSigner.reset()`, log `✗ batch failed: <revertReason>`, record `error`. Nothing is marked recorded, so the same candidates return next tick. A proof that was already submitted successfully in the same loop keeps its `recorded` marks.

### closeRound (`closeRounds`)

For `id` in `1..circleCount`:

- skip if `circle.status !== 0`; skip if the current round's `status !== 0`; skip if `circle.open`.
- `full = round.contributions >= circle.members.length`; `closeAt = ledger.closeHeight(id, round)`; `attested = chainInfo.is_height_attested(cfg.chainKey, closeAt)`. Note that this uses `cfg.chainKey`, not the circle's own `chainKey`.
- If neither `full` nor `attested`, skip. Otherwise log `→ KittyLedger.closeRound(<id>) — everyone paid` or `→ KittyLedger.closeRound(<id>) — deadline + grace (block <closeAt>) attested`, send `ledger.closeRound(id)`, wait, log `   ✓ round <r> closed · cc tx <hash>`, and record `close`.
- A failure is caught per circle: `ccSigner.reset()` and `✗ closeRound(<id>) failed: <revertReason>`; the loop continues with the next circle.

Read errors (`getCircle`, `getRound`, `closeHeight`, `is_height_attested`) are not caught and end the tick.

### payout and confirmPayout (`payouts`)

For every circle and every round `r` from 0 to `currentRound - 1` (or to `currentRound` when the circle is Completed):

- skip unless `round.status === 1` (Closed, not Paid); skip if `round.recipient` is the zero address (nobody eligible, pot carried over).
- If `state.paid[`${id}:${r}`]` is absent:
  - `round.pot === 0n`: log `round <id>:<r> closed with empty pot — nothing to pay`, skip.
  - `vault.paidOut(id, r)` true: log `round <id>:<r> already paid on source but tx unknown — set worker/state paid[<id>:<r>] manually`, skip. This is the case the recovery procedure in `OPERATIONS.md` covers.
  - Otherwise log `→ KittyVault.payout(circle <id>, round <r>, <recipient>, <pot/1e6> tUSD) on Sepolia`, send `vault.payout(id, r, recipient, pot)`, wait, write `state.paid[key]` and call `saveState` immediately (before the proof-back, so a crash between the two cannot lose the hash), log `   ✓ paid · sepolia tx <hash>`, record `payout`. A failure: `sourceSigner.reset()`, `✗ payout <key> failed: <revertReason>`, continue.
- If `state.confirmed[payoutTx]` is set, skip; otherwise queue `{ id, r, key, payoutTx }` for proof-back.

Proof-back, once the scan is complete:

- **Batch path**, when more than one payout is queued. `buildBatchProof(first 10 payout hashes)` and take the first returned proof. The batch path proceeds only if that proof covers everything asked for (`proof.heights.length === min(10, queued)`), that is, the fallback did not split it. Then `preflight`:
  - rejected with a transient detail matching `/timeout|TIMEOUT|EAI_AGAIN|ECONN|socket hang up/i`: log `✗ batch payout preflight could not reach the node (<detail>) — retrying the batch next tick` and **return** (no singles this tick).
  - rejected otherwise: log `✗ batch payout preflight rejected by 0x0FD2 (<detail>) — falling back to singles` and fall through.
  - ok: `submitConfirmPayouts`, mark each covered `payoutTx` in `state.confirmed`, record `confirm` with `payouts`, `circles`, `heights`, `continuityRoots`, and return.
  - a throw anywhere in the batch path: `ccSigner.reset()`; if `revertReason` matches the same transient pattern, log `✗ confirmPayouts batch could not reach the node or the Proof Builder (<why>) — retrying the batch next tick` and return; otherwise log `✗ confirmPayouts batch failed: <why> — falling back to singles` and fall through.
- **Single path**, for each queued payout: `buildSingleProof(payoutTx)`, `preflight` (rejected: `✗ payout preflight rejected by 0x0FD2 (<detail>) — retrying later`, continue), `submitConfirmPayout`, `state.confirmed[payoutTx] = true`, record `confirm` with `circleId`, `round`, `sourceHeight`. A throw: `ccSigner.reset()`, `✗ confirmPayout <key> failed: <revertReason>`, continue.

The transient-failure rule exists so that a network blip does not turn a batch into ten single calls: only a definite rejection by the precompile or the ledger triggers the fallback. The batch path ran live on 13 September 2026 (`2 payouts (circle 6 round 0, circle 7 round 0) proven back to Creditcoin in one call`, Creditcoin tx `0x5496258b…`).

## The decision log

`worker/src/agent/log.ts`. Every decision is appended to `worker/<STEWARD_LOG_FILE>` (default `steward.local.json`) as a JSON array written with `JSON.stringify(all.slice(-500), null, 1)`: the file keeps the last `MAX = 500` entries and is rewritten on every `record`. `read(limit = 50)` returns the last `limit` entries newest first; a missing or unparsable file reads as `[]`.

```ts
interface Decision {
  at: string;                                   // ISO timestamp, set by record()
  kind: 'prove' | 'wait' | 'close' | 'payout' | 'confirm' | 'skip' | 'error';
  summary: string;
  evidence: Record<string, unknown>;            // only numbers and hashes from chain state
  txs?: { chain: 'source' | 'creditcoin'; hash: string }[];
}
```

What each kind carries, as written by `worker.ts`:

| kind | summary | evidence keys | txs |
|---|---|---|---|
| `wait` | `explainBatch` sentence | the policy evidence: either `pending, provable, attestedHeight, waitingOnAttestation` (nothing provable) or `chainKey, queries, circles, attestedHeight, sourceHead, blocksOfSlack, roundsCompleted, blockSpan, leftBehind, waitedSeconds, stillWaitingForAttestation` plus `heldForRoundmates, holdUntilAttested` when held | none |
| `skip` | `0x0FD2 preflight rejected the batch: <detail>` | policy evidence plus `preflight: 'rejected'` | none |
| `prove` | `explainBatch` sentence | policy evidence plus `preflight: 'passed'`, `queriesInCall`, `fromHeight`, `toHeight`, `continuityRoots` | `[{creditcoin, recordContributions tx}, {source, tx}…]` one source entry per proven payment |
| `error` | `batch failed: <revertReason>` | policy evidence plus `revert` | none |
| `close` | `closed circle <id> round <r> — every member proven` or `closed circle <id> round <r> — close height <h> attested` | `circleId` (string), `round`, `closeHeight` (string), `proven`, `members`, `everyoneProven` | `[{creditcoin, closeRound tx}]` |
| `payout` | `paid circle <id> round <r>: <pot/1e6> tUSD to <recipient>` | `circleId` (string), `round`, `recipient`, `amount_tUSD` | `[{source, payout tx}]` |
| `confirm` (single) | `payout for circle <id> round <r> proven back to Creditcoin` | `circleId` (string), `round`, `sourceHeight` | `[{creditcoin, confirmPayout tx}, {source, payout tx}]` |
| `confirm` (batch) | `<n> payouts (circle <id> round <r>, …) proven back to Creditcoin in one call` | `payouts`, `circles` (comma-joined string), `heights` (comma-joined string), `continuityRoots` | `[{creditcoin, confirmPayouts tx}, {source, payout tx}…]` |

`citableValues(entries)` flattens what layer 3 may cite: every evidence value as `String(v).toLowerCase()` (undefined and null skipped) and every `txs[].hash` lowercased. The allowed set is not otherwise normalised, while citations have their commas removed before matching. A comma-joined evidence value such as the batch `confirm` entry's `heights: "11696611,11696612"` or `circles: "6,7"` is therefore not citable: `[[11696611,11696612]]`, `[[11696611]]` and `[[6,7]]` are all rejected as unverifiable against that entry alone (checked by running `check` against `citableValues` of such an entry); a component matches only if it also appears elsewhere as its own value.

Real entries of every kind are in `worker/steward.testnet4.json` (212 entries: 160 `wait`, 19 `close`, 12 `payout`, 10 `prove`, 10 `confirm`, 1 `error`) and a trimmed copy ships to the dashboard as `web/src/data/steward.sample.json`; the formats are in [`DATA_FORMATS.md`](DATA_FORMATS.md).

## The citation validator

`worker/src/agent/citations.ts`, `check(text, allowed): Checked`, pure and synchronous, 12 unit tests in `worker/test/citations.test.ts`.

```ts
interface Checked {
  text: string;                       // sentences whose every figure was cited and verified, markers stripped
  verified: string[];                 // citations that matched
  stripped: { sentence: string; reason: 'unverifiable citation' | 'uncited figure'; value: string }[];
}
```

Definitions, as the regular expressions in the source:

- A **citation** is `[[…]]`: `CITATION = /\[\[([^\]]+)\]\]/g`.
- A **figure** is any hex blob of at least six hex digits or any number: `FIGURE = /0x[0-9a-fA-F]{6,}|\d[\d,_.]*/g`. A figure outside a citation is an unbacked claim even if it is true.
- **Normalisation** (`norm`): trim, lowercase, remove commas, underscores and whitespace.
- **Sentences** are split on `.`, `!` or `?` followed by whitespace and then an uppercase letter, `(`, a quote, or `[[` (`/(?<=[.!?])\s+(?=[A-Z(“"']|\[\[)/`), so decimals and hex are not split.

`matches(value, allowed)`:

1. Exact: `allowed.has(norm(value))`.
2. Hex (`/^0x[0-9a-f]*$/` after normalisation): matched only as a **prefix of an allowed value**, and only if the citation is at least 10 characters long (`0x` plus eight hex digits); `[[0xe3ef]]` is rejected, `[[0xe3ef81c8196c46]]` matches the full hash `0xe3ef81c8…757b8d`. Hex never falls through to the numeric rule: stripping non-digits from `0xdeadbeef…` would leave `0`, which almost any log contains (regression test `a fake address is not rescued by the numeric fallback`).
3. Numeric with a unit: `bare = value with everything but digits and '.' removed`; accepted if `bare` is non-empty, `bare` equals the value with only letters, `%`, `$` and spaces removed (so the only extra characters were unit text, not other digits), and `allowed.has(bare)`. `[[199,375]]` and `[[11,656,295 tUSD]]` match `199375` and `11656295`.

`check` per sentence:

1. Collect its citations. If any fails `matches`, push `{ sentence, reason: 'unverifiable citation', value: <first failing citation> }` and drop the sentence.
2. Replace citations with a space and search for a loose `FIGURE`. If one exists, push `{ sentence, reason: 'uncited figure', value: <first figure> }` and drop the sentence.
3. Otherwise add its citations to `verified` and keep the sentence with each `[[v]]` replaced by `v.trim()`.

`text` is the kept sentences joined with a single space. Prose with no figures passes untouched. The `poisonReasoning` scenario in `worker/src/scenarios.ts` feeds `check` one true citation and three fabrications (`[[500000]]`, a bare `850`, `[[0xdeadbeef…]]`) and passes only if exactly three sentences are stripped and at least one citation is verified.

The instruction the model is held to lives next to the enforcement, `CITATION_RULE`:

> Every number, address, block height, transaction hash and query id you state MUST be wrapped in double square brackets, like [[11656295]] or [[0xabc123…]]. You may only cite values that appear in the FACTS below. Never state a figure that is not in FACTS, cited or otherwise. If you cannot support a sentence with a cited fact, leave the sentence out.

## The explain contract

`worker/src/agent/explain.ts`, `explain(question, fallback, { entries?, limit? }): Promise<Explanation>`.

```ts
interface Explanation {
  text: string;
  source: 'claude' | 'deterministic';
  verified: string[];
  stripped: { sentence: string; reason: string; value: string }[];
}
```

- `entries` defaults to `read(limit ?? 12)`; `facts()` renders at most the first 12 as one line each: `- <at> <kind>: <summary> | k=v k=v … sourceTx=<hash> creditcoinTx=<hash>`.
- The deterministic result is `{ text: fallback, source: 'deterministic', verified: [], stripped: [] }`. It is returned without contacting any model when `entries` is empty, or when neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set.
- Otherwise `new Anthropic()` (the SDK reads the key from the environment) and one `messages.create` with:
  - `model: 'claude-opus-5'`
  - `max_tokens: 1024`
  - `output_config: { effort: 'low' }` (the source comment: a short rewrite of facts it is handed; nothing to reason hard about)
  - `system`: a fixed description of the steward (it explains decisions, it can only submit proofs, write two or three short sentences for a member, no preamble, no markdown, no bullet points) followed by `CITATION_RULE`
  - one user message: `FACTS (the only values you may cite):\n<facts>\n\nQUESTION: <question>`
- The text blocks of the response are joined and passed to `check(raw, citableValues(entries))`. If nothing survives, the deterministic result is returned with the `stripped` list attached so the failure is visible. Otherwise `{ text, source: 'claude', verified, stripped }`.
- `Anthropic.AuthenticationError`, `Anthropic.RateLimitError` and any other `Anthropic.APIError` degrade to the deterministic result; any other exception propagates.

Callers:

- `pnpm explain ["question"]` (`worker/src/agent/explain-cli.ts`): reads 12 entries, exits with `No decisions logged yet. Run \`pnpm worker\` (or \`pnpm e2e:local\`) first.` if there are none, uses the newest entry's `summary` as `fallback` and the default question `What have you done recently, and why?`, and prints the text, `— source: <source>` (with ` (no ANTHROPIC_API_KEY, or nothing survived the citation check)` when deterministic), the verified citations and each stripped sentence with its reason.
- `POST /steward/explain` in the lab API, with the same fallback and default question, the question trimmed to 500 characters (see [`LAB_API.md`](LAB_API.md)).

The dashboard's committed sample answer (`web/src/data/steward.explain.sample.json`) was recorded with no key and is therefore `source: "deterministic"`.

## Recovery the code supports

The step-by-step procedures are in [`../OPERATIONS.md`](../OPERATIONS.md#recovery-procedures); this is the list of mechanisms the worker itself provides.

| Situation | Mechanism |
|---|---|
| A payout mined but the hash was lost | `payouts` detects `vault.paidOut(id, r)` and logs `round <id>:<r> already paid on source but tx unknown — set worker/state paid[<id>:<r>] manually`. Add the hash under `paid` in the state file; the next tick skips the payout and runs the proof-back. |
| A payment the ledger can never accept keeps a batch reverting | The five quarantine rules mark it in `recorded` automatically. For a cause the worker does not pre-validate (`CircleStillOpen`, `RoundNotOpen`, …) the batch records `error` each tick until the state changes; the hash can be added to `recorded` by hand to drop it. |
| Restart after a crash | `lastSourceBlock` is pinned behind the oldest pending payment at the end of every scan, and `recorded`, `paid` and `confirmed` are written only after the corresponding receipt, so a restart rescans and never double-submits what the ledger already has (the "already recorded" rule reads `getContribution`). |
| Rescan from an earlier block | Delete the state file or set `lastSourceBlock` to 0 and start with `WORKER_FROM_BLOCK=<n>`; without it a fresh state starts at `head - 200`. |
| Nonce collision with another process using the key | Both signers are reset at the start of every tick and after every failed send. |
| A stalled attestor | The policy keeps returning `wait`; `waitUntilHeightAttested` gives up after 20 minutes with a tick error; the next tick retries. `closeRounds` cannot close on a member until the close height is attested. |
| A proof that would fail | `preflight` and the `staticCall` in every submit helper reject it before gas is spent; the payment stays pending. |
| Finish a pass by hand | `pnpm worker --once` forces whatever is provable, then runs a second tick so an attested round can close and pay in the same invocation. |
| Separate worlds | `WORKER_STATE_FILE`, `STEWARD_LOG_FILE` and `KITTY_ENV_FILE` keep one state and log per ledger. A state file must not be reused across ledgers: its `recorded` map would hide payments the new ledger has never seen. |

## Environment variables

Every variable read by the worker process (`config.ts`, `worker.ts`, `proofs.ts`, `agent/log.ts`, `agent/explain.ts`), with the default in the source.

| Variable | Read in | Default | Meaning |
|---|---|---|---|
| `KITTY_ENV_FILE` | `config.ts` | unset | A second dotenv file loaded after `.env` with `override: true`, resolved against the repository root. |
| `KITTY_MODE` | `config.ts` | `testnet` | `local` selects the anvil proof path (`localBatch`) and the fixed 6,000,000 gas limit. |
| `SOURCE_CHAIN_KEY` | `config.ts` | `1` | `cfg.chainKey`: the Attestcoin chain key used for the frontier read, `is_height_attested`, and as the fallback when a circle reports no `chainKey`. |
| `SEPOLIA_RPC_URL` | `config.ts` | `https://ethereum-sepolia-rpc.publicnode.com` | Source chain RPC. |
| `CREDITCOIN_RPC_URL` | `config.ts` | `https://rpc.cc3-testnet.creditcoin.network` | Creditcoin RPC. |
| `PROOF_BUILDER_URL` | `config.ts` | `https://prover.cc3-testnet.creditcoin.network` | Attestcoin Proof Builder base URL. |
| `PRIVATE_KEY` | `config.ts` | empty | Operator and steward key. Used only if `ethers.isHexString(value, 32)`; otherwise treated as absent and `contracts()` throws. |
| `KITTY_VAULT_ADDRESS` | `config.ts` | empty | `KittyVault` on the source chain; required by `contracts()`. |
| `KITTY_LEDGER_ADDRESS` | `config.ts` | empty | `KittyLedger` on Creditcoin; required by `contracts()`. |
| `TEST_USD_ADDRESS` | `config.ts` | empty | The stablecoin; required by `contracts()`. |
| `WORKER_POLL_MS` | `config.ts` | `10000` | Sleep between ticks. |
| `WORKER_BATCH_WAIT_MS` | `config.ts` | `45000` | `opts.waitMs` for the policy's `waited` reason. |
| `WORKER_FROM_BLOCK` | `config.ts` | unset | First source block to scan when the state file has no cursor; otherwise `head - 200`. |
| `WORKER_STATE_FILE` | `config.ts` | `state.local.json` | State file name, under `worker/`. |
| `WORKER_DEBUG` | `proofs.ts` | unset | `1` logs the first raw `getBatchProof` response. |
| `STEWARD_LOG_FILE` | `agent/log.ts` | `steward.local.json` | Decision log file name, under `worker/`. Read at import time. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | `agent/explain.ts` | unset | Either enables layer 3; without both, every explanation is deterministic. |

Variables read by the sibling tools that share `config.ts` but are not part of the worker loop: `PORT` (`api.ts`, default `8790`), `KITTY_VIEWER_ADDRESS` and `FAKE_VAULT_ADDRESS` (`api.ts` `/status`; `FAKE_VAULT_ADDRESS` also enables the `spoofEmitter` scenario), `SCENARIO_CIRCLE_ID` (`scenarios.ts`, default the latest circle), `LAB_RECORD_OUT` and `LAB_ONLY` (`record-lab.ts`), `LEDGER_DEPLOY_BLOCK` (`receipts.ts`, the start of the ledger event scan; otherwise `head - 50000`). `EVM_V1_DECODER_LIBRARY_ADDRESS` appears in `.env.example` and is read by nothing under `worker/`.
