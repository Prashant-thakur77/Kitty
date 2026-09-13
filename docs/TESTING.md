# Testing

How Kitty is tested, what each suite is responsible for, how the Attestcoin precompiles are stood in for, what the invariant campaign checks, and how to add a test. Numbers below come from `forge test --list` and `forge test -vv` run with Foundry 1.7.1 against the repository at the time of writing: 162 Foundry tests in 15 suites, all passing; 29 worker tests and 11 bot tests under `node:test`; 8 attack scenarios in the local two-anvil world. The threat each test answers is in [`THREAT_MODEL.md`](THREAT_MODEL.md); the reviewer's pointer list is in [`AUDIT_CHECKLIST.md`](AUDIT_CHECKLIST.md); the contracts themselves are in [`reference/CONTRACTS.md`](reference/CONTRACTS.md).

## Contents

1. [Commands and configuration](#1-commands-and-configuration)
2. [Architecture: mocking the precompiles](#2-architecture-mocking-the-precompiles)
3. [TxFixtures: prover bytes and proof shapes](#3-txfixtures-prover-bytes-and-proof-shapes)
4. [The real-prover-bytes fixture](#4-the-real-prover-bytes-fixture)
5. [Suites and responsibilities](#5-suites-and-responsibilities)
6. [The invariant campaign](#6-the-invariant-campaign)
7. [Fuzz suites and their bounds](#7-fuzz-suites-and-their-bounds)
8. [Gas measurements](#8-gas-measurements)
9. [Worker and bot tests](#9-worker-and-bot-tests)
10. [Scenario scripts](#10-scenario-scripts)
11. [CI](#11-ci)
12. [How to add a test](#12-how-to-add-a-test)

## 1. Commands and configuration

```bash
forge test                                   # all 15 suites, 162 tests
forge test -vv                               # plus the gas prints and the invariant campaign summary
forge test --list                            # every test name by suite
forge test --match-contract KittyLedgerInvariantTest -vv
forge test --match-contract KittyGasTest -vv | grep 'GAS '
forge build --sizes                          # runtime sizes against the 24,576-byte limit
pnpm test:agent                              # worker/test/*.test.ts (node:test via tsx)
pnpm test:bot                                # bot/test/*.test.ts
pnpm scenarios                               # scripts/scenarios.sh: two anvils, 8 attack scenarios
pnpm e2e:local                               # scripts/local-e2e.sh: full local rehearsal
pnpm judge                                   # scripts/judge.sh: everything above plus one live precompile check
```

`foundry.toml` settings that shape the runs:

| Key | Value | Effect |
|---|---|---|
| `solc_version`, `via_ir`, `optimizer_runs`, `evm_version` | `0.8.30`, `true`, `200`, `shanghai` | Tests compile the contracts exactly as deployed. |
| `fs_permissions` | read `./test/fixtures` | Lets `RealProofFixtureTest` call `vm.readFile`. |
| `[fuzz] runs` | 256 | Every `testFuzz_*` runs 256 samples. |
| `[invariant] runs`, `depth` | 32, 160 | 32 sequences of 160 calls; every invariant is checked after every call, so each invariant is evaluated 5,120 times per run (the `calls: 5120` in the output). |
| `[invariant] fail_on_revert` | `true` | Any revert from a handler action fails the campaign. The handler therefore guards its own preconditions and the attacker wraps every hostile call in `try/catch`. |
| `[invariant] call_override` | `false` | No reentrancy overrides; the ledger never calls out to untrusted code. |

## 2. Architecture: mocking the precompiles

`KittyLedger` binds `VERIFIER` and `CHAIN_INFO` to the fixed precompile addresses in its constructor (`NativeQueryVerifierLib.getVerifier()` = `0x…0FD2`, `ChainInfoLib.chainInfo()` = `0x…0fD3`). There is no setter, so every ledger suite's `setUp` puts code at those addresses before deploying:

```solidity
address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
MockVerifier(VERIFIER_PRECOMPILE).setAccept(true);
ledger = new KittyLedger(CHAIN_KEY);          // CHAIN_KEY = 1 (Sepolia)
ledger.setTrustedVault(vault, true);           // vault = address(0xFA11), a bare address
```

Points that follow from this arrangement:

- `vm.etch` copies runtime code, not constructor state. `MockVerifier.accept` is declared `= true` but that initialiser runs only in the throwaway `new MockVerifier()`; the etched copy starts with `accept == false`, which is why `setAccept(true)` is explicit everywhere. `MockChainInfo` has no constructor and derives its default registry (chain keys 1 and 3 exist) from `registrySet == false`.
- The trusted vault in ledger tests is a plain address with no code (`0xFA11`). The ledger never calls the vault; it only compares log emitters and transaction targets against the address, so no `KittyVault` deployment is needed on the Creditcoin side of a test. The vault suites deploy the real `KittyVault` with a real `TestUSD`.
- `MockVerifier` returns `accept` from every `verify` and `verifyAndEmit` overload and counts calls (`batchCalls`, `singleCalls`, `lastBatchSize`). Its `calculateTxIndex` returns the low 16 bits of the Merkle root, so query ids are a function of the fixture seed. It performs no cryptography; what it emulates is the precompile's *interface and control flow* (a boolean verdict, a tx index), not its verification.
- `MockChainInfo` keeps one attested head per chain key. `is_height_attested(k, h)` is `attestedHeight[k] >= h`; `find_lowest_attested_after(k, h)` returns `h` itself with hash `keccak256(abi.encode(k, h))` once attested; `get_latest_attestation_height_and_hash` reports `exists = head > 0`. Tests advance the frontier with `chainInfo.setAttestedHeight(CHAIN_KEY, h)`; the usual idiom before a deadline-path close is `chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(id, r))`, and one block less to assert `RoundStillOpenOnSource`. `KittyMultiChainTest.setUp` calls `chainInfo.initDefaultChains()` and then `setChain` to de-register a chain in `test_unknownChainKeyIsRejectedAtCreation`.
- The full behaviour of both mocks is documented in [`reference/CONTRACTS.md` section 11](reference/CONTRACTS.md#11-test-doubles-mockverifier-and-mockchaininfo). Their limits are explicit: no inclusion or continuity checking, no real tx-index arithmetic ([`THREAT_MODEL.md`](THREAT_MODEL.md), limit 8). The live precompile is exercised by `pnpm verify:live` and the testnet rounds in [`TESTNET_LOG.md`](TESTNET_LOG.md).

The same two mocks are what the local two-anvil scripts install with `anvil_setCode` (`scripts/local-setup.sh`), so the Foundry suites, the scenario runs and the local end-to-end rehearsal share one model of the precompiles.

## 3. TxFixtures: prover bytes and proof shapes

`test/TxFixtures.sol` is a library that builds the three inputs the ledger's proving entry points take: prover `txBytes`, a `MerkleProof` and a `ContinuityProof`.

### 3.1 EvmV1 transaction encoding

The Attestcoin Proof Builder returns each transaction as `abi.encode(uint8 txType, bytes[] chunks)` (`EvmV1Decoder` NatSpec): `chunks[0]` is the common fields `(uint64 nonce, uint64 gasLimit, address from, bool toIsNull, address to, uint256 value, bytes data)`, `chunks[1]` the type-specific fields, and the last chunk the receipt `(uint8 status, uint64 gasUsed, LogEntryTuple[] logs, bytes logsBloom)`. Types 3 and 4 carry an extra middle chunk; the fixtures always build a type-2 (EIP-1559) transaction with three chunks.

`TxFixtures.encode(address from, address to, uint8 status, VaultEvent[] evs)` produces exactly that:

| Chunk | Contents in the fixture |
|---|---|
| `chunks[0]` | `nonce 7`, `gasLimit 120_000`, `from`, `toIsNull false`, `to`, `value 0`, `data 0xdeadbeef` |
| `chunks[1]` | `chainId 11155111`, `maxPriorityFeePerGas 1 gwei`, `maxFeePerGas 30 gwei`, empty access list, `yParity 1`, `r = s = 0` |
| `chunks[2]` | `status`, `gasUsed 60_000`, one `LogEntryTuple` per `VaultEvent`, empty bloom |

Each `VaultEvent{sig, emitter, circleId, round, who, amount}` becomes a log with four topics (`sig`, `bytes32(circleId)`, `bytes32(uint256(round))`, `bytes32(uint256(uint160(who)))`) and `abi.encode(amount)` as data, which is the shape `KittyVault.Contributed` and `PaidOut` have on chain and the shape `_decodeVaultLog` requires. The `from`, `to` and `status` arguments are what the ledger's transaction binding and receipt check read, so the negative fixtures are built by varying them:

| Builder | `from` | `to` | status | Log | Used to reach |
|---|---|---|---|---|---|
| `contribution(vault, member, circleId, round, amount)` | member | vault | 1 | `Contributed` from `vault` | the happy path |
| `contributionSentBy(sender, vault, member, ...)` | sender | vault | 1 | `Contributed` naming `member` | `SenderMismatch` |
| `contributionTo(target, vault, member, ...)` | member | target | 1 | `Contributed` from `vault` | `TxNotToVault` |
| `payout(vault, operator, recipient, circleId, round, amount)` | operator | vault | 1 | `PaidOut` from `vault` | `confirmPayout`, `confirmPayouts` |
| `encode(from, to, 0, evs)` (direct) | any | any | 0 | any | `SourceTxFailed` |
| `encode` with `emitter = mallory` | | | | `Contributed` from an untrusted address | `WrongEmitter` |
| `encode` with two events | | | | genuine plus look-alike | `test_extraContributedLogFromUntrustedEmitterIsIgnored` |

### 3.2 Merkle and continuity proof shapes

`merkle(uint256 seed)` returns `MerkleProof{root: keccak256(abi.encode("root", seed)), siblings: [ {hash: keccak256(abi.encode("sib", seed)), isLeft: seed % 2 == 0} ]}`. `continuity()` returns `ContinuityProof{lowerEndpointDigest: keccak256("lower"), roots: [keccak256("r0")]}`. `MockVerifier` never inspects either; the only property that matters is that `merkle(seed).root` differs per seed, because `calculateTxIndex` takes its low 16 bits and the query id is `keccak256(chainKey || height || txIndex)`.

How suites choose seeds so that query ids stay distinct within a test: `KittyLedgerTest` derives the seed from `keccak256(abi.encode(who, height, round))`; the fuzz, gas, batch-payout and invariant suites keep a `seedNonce` counter and increment it per proof; the attacker uses a counter starting at `1 << 128` so its proofs never collide with the handler's. Because only 16 bits of the root reach the index, two different seeds can still collide at the same height; `KittyLedgerHandler._freshProof` loops until it finds an id that is neither `processedQueries`, nor already handed out (`qidSeen`), nor reserved earlier in the same call (`_reservedQid`). `_attackReplay` deliberately reuses a recorded fixture (height, bytes and proof) to hit `QueryAlreadyProcessed`.

## 4. The real-prover-bytes fixture

`test/fixtures/sepolia-11656295-tx44.json` holds genuine Attestcoin Proof Builder output: `chainKey 1`, `headerNumber 11656295`, `txIndex 44`, the transaction hash, 2,946 hex characters of `txBytes`, the Merkle root, `siblingCount 7`, `continuityRoots 6`, and a note that it is the FakeVault deployment transaction on Sepolia by deployer `0xD793169c516c9F9A334218608fbF6E1338b3DE56`, verified `true` by the live `0x0FD2` precompile on CC3 Testnet on 2026-09-08.

`test/RealProofFixture.t.sol` (`test_realProverBytesDecodeLikeTheLedgerExpects`) reads it with `vm.readFile` and `vm.parseJsonBytes` and runs the same `EvmV1Decoder` calls `_singleLog` and `_recordContribution` make: `getTransactionType == 2`, `isValidTransactionType`, `decodeCommonTxFields` (`from` is the deployer, `toIsNull` is true because it is a contract creation), `decodeReceiptFields` (`receiptStatus == 1`, zero logs), and `getLogsByEventSignature(receipt, CONTRIBUTED_SIG)` returning an empty array. Its purpose (NatSpec): "Guards against drift between our hand-built test fixtures and the production encoding." It does not call the ledger; the ledger would reject this transaction with `ExpectedExactlyOneLog(0)`, which the test states in a comment.

## 5. Suites and responsibilities

Counts are from `forge test --list`.

| File | Contract | Tests | Responsibility | Notable tests |
|---|---|---:|---|---|
| `test/KittyLedger.t.sol` | `KittyLedgerTest` | 36 | The core ledger: a 3-member circle (`Lagos Susu`, 100e6, 50 blocks, start 1,000). Creation bounds, batch prologue, precompile rejection, every decoding and binding check, the attestation clock and grace window, rotation edge cases, payout confirmation, the score formula, consent, attestation evidence. | `test_batch_recordsWholeRoundInOnePrecompileCall`, `test_rejectsSpoofedEmitter`, `test_rejectsPaymentSentByAnotherAddress`, `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace`, `test_closeRound_recordsAttestationEvidence`, `test_listedButUnconsentedMemberIsNeverPenalised`, `test_finalRound_fallbackPaysAPayer`, `test_potCarriesOverToNextRound` |
| `test/KittyInvites.t.sol` | `KittyInvitesTest` | 16 | Open-invite circles: organiser-only membership at creation, EIP-191 invite digests, every `redeemInvite` guard, `closeInvites`, no recording while open, the consent trap through a past start. | `test_redeemInvite_validSignatureJoins`, `test_redeemInvite_cannotBeGriefedByPastStart`, `test_redeemInvite_rejectsWrongSigner`, `test_recordContributions_revertsWhileOpen`, `test_openCircle_fullLifecycleAfterClose` |
| `test/KittyMultiChain.t.sol` | `KittyMultiChainTest` | 14 | One ledger, two source chains (keys 1 and 3 via `initDefaultChains`). Per-circle chain key, per-chain vault trust, proofs bound to the circle's chain, the deadline clock reading the circle's chain, cross-circle batches, the widened `IChainInfo` surface against the mock. | `test_sepoliaBatchCannotFeedAMainnetCircle`, `test_vaultTrustedOnAnotherChainIsNotAValidEmitter`, `test_closeRoundUsesTheCirclesOwnChainForAttestation`, `test_crossCircleBatchSharesOnePrecompileCall`, `test_crossChainBatchIsRejectedWholesale` |
| `test/KittyRotation.t.sol` | `KittyRotationTest` | 4 | `ByScore` rotation and the `setRotation` lock. | `test_byScore_missingMemberGoesLast_andEveryoneReceivesOnce`, `test_byScore_higherHistoryBeatsIndexOrder` |
| `test/KittyBatchPayout.t.sol` | `KittyBatchPayoutTest` | 9 | `confirmPayouts`: two circles closed in `setUp`, one continuity proof for both payouts, atomic revert on a mismatch, replay across the single and batch entry points, in-batch duplicates, open rounds, chain binding. | `test_twoClosedRoundsConfirmedInOneCall`, `test_mismatchedAmountRevertsTheWholeBatch`, `test_replayOfAConfirmedPayoutIsRejected`, `test_payoutBatchIsBoundToTheCirclesChain` |
| `test/KittyViewer.t.sol` | `KittyViewerTest` | 6 | `getCircleFull` before and after batches and closes, completed circles, unknown ids; `getMemberDashboard` statuses across circles and for strangers. | `test_getCircleFull_matchesLedgerAfterBatchAndClose`, `test_getMemberDashboard_statusesAcrossCircles` |
| `test/KittyCreditLine.t.sol` | `KittyCreditLineTest` | 12 | Underwriting tiers, cap, tier D with a miss, borrow and repay with the 5% fee, liquidity and entitlement bounds, share-unit pricing. History is produced through the real ledger path ("never by poking storage", per its NatSpec). | `test_tierA_fourteenOnTime_is100pct`, `test_tierD_withMissed_isZero`, `test_secondLpDoesNotCaptureEarlierFees`, `test_liquidityConstraints` |
| `test/KittyBadge.t.sol` | `KittyBadgeTest` | 6 | Claim gating, one badge per address, soulbound transfers and approvals, `locked`, live `tokenURI` (decoded with an in-test base64 decoder). | `test_claimMintsOneSoulboundBadge`, `test_transfersAndApprovalsRevert`, `test_tokenURIReflectsLiveScore` |
| `test/KittyVault.t.sol` | `KittyVaultTest` | 4 | The real vault with `TestUSD`: escrow and event, zero amount, operator-only once-per-round payout to contributors, event signatures equal the ledger's constants. | `test_payout_onlyOperatorOncePerRound`, `test_eventSignaturesMatchLedgerConstants` |
| `test/FakeVault.t.sol` | `FakeVaultTest` | 1 | The spoof event is shape-identical to the real one, so only emitter binding saves the ledger. | `test_emitsExactContributedShape` |
| `test/RealProofFixture.t.sol` | `RealProofFixtureTest` | 1 | Section 4. | |
| `test/KittyLedgerFuzz.t.sol` | `KittyLedgerFuzzTest` | 12 | Section 7. | |
| `test/KittyVaultFuzz.t.sol` | `KittyVaultFuzzTest` | 8 | Section 7. | |
| `test/invariant/KittyLedger.invariant.t.sol` | `KittyLedgerInvariantTest` | 10 | Section 6. | |
| `test/KittyGas.t.sol` | `KittyGasTest` | 23 | Section 8. | |

Total: 162 tests, 15 suites (`Ran 15 test suites ... 162 tests passed, 0 failed, 0 skipped`).

## 6. The invariant campaign

Files: `test/invariant/KittyLedger.invariant.t.sol` (the properties), `test/invariant/KittyLedgerHandler.sol` (valid actions and ghost state), `test/invariant/KittyLedgerAttacker.sol` (calls that must revert).

### 6.1 Setup and targeting

`setUp` etches the mocks, deploys `KittyLedger(1)`, a handler and an attacker, trusts the handler's `vault` (`0xFA11`), and registers both as target contracts. The sampler is weighted with duplicated selectors: 13 handler selectors of which `recordContributions` and `closeRound` appear three times each ("weight the sampler toward the proof/close loop, which is where the accounting lives"), plus the attacker's single `attack` selector. Ten actors are derived from private keys `0xA0000 + i` so the handler can sign invites for any organiser; `mallory = 0xBAD` is the outsider that must never gain history; `operator = 0x0BE7` is the `from` of payout fixtures.

### 6.2 Handler actions

Every action increments `calls[name]` and returns early when its preconditions are not met, so the campaign never reverts.

| Action | Bounds and behaviour |
|---|---|
| `createCircle(seed, nMembers, roundBlocks, startOffset, amount, byScore, acceptMask)` | At most `MAX_CIRCLES = 6` circles per run. Three in four circles have 2 to 4 members (`2 + nMembers % 3`), the rest `bound(nMembers, 2, 10)`; `roundBlocks` in `[1, 2^20]`; `startHeight = frontier + bound(startOffset, 0, 2^20)` so creation never trips the round-0 bound; `amount` in `[1, 1e30]`; members are a window of the actor ring; organiser is another actor; optional `setRotation(ByScore)`; `acceptMask` selects which listed members call `acceptMembership`. |
| `createOpenCircle(seed, maxMembers, roundBlocks, startOffset, amount)` | Same bounds; `maxMembers` chosen like `nMembers`. |
| `redeemInvite(seed, circleSel)` | Picks an open circle with room, an actor who is not yet a member, signs `inviteDigest` with the organiser's key (`vm.sign`), redeems with a fresh nonce. |
| `closeInvites(circleSel, byScore)` | Open circle with at least 2 members; optionally switches to `ByScore` first. |
| `acceptMembership(seed, circleSel)` | A random member of a closed-invite circle opts in (idempotent). |
| `advanceFrontier(delta)` | `frontier += bound(delta, 0, 2^18)`; written to the mock. |
| `recordContributions(circleSel, mode, mask, lateMask, heightSeed)` | On an active circle with invites closed. `mode % 4`: 0, `mask` selects still-unpaid members (at least one); 1, everyone unpaid pays (enables an early close); 2, only members who already received pay (sets up carry-over and fallback); 3, exactly one member pays. Heights: on time in `[max(startHeight, deadline - jitter), deadline]`, late in `[deadline + 1, deadline + 1 + roundBlocks]` with `jitter < roundBlocks + 1`. One `recordContributions` call per action, so batch sizes 1 to 10 are exercised; the effect counters bucket them as `batch=1`, `batch=2..3`, `batch>=4`. Each proof and its fixture are appended to `usedFixtures` for the attacker's replay. |
| `closeRound(circleSel, viaDeadline)` | If the round is partial and `viaDeadline` is false, return; otherwise jump the frontier to `closeHeight` when needed, snapshot `hadReceived` and `paid` per member, add a ghost miss for every unpaid *accepted* member, close, then compare the ledger's recipient with `_expectedRecipient` (the documented rotation rule, evaluated with post-close scores and pre-close `receivedPot`, with the final-round fallback) and flag any disagreement; on the final round store `snapshotCircle(id)`. |
| `confirmPayout(circleSel, roundSel, heightSeed)` | Walks forward from a random round to one that is `Closed` with a recipient, builds a `payout` fixture for exactly `(recipient, pot)` and proves it with the single entry point. |

### 6.3 Ghost variables

| Ghost | Meaning |
|---|---|
| `circles[]` | Every circle id the handler created. |
| `recorded[]` of `Rec{circleId, round, member, height, qid}` | Every contribution the handler recorded, in order. |
| `ghostContribCount[c][r][m]` | How many times the handler recorded `m` in `(c, r)`; must never exceed 1. |
| `qids[]`, `qidSeen[qid]` | Every query id the handler spent (contributions and payouts) and how often. |
| `ghostOnTime[m]`, `ghostLate[m]`, `ghostMissed[m]`, `ghostReceived[m]`, `ghostVolume[m]` | Expected `MemberRecord` counters per actor, maintained by the handler's own reading of the rules. |
| `ghostClosedByDeadline[c][r]`, `ghostCloseFrontier[c][r]` | Whether a round closed on the deadline path and where the frontier stood. |
| `ghostFallback[c][r]` | Whether the recipient came from the final-round fallback. |
| `ghostPaid[c][r]` | Whether the handler proved a payout for the round. |
| `completedSnapshot[c]` | `keccak256` of the circle struct, every round's `(contributions, pot, recipient, attestedCloseHeight, attestedCloseHash)`, every contribution and every `receivedPot` flag, taken at completion. `status` and `payoutQueryId` are excluded because a payout may legitimately be proven after completion. |
| `recipientViolation`, `recipientViolationLabel` | Set by the handler when the ledger's recipient disagrees with the rotation oracle, is not a member, did not pay, or had already received outside the fallback. |
| `frontier` | The handler's mirror of `MockChainInfo.attestedHeight[1]`. |
| `usedFixtures[]` | `(height, encodedTx, proof)` of every recorded contribution, for replay attacks. |
| `calls[label]`, `effects[label]` | Dispatch and effect counters printed by `invariant_callSummary`. |

### 6.4 The attacker

`attack(uint8 kind, uint256 seed)` bounds `kind` to `0..9` and fires one hostile call at whatever state the handler has built, catching the revert. If a call succeeds, `attackSucceeded` is set with a label and `invariant_attacksAlwaysRevert` fails. Attacks must revert *before* any query id is stored, which is why the attacker's `_freshProof` never records ids.

| Kind | Attack | Expected rejection |
|---:|---|---|
| 0 | Replay a fixture the handler already recorded | `QueryAlreadyProcessed` |
| 1 | `Contributed` log emitted by `mallory` instead of the vault | `WrongEmitter` |
| 2 | Amount off by one (or 2 when the installment is 1) | `WrongAmount` |
| 3 | Contribution by an actor who is not a member (or `mallory`) | `NotAMember` |
| 4 | Second contribution by a member who already paid this round | `AlreadyContributed` |
| 5 | `closeRound` on a `Completed` circle, on an open-invite circle, or on a partial round before the frontier reached `closeHeight` | `CircleNotActive`, `CircleStillOpen`, `RoundStillOpenOnSource` |
| 6 | `setRotation` by a non-organiser; by the organiser after the first proof | `NotOrganiser`, `RotationLocked` |
| 7 | Invite signed by `mallory`'s key | `InvalidInviteSigner` |
| 8 | `confirmPayout` with `pot + 1`; with the right amount to `mallory` | `PayoutMismatch` (or `NoRecipient` for a round without one) |
| 9 | Contribution tagged `currentRound + 1`; contribution at `startHeight - 1` | `NotCurrentRound`, `BeforeCircleStart` |

### 6.5 The invariants, stated

Each holds after every call of every sequence. `last(c)` is `members.length - 1` for a `Completed` circle and `currentRound` otherwise.

- **`invariant_oneContributionPerSlot`.** For every handler circle `c`, round `r <= last(c)`, member `m`: `ghostContribCount[c][r][m] <= 1`, and `getContribution(c, r, m).queryId != 0` iff the ghost count is 1. `getRound(c, r).contributions` equals the number of members with a contribution. For an `Active` circle, every round after `currentRound` has `contributions == 0`.
- **`invariant_potAccounting`.** Walking rounds `0..last(c)` with a running `carry`: `expected = contribution * contributions + carry`. If the round is closed with `recipient == 0` and is not the final round, `pot == 0` and `carry = expected`; otherwise `pot == expected` and `carry = 0`. A closed round with `recipient == 0` is never `Paid`. For an `Active` circle, every round after `currentRound` has `pot == 0`.
- **`invariant_scoreFormulaAndCounters`.** For every actor: `onTime`, `late`, `missed`, `received` and `volume` in `getRecord` equal the ghosts; `creditScore` equals `clamp(500 + 15*onTime - 20*late - 120*missed, 300, 850)`; the tier is `A`/`B`/`C`/`D` at the 700/600/500 thresholds. `mallory`'s record is all zero.
- **`invariant_recipientEligibility`.** `recipientViolation` is false. For every closed round with a recipient: the recipient is a member, has `receivedPot`, has a contribution for that round, and `contributions > 0`; if `ghostFallback[c][r]` then `r + 1 == n`. Each member is the recipient of at most 2 rounds, and of 2 only when the final round used the fallback; `receivedPot[c][m]` iff the member won at least once. An `Open` round has `recipient == 0`.
- **`invariant_roundBoundsAndCompletionFrozen`.** `1 <= n <= MAX_MEMBERS`; `currentRound < n`; a closed-invite circle has `n >= 2`; an open circle has `n <= maxMembers`, `currentRound == 0` and no round-0 contributions; a closed-invite circle has `maxMembers == n`. A `Completed` circle has `currentRound == n - 1`, every round non-`Open`, and `snapshotCircle(c) == completedSnapshot[c]`. An `Active` circle has every round before `currentRound` non-`Open` and the current round `Open`. `circleCount` equals the number of handler circles.
- **`invariant_heightsWithinCircle`.** For every recorded contribution: the stored `height` and `queryId` equal the ghost's; `height >= startHeight`; `onTime == (height <= deadlineHeight(c, r))`.
- **`invariant_queryIdsUnique`.** Every query id in `qids` was seen exactly once and is `processedQueries`.
- **`invariant_attacksAlwaysRevert`.** `attacker.attackSucceeded()` is false (the message is the attack label).
- **`invariant_closeEvidence`.** For every closed round: if it closed on the deadline path, `attestedCloseHeight == closeHeight(c, r)`, `attestedCloseHash == keccak256(abi.encode(1, closeHeight))`, `closeHeight <= ghostCloseFrontier`, and `contributions < n`; otherwise `contributions == n` and both evidence fields are zero. If `status == Paid` then `ghostPaid`, `payoutQueryId != 0` and it is `processedQueries`; otherwise `payoutQueryId == 0` and not `ghostPaid`.
- **`invariant_callSummary`.** Not a property: prints the effect counters so a reviewer can see what the campaign reached.

A run at the time of writing printed: 6 circles created, 6 invites redeemed, 4 invite closes, 32 contributions recorded (12 batches of size 1, 5 of size 2 to 3, 2 of size 4 or more), 18 rounds closed (7 early, 11 on the attested deadline, 2 ByScore picks, 0 carry-overs, 1 final-round fallback, 2 stranded final rounds), 6 circles completed, 10 payouts confirmed, 14 attack calls. The counters are for the last sequence only and vary with the seed; the coverage that matters is that the rare branches (fallback, stranded final round, deadline close) are reached at all.

## 7. Fuzz suites and their bounds

`test/KittyLedgerFuzz.t.sol` (12 tests, 256 runs each). Constants mirror `_initCircle`: `MAX_START = type(uint64).max / 4`, `MAX_ROUND_BLOCKS = 2^40`, `GRACE = 64`, `RECORDS_SLOT = 6`. `_setRecord` injects counters by `vm.store` and re-reads them through `getRecord`.

| Test | Inputs and bounds | Property |
|---|---|---|
| `testFuzz_deadlineAndCloseHeight_fullRange` | `startHeight` in `[0, MAX_START]`, `roundBlocks` in `[1, MAX_ROUND_BLOCKS]`, `n` in `[2, 10]`, `round` in `[0, n-1]` | `deadlineHeight == start + (round + 1) * roundBlocks` without overflow; `closeHeight = deadline + 64`; consecutive rounds differ by `roundBlocks`; round 0 ends after the start. |
| `test_deadlineHeight_worstCaseFits` | max start, max round length, 10 members | `closeHeight(id, 9) == MAX_START + 10 * 2^40 + 64` (the reason for the constructor bounds). |
| `testFuzz_createCircle_rejectsOutOfRangeHeights` | `vm.assume` either bound violated and `roundBlocks != 0` | `InvalidCircle("height range")`. |
| `testFuzz_creditScore_formulaAndClamp` | three full `uint32` counters | Formula, clamp, tiers. |
| `testFuzz_creditScore_monotone` | counters in `[0, 2^32 - 2]` | More on-time never lowers; more late or missed never raises; a miss costs at least as much as a late payment. |
| `testFuzz_byScore_picksHighestEligible_tiesByLowestIndex` | `n` in `[2, 10]`, random payer mask (at least one), per-member injected counters (`onTime % 30`, `late % 12`, `missed % 5`) | The recipient is the highest-scoring payer; ties go to the lowest index; `receivedPot` and `received` update. |
| `testFuzz_fixed_picksLowestIndexPayer` | same shape | Round 0 under `Fixed` picks the lowest-index payer regardless of score. |
| `testFuzz_everyoneReceivesExactlyOnce` | `n` in `[2, 10]`, `byScore` flag, injected counters | With everyone paying every round, no member receives twice, everyone receives once, the circle completes. |
| `testFuzz_graceWindowBoundary` | `startHeight` in `[0, 2^60]`, `roundBlocks` in `[1, 2^30]` | Payment at `deadline` is on time, at `deadline + 1` late; frontier at `closeHeight - 1` cannot close (`RoundStillOpenOnSource`), at `closeHeight` can, and records `attestedCloseHeight == closeHeight`. |
| `testFuzz_fullRoundClosesRegardlessOfFrontier` | any `uint64` frontier | A full round closes with zero evidence. |
| `testFuzz_startHeightBoundAgainstFrontier` | `frontier` any `uint64`, bounded start and round length | Creation succeeds iff `startHeight + roundBlocks > frontier` when the frontier exists (`> 0`). |
| `testFuzz_contributionHeightVsStart` | `startHeight` in `[1, 2^60]`, `height` any `uint64` | `height < startHeight` reverts `BeforeCircleStart`; otherwise recorded with the right `onTime`. |

`test/KittyVaultFuzz.t.sol` (8 tests, 256 runs each) runs the real `KittyVault` with `TestUSD`; `_fund` mints and approves. Amounts are `uint128` (bounded to `[1, 2^128 - 1]`, halved in `paidOutIsPermanent` so two fit) and circle ids are arbitrary `uint256`.

| Test | Property |
|---|---|
| `testFuzz_contribute_accumulatesPotAndFlagsContributor` | Eight contributions by four actors: zero amounts revert `ZeroAmount`, the pot is the sum, every payer is a contributor, the vault's token balance equals the pot. |
| `testFuzz_contribute_isolatesCircles` | Two circles (`a != b`) keep separate pots and contributor sets. |
| `testFuzz_payout_onlyToContributors` | A non-contributor recipient reverts `NotAContributor` and leaves `pot` and `paidOut` untouched; the contributor is paid. |
| `testFuzz_payout_contributorStatusIsPerCircle` | Paying into circle `a` does not qualify for circle `b`'s pot. |
| `testFuzz_payout_onlyOperator` | Any non-operator caller reverts `NotOperator`. |
| `testFuzz_payout_paidOutIsPermanent` | After one payout for `(circle, round)`, any second payout reverts `AlreadyPaid` whatever the recipient or amount; `round + 1` is a fresh slot. |
| `testFuzz_payout_amountBounds` | `0` reverts `ZeroAmount`, `> pot` reverts `InsufficientPot`, otherwise `pot` decreases and the recipient's balance rises by exactly `amount`; escrow always equals the pot. |
| `testFuzz_payout_neverExceedsCircleEscrow` | Six payout attempts across rounds never release more than was escrowed and never touch another circle. |

## 8. Gas measurements

`test/KittyGas.t.sol` (23 tests) is the source of the tables in [`GAS.md`](GAS.md). The methodology, from its NatSpec: `setUp` (its own transaction) prepares every scenario; each test body then makes exactly one external call and prints its execution gas as the `gasleft()` delta around the call, which includes the CALL and excludes the 21,000 intrinsic cost and calldata. Storage is therefore cold, as in a real transaction. The precompiles are mocks, so ledger figures are the contract's own cost on top of verification; the live precompile figures are in `GAS.md` and the README.

Scenarios prepared in `setUp`: early closes under `Fixed` and `ByScore`; deadline closes with 2 and with 9 misses (all members consented); a final-round close; batches of 1, 3 and 10 with members who have no record yet, and of 1 and 10 with members who already hold a record; a single payout and a batch of 3 payouts; an open circle with a pre-signed invite; a listed circle for `acceptMembership` and `setRotation`; and a real `KittyVault` with two funded members for the four vault measurements. Two start heights keep the scenarios apart: `START_EARLY = 1_000` circles get their close height attested in `setUp`, `START_LATE = 10_000` circles do not.

Regenerate and compare with:

```bash
forge test --match-contract KittyGasTest -vv | grep 'GAS '
forge snapshot            # per-test totals in .gas-snapshot
forge test --gas-report   # min / avg / max per function across the whole suite
```

The `GAS ` lines printed at the time of writing match `GAS.md` exactly.

## 9. Worker and bot tests

Both are plain `node:test` suites run through `tsx` with no network, no anvil and no API key.

`pnpm test:agent` runs `worker/test/*.test.ts` (29 tests):

- `worker/test/policy.test.ts` (17 tests) exercises `decideBatch`, `explainBatch`, `slack` and `provable` from `worker/src/agent/policy.ts` with hand-built pending payments and a frontier: waits while nothing is attested; waits for a fuller batch when there is slack and the window has not elapsed; fires immediately on a complete round; fires on deadline risk with an unfull batch; caps at ten and takes the most urgent first; batches across circles under one chain key; never mixes chain keys and serves the most urgent chain; reads the attestation frontier, not the clock; never pools payments more than 1000 blocks apart; counts only rounds fully inside the batch; duplicate payments by one member do not complete a round; fires once the window has elapsed; a forced pass fires whatever is provable; equal slack prefers the larger group; and the three roundmate-hold tests (holds with ample slack, does not hold when slack is short, never overrides `round-complete`, `full` or `forced`). The constants under test (`MAX_BATCH`, `MAX_BATCH_RANGE`, `URGENT_BLOCKS`, `ATTESTATION_LAG_BLOCKS`) are imported from the policy module, so a change there changes the test's expectations with it.
- `worker/test/citations.test.ts` (12 tests) exercises the citation validator and the explainer fallback: cited and verifiable sentences are kept; a sentence citing a value the chain does not have is stripped; an uncited figure is stripped even when true; a truncated hash prefix is accepted against the full hash; a plausible-looking hash is rejected; separators and units around a number are tolerated; prose without figures passes; a fabricated paragraph is removed entirely; `explain` falls back to the deterministic sentence with no API key; an empty log never reaches the model; a fake address is not rescued by the numeric fallback (the `0x…` stripped to `"0"` regression); a short hex citation is never accepted as a prefix.

`pnpm test:bot` runs `bot/test/format.test.ts` (11 tests) against `bot/src/format.ts` and `bot/src/chain.ts`: `describe()` matches the dashboard feed wording for `ContributionRecorded`, `BatchVerified` and `ContributionMissed`; `formatEvent` carries the circle, the Creditcoin transaction and the proof links, falls back to bare hashes without an explorer, and escapes circle names for Telegram HTML; `formatCircle` shows the round, the deadline against the attested frontier, per-member proof status and the next recipient, including closed rounds and completed circles; `pickRecipient` mirrors `KittyLedger._pickRecipient`; `formatScore`, `formatSteward`, `formatReminder` and `formatStart` render their messages.

## 10. Scenario scripts

All local scripts source `scripts/local-setup.sh`, which starts two anvils (Sepolia stand-in on 8545 with chain id 11155111, Creditcoin stand-in on 8546 with chain id 102031, one block per second), deploys every contract with `forge create` from anvil account 0, trusts the vault on the ledger for chain key 1, seeds the credit pool with 50,000 kUSD, installs `MockVerifier` and `MockChainInfo` at the precompile addresses with `anvil_setCode`, sets `accept = true`, and writes `web/.env.local`. In this world the worker's local mode still runs the SDK's `encoding.abiEncode` on the anvil's real transactions and receipts (`worker/src/proofs.ts`, `localBatch`), so the ledger's `EvmV1Decoder` path sees genuine bytes even though verification is mocked. The attested frontier is moved by hand: `attest <height>` in the scripts is `cast send 0x…0fD3 "setAttestedHeight(uint64,uint64)" $SOURCE_CHAIN_KEY <height>`.

`scripts/scenarios.sh` (`pnpm scenarios`): funds three members, creates a 3-member circle with 40-block rounds, has everyone contribute, attests the source head, runs `pnpm worker --once` so round 0 is proven in one batch, then runs each of the eight scenarios in `worker/src/scenarios.ts` in turn (`replay`, `wrongChain`, `revertedTx`, `late`, `spoofEmitter`, `stealFromSteward`, `fireTheAgent`, `poisonReasoning`), re-attesting the source head before each, and exits with the number of failures. What each proves and the exact expected answer are tabulated in [`THREAT_MODEL.md` section 5](THREAT_MODEL.md#5-the-eight-attack-scenarios); the `expected` strings in the `SCENARIOS` registry of `worker/src/scenarios.ts` are `QueryAlreadyProcessed`, `WrongEmitter`, `WrongChain` (or the precompile's continuity rejection on the live network), `SourceTxFailed`, "every privileged call reverts", "a stranger's proof is accepted", "fabricated sentences stripped" and `ContributionRecorded onTime=false`. This is the script CI runs.

`scripts/local-e2e.sh` (`pnpm e2e:local`) is the rehearsal of the whole flow: round 0 with everyone paying, attested and proven by `pnpm worker --once`; round 1 with member 2 skipping, the close height (`cast call closeHeight(1, 1)`) attested, and the worker closing the round on the deadline; the replay attack (`worker/src/attack.ts`, which runs the `replay` scenario and must see the ledger reject it); and a credit-line smoke check that reads `creditLimit` and `underwrite` for member 0 (two on-time proofs) and member 2 (one on-time, one missed) and fails if member 0 has no credit. It proves that the worker, the SDK encoding, the vault, the ledger and the credit line agree end to end without the network.

Related scripts: `scripts/local-lab.sh` (`pnpm e2e:lab`) is the same world with the scenarios recorded for the `/lab` page and the lab API left running; `scripts/local-world.sh` brings the world up with one proven round and leaves it running for the dashboard; `scripts/judge.sh` (`pnpm judge`) chains `forge test`, `pnpm test:agent`, `pnpm scenarios`, `scripts/local-e2e.sh` and one `pnpm verify:live` of three real Sepolia transactions against the live `0x0FD2` on CC3 Testnet (skipped without internet). Operational details are in [`OPERATIONS.md`](OPERATIONS.md).

## 11. CI

`.github/workflows/ci.yml` runs on every push and pull request with two jobs.

`contracts` (ubuntu-latest, Node 22 with pnpm, Foundry via `foundry-rs/foundry-toolchain@v1`):

1. `pnpm install --frozen-lockfile`
2. `forge build --sizes` (fails the build if any contract exceeds the size limit)
3. `forge test -vv` (all 15 suites including fuzz, invariants and gas prints)
4. `pnpm typecheck` (`tsc` over `worker/` and `bot/`)
5. `pnpm test:agent`
6. `pnpm test:bot`
7. `pnpm scenarios` with a 20-minute timeout (two anvils in the runner, mocked precompiles)

`web` (ubuntu-latest): `pnpm install --frozen-lockfile` and `pnpm build` in `web/`.

Nothing in CI touches the public testnets; the live precompile check is the manual last step of `scripts/judge.sh`.

## 12. How to add a test

### 12.1 A new ledger rule

Suppose a new check is added to `_recordContribution` with a new custom error.

1. **Unit test** in `test/KittyLedger.t.sol`. Build the offending transaction with `TxFixtures` (add a builder to `test/TxFixtures.sol` if the existing `from`/`to`/`status`/event knobs cannot express it), wrap it with `_h(height)` and a `merkle` proof, and assert the exact selector:

   ```solidity
   function test_rejectsNewRule() public {
       bytes[] memory txs = new bytes[](1);
       txs[0] = TxFixtures.contribution(vault, alice, circleId, 0, AMOUNT); // or a new builder
       INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](1);
       ps[0] = TxFixtures.merkle(1);
       vm.expectRevert(abi.encodeWithSelector(KittyLedger.NewRuleError.selector, /* args */));
       ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, ps, TxFixtures.continuity());
   }
   ```

   Prefer `abi.encodeWithSelector` over a bare `vm.expectRevert()` so the test pins the error, not merely a revert. If the rule depends on the frontier, set it with `chainInfo.setAttestedHeight`.

2. **Keep the invariant campaign green.** `fail_on_revert = true` means the handler must never trip the new rule by accident. Add the guard to the handler action that could (usually `recordContributions`: filter `who[]` or adjust `heights[]`), and update the ghost accounting if the rule changes what is recorded.

3. **Give the attacker the negative.** Add a `_attackNewRule(seed)` branch in `KittyLedgerAttacker.attack`, raise the `bound(kind, 0, 9)` upper limit, build the hostile fixture and pass it to `_mustRevertRecord(height, tx_, "label")`. The label is what `invariant_attacksAlwaysRevert` prints if the ledger ever accepts it.

4. **Consider a fuzz test** in `test/KittyLedgerFuzz.t.sol` when the rule is a boundary over numbers (heights, amounts, counts): bound the inputs with `bound(...)` to the ranges `_initCircle` admits and assert both sides of the boundary, as `testFuzz_contributionHeightVsStart` does.

5. **Update the documents that enumerate checks**: the numbered table in [`TECH.md`](TECH.md), [`specs/PROTOCOL.md`](specs/PROTOCOL.md) section 5.11 and the error catalogue, [`THREAT_MODEL.md`](THREAT_MODEL.md), [`AUDIT_CHECKLIST.md`](AUDIT_CHECKLIST.md), and [`reference/CONTRACTS.md`](reference/CONTRACTS.md). Check `forge build --sizes` afterwards: `KittyLedger` has 2,270 bytes of headroom ([`reference/STORAGE_LAYOUT.md`](reference/STORAGE_LAYOUT.md)).

### 12.2 A new attack scenario

An attack scenario has two homes: the Foundry attacker (fast, mocked, runs on every `forge test`) and the worker's scenario runner (real transactions on two anvils, recorded for the `/lab` page, runs in CI through `pnpm scenarios`).

1. **Foundry.** Add a branch to `KittyLedgerAttacker.attack` as in 12.1 step 3. Pick the target state with `handler.pickCircle(seed, wantOpen)` or `handler.pickActiveClosedInvites(seed)`, return early if the state does not exist yet, wrap the call in `try/catch`, and call `_flagAttack(label)` on success. Use `_freshProof` for proofs so the attack never collides with a handler query id.

2. **Worker scenario.** In `worker/src/scenarios.ts`, add a `ScenarioMeta` entry to `SCENARIOS` (`name`, `title`, `expected`, `description`) and an implementation in the `scenarios` record that builds the hostile transaction on the source anvil, fetches or builds its proof, submits it to the ledger, and returns `ok` when the revert reason starts with `expected` (the `wrongChain` scenario shows how to accept either the ledger's error or the precompile's). Add the name to the loop in `scripts/scenarios.sh` so CI runs it; `worker/src/record-lab.ts` iterates `SCENARIOS`, so the lab recording (`pnpm lab:record`, run by `scripts/local-lab.sh`) picks the new entry up without further changes.

3. **Documents.** Add a row to the scenario table in [`THREAT_MODEL.md`](THREAT_MODEL.md) section 5 and to the threat table row it demonstrates.

### 12.3 A new invariant

1. **Ghost state.** Decide what the handler must remember for the property to be checkable. Add the variable(s) to `KittyLedgerHandler` and update them in the action(s) that change the underlying state, next to the existing ghosts (for example, `ghostClosedByDeadline` is written in `closeRound` immediately after the ledger call). Keep the handler under the EIP-170 limit: it is at 23,143 bytes, so a large addition may need to move into the attacker or a new target contract.

2. **The property.** Add an `invariant_<name>()` view function to `KittyLedgerInvariantTest` that iterates `handler.circles(i)` for `i < handler.circlesLength()` (or `handler.actors(i)`, or `handler.recorded(i)`) and compares ledger state to the ghost with `assertEq`/`assertTrue` and a message. Use `_lastRound(c)` to bound the round loop so `Completed` circles are walked fully. State the property in the function's comment in the same form as the existing ones (a universally quantified sentence over circles, rounds and members).

3. **Reachability.** Run `forge test --match-contract KittyLedgerInvariantTest -vv` and read `invariant_callSummary`. If the branch the property guards is not reached (its effect counter is zero), add a handler mode that sets it up, the way `recordContributions` mode 2 exists only to reach carry-over and fallback, and add an `effects[...]` counter so the summary shows it.

4. **Register it.** Add the invariant to the list in [`specs/PROTOCOL.md`](specs/PROTOCOL.md) section 11 with the test name, and to section 6.5 of this document.
