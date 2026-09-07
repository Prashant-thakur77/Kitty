# How Kitty uses the Attestcoin Protocol

This is the technical integration document required by the BUIDL CTC submission rules.

## Environment

| | value |
|---|---|
| Creditcoin network | CC3 Testnet, chainId `102031`, RPC `https://rpc.cc3-testnet.creditcoin.network` |
| Source chain | Ethereum Sepolia, **chainKey `1`** on CC3 Testnet (chainId 11155111) |
| Block-prover precompile | `0x0000000000000000000000000000000000000FD2` (`INativeQueryVerifier`) |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fD3` |
| Proof Builder | `https://prover.cc3-testnet.creditcoin.network` (`/api/v1/attested-height/1`, `/api/v1/proof-batch-by-tx`) |
| Packages | `@gluwa/asc-contracts@0.2.1` (Solidity), `@gluwa/usc-sdk@0.18.0` (TypeScript) |
| Deployed contracts | see `deployments.json` (written by `scripts/deploy.sh`) |

## Readability pipeline, step by step

1. **Source-chain contract is intentionally dumb** (`src/source/KittyVault.sol`). It escrows a
   stablecoin and emits two purpose-named events, exactly as the Attestcoin design-pattern docs
   recommend ("use specific, unambiguous events rather than common standards"):
   `Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount)`
   and `PaidOut(...)`. It has no idea what a circle is.

2. **Attestation.** The attestor network attests Sepolia blocks on Creditcoin (~7–8 minutes of lag
   on testnet at the time of writing: Sepolia head 11,655,846 vs attested 11,655,810).

3. **Worker** (`worker/src/worker.ts`, `worker/src/proofs.ts`) groups `Contributed` events by
   `(circleId, round)`, waits with `ProofBuilder.waitUntilHeightAttested(chainKey, maxHeight)`,
   then calls **`ProofBuilder.getBatchProof([...txHashes])`** — one continuity proof, up to 10
   Merkle proofs — and submits `KittyLedger.recordContributions(...)`.

4. **On-chain verification** (`src/asc/KittyLedger.sol`):
   ```solidity
   bool ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity); // 0x0FD2, batch overload
   ```
   Before the call, each query id is derived exactly as `ASCBase` does
   (`keccak(chainKey ‖ height ‖ VERIFIER.calculateTxIndex(merkleProof))`) and rejected if already
   processed — replay protection at the proof level, plus a second guard per `(circle, round, member)`.

5. **Decoding with `EvmV1Decoder`** for every proven tx:
   - `getTransactionType` / `isValidTransactionType` (types 0–4);
   - `decodeReceiptFields` → **`receiptStatus == 1` is enforced** ("the precompile proves
     inclusion, not success");
   - `getLogsByEventSignature(receipt, CONTRIBUTED_SIG)` → exactly one log, 4 topics, 32-byte data;
   - `log.address_` must equal the circle's registered vault (**emitter binding**);
   - `decodeCommonTxFields` → `tx.to == vault` and `tx.from == member` (**calldata binding**: a
     proof of someone else's tx that merely *contains* a vault log can't be reused).

6. **Chain binding.** `chainKey` must equal the immutable `SOURCE_CHAIN_KEY`. A contract at the same
   address on another supported chain (Ethereum mainnet is chainKey 3 on testnet) cannot feed the ledger.

7. **Time from attested blocks, not clocks.** A contribution is *on time* iff its proven source
   block height ≤ `startHeight + (round+1)·roundBlocks`. `closeRound` may run early when everyone
   has paid, otherwise only when **`CHAIN_INFO.is_height_attested(chainKey, deadline)`** (0x0FD3)
   is true — the attestor network is the clock. Missed members are recorded permanently.

8. **Close the loop.** The vault operator pays the rotation recipient on Sepolia; the worker proves
   that `PaidOut` tx with a single `verifyAndEmit` and `confirmPayout` moves the round to `Paid`
   only if recipient and amount match what the ledger decided.

9. **Kitty Score.** `creditScore(member)` = 500 + 15·onTime − 20·late − 120·missed, clamped to
   300–850. Every input is a proven transaction or an attested deadline — any Creditcoin lender
   can read it without trusting Kitty's operator.

## Files using Attestcoin

| File | Usage |
|---|---|
| `src/asc/KittyLedger.sol` | `verifyAndEmit` batch (recordContributions) and single (confirmPayout); `calculateTxIndex` query ids; `EvmV1Decoder` receipt + calldata decoding; `is_height_attested` deadline clock |
| `src/interfaces/IChainInfo.sol` | ChainInfo precompile (0x0FD3) interface |
| `src/asc/KittyViewer.sol` | Reads proof-derived state in one call for the dashboard |
| `src/source/KittyVault.sol` | Source-chain contract in the readability pattern (minimal logic, purpose-named events) |
| `worker/src/proofs.ts` | usc-sdk `ProofBuilder.waitUntilHeightAttested`, `getBatchProof`, fallback `getProof` + `mergeProofs`; local mode uses `encoding.abiEncode` |
| `worker/src/chain.ts` | usc-sdk `utils.gas.computeGasLimit`; custom-error decoding |
| `worker/src/worker.ts` | Readability off-chain worker loop |
| `worker/src/scenarios.ts` | Adversarial proofs pushed through the precompile path |
| `web/src/lib/prover.ts`, `web/src/components/ProvePanel.tsx` | Browser-side proving against the Proof Builder (CORS `*`): batch proof fetched client-side, `recordContributions` submitted from the member's wallet |
| `web/src/hooks.ts` | Dashboard reads the ChainInfo precompile for the attestation-lag indicator |
| `src/asc/KittyCreditLine.sol`, `src/asc/KittyBadge.sol` | Consumers of proof-derived state (score, record) — lending and a live-rendered soulbound badge |
| `test/`, `scripts/local-e2e.sh` | Precompiles mocked at their real addresses (`vm.etch` / `anvil_setCode`) |

## Gas: why batch (measured on the live precompile)

`eth_estimateGas` against the real `0x0FD2` on CC3 Testnet, using real Proof Builder proofs for the
three Sepolia deployment transactions (two in block 11,656,253, one in 11,656,295):

| Call | Continuity roots | Gas |
|---|---|---|
| single `verify`, tx @ 11656253 #86 | 48 | 104,141 |
| single `verify`, tx @ 11656253 #85 | 48 | 112,239 |
| single `verify`, tx @ 11656295 #44 | 6 | 45,433 |
| **three singles, total** | | **261,813** |
| **one batch `verify` of the same three** | 48 (shared) | **199,375** |

The batch is 24% cheaper for three payments, and the gap grows with the age of the blocks because
the continuity proof — the expensive part — is verified once instead of once per payment. A
ten-member round is one continuity check plus ten Merkle checks. Reproduce with
`pnpm verify:live <h1> <h2> <h3>` and `cast estimate`.

## Why not inherit `ASCBase`?

`ASCBase.execute` calls `_processAndEmitEvent(action, queryId, txBytes)` — it drops `chainKey`
and the source `blockHeight`. Kitty needs both (chain binding, height-based deadlines) and needs
the batch overload of the precompile, so `KittyLedger` re-implements the same
verify → dedupe → act pipeline with identical query-id derivation and adds `recordContributions`.

## Testing without the network

`test/` mocks both precompiles at their real addresses with `vm.etch` and builds prover-format
`txBytes` (`abi.encode(uint8 txType, bytes[] chunks)`) in `test/TxFixtures.sol`. 27 tests cover the
batch path, replay, spoofed emitter, wrong calldata target, reverted source tx, non-member,
wrong amount/round, late flagging, deadline gating via ChainInfo, rotation, payout proof, scoring.

`scripts/local-e2e.sh` runs two anvils, mocks the precompiles with `anvil_setCode`, and drives the
real worker — including the real `@gluwa/usc-sdk` `abiEncode` so the decoder is exercised on
genuine transaction/receipt bytes — through two rounds and a replay attack.

## Gas notes
Gas estimation through the precompile can fail (`pallet-evm` does not always propagate reverts in
estimation mode); the worker uses `usc-sdk`'s `utils.gas.computeGasLimit`, which falls back to a
continuity-length heuristic. Batch verification amortises the continuity proof: one call per round
instead of one per member.
