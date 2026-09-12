# Kitty Audit Checklist

A reviewer's list, grouped by contract and by worker component. Each item points at the function or line that implements it and at the test that covers it; items with no test say `not covered`. Line numbers refer to the files at the time of writing; use the function name if they drift. Foundry tests live in `test/*.t.sol` (109 tests in the 11 suites reviewed here, 162 in total; the fuzz, invariant and gas suites `test/KittyLedgerFuzz.t.sol`, `test/KittyVaultFuzz.t.sol`, `test/invariant/` and `test/KittyGas.t.sol` were added after this review and are not indexed below), worker tests in `worker/test/*.test.ts`, scenarios in `worker/src/scenarios.ts`.

Tick each box only after reading the code at the pointer and running the named test.

## 1. Contract inventory

- [ ] `src/asc/KittyLedger.sol` (`Ownable`), constructor `KittyLedger(uint64 sourceChainKey)`
- [ ] `src/source/KittyVault.sol` (`Ownable`, `ReentrancyGuard`), constructor `KittyVault(IERC20 token, address operator_)`
- [ ] `src/asc/KittyViewer.sol`, `src/asc/KittyCreditLine.sol` (`ReentrancyGuard`), `src/asc/KittyBadge.sol` (`ERC721`, `IERC5192`), `src/asc/KittyUSD.sol`, `src/source/TestUSD.sol`, `src/source/FakeVault.sol`
- [ ] `src/interfaces/IChainInfo.sol` tuple layouts match the precompile ABI (`HeightHash` = `(uint64,bytes32,bool,bool)`, `BoundsCheck` = `(uint64,bytes32,bool,uint64,bytes32,bool,bool)`), snake_case names preserved. Exercised against the mock in `test_chainInfoRegistryIsReadableThroughTheInterface`, `test_attestationBoundsAnswerWhenAPaymentBecomesProvable`; not verified against the live precompile ABI by a test (the live reads in `web/src/hooks.ts` and `worker/src/config.ts` use the same signatures)
- [ ] Dependencies pinned: `@openzeppelin/contracts@5.4.0`, `@gluwa/asc-contracts@0.2.1`, `@gluwa/usc-sdk@0.18.0`, `solc 0.8.30`, `via_ir = true`, `evm_version = "shanghai"` (`foundry.toml`, `package.json`)

## 2. KittyLedger

### 2.1 Access control

- [ ] `setTrustedVault(uint64,address,bool)` is `onlyOwner` (line 392) and the 2-argument overload routes through it (line 402). Tests: `test_vaultTrustIsPerChain`, `test_singleArgSetTrustedVaultTargetsTheDefaultChain`; scenario `stealFromSteward` (`OwnableUnauthorizedAccount`)
- [ ] `setRotation` and `closeInvites` check `msg.sender == c.organiser` (lines 384, 414). Tests: `test_setRotation_onlyOrganiserAndOnlyBeforeFirstProof`, `test_closeInvites_onlyOrganiser`
- [ ] `acceptMembership` requires `isMember` (line 408). Test: implicit in `test_listedButUnconsentedMemberIsNeverPenalised` and `test_closeRound_recordsAttestationEvidence` (happy path); the `NotAMember` revert from this function is not covered
- [ ] `recordContributions`, `confirmPayout`, `confirmPayouts`, `closeRound`, `redeemInvite`, `createCircle`, `createOpenCircle` have no caller restriction by design. Scenario `fireTheAgent`
- [ ] The owner has no path to any counter, round, pot or contribution. Verified by inspection: `_records`, `_rounds`, `_contributions` are written only in `_recordContribution`, `closeRound`, `_confirmPayout`
- [ ] `trustedVaultChains` increments and decrements only on an actual flag change (line 393). Not covered by a dedicated test

### 2.2 Batch prologue and replay

- [ ] `_prepareBatch` rejects `n == 0`, `n > MAX_BATCH`, mismatched lengths (lines 630 to 632). Tests: `test_batch_sizeLimits`, `test_batchShapeIsValidated`
- [ ] Query id derivation matches `ASCBase` (line 763, 72-byte preimage). Verified by reading `node_modules/@gluwa/asc-contracts/contracts/readability/ASCBase.sol`; no test compares the two
- [ ] Replay across calls and duplicates inside a batch both revert `QueryAlreadyProcessed` before the precompile is called (lines 637 to 639). Tests: `test_batch_replayIsRejected`, `test_batch_duplicateInsideBatchIsRejected`, `test_replayOfAConfirmedPayoutIsRejected`, `test_inBatchDuplicateIsRejected`; scenario `replay`
- [ ] `processedQueries` is one mapping for all three proving entry points (lines 518, 540, 563). Test: `test_replayOfAConfirmedPayoutIsRejected`
- [ ] `processedQueries[qid] = true` is set before `_recordContribution` runs, so a revert inside the loop rolls it back with everything else (atomic batch). Tests: `test_crossChainBatchIsRejectedWholesale`, `test_mismatchedAmountRevertsTheWholeBatch`

### 2.3 Precompile call

- [ ] `VERIFIER.verifyAndEmit` batch overload in `recordContributions` (line 512) and `confirmPayouts` (line 557); single overload in `confirmPayout` (line 538); `ProofRejected` on `false`. Tests: `test_batch_rejectsWhenPrecompileRejects`, `test_batch_recordsWholeRoundInOnePrecompileCall` (asserts `batchCalls == 1`), `test_crossCircleBatchSharesOnePrecompileCall`, `test_twoClosedRoundsConfirmedInOneCall`, `test_singleConfirmPayoutStillWorks`
- [ ] The precompile's own revert propagates unchanged (no `try/catch`). Observed live: `Merkle proof validation failed`, `Continuity proof does not match attestation or checkpoint` (`pnpm verify:live`, scenario `wrongChain` on testnet)
- [ ] `VERIFIER` and `CHAIN_INFO` are immutables bound to the precompile addresses by `NativeQueryVerifierLib.getVerifier()` and `ChainInfoLib.chainInfo()` (lines 253, 254). Tests etch mocks at those addresses (`vm.etch` in every `setUp`)

### 2.4 Decoding and binding (`_singleLog`, `_decodeVaultLog`, `_recordContribution`)

- [ ] Transaction type validated (line 715). `UnsupportedTxType` not covered by a test (fixtures always use type 2; `test_realProverBytesDecodeLikeTheLedgerExpects` asserts type 2 on real bytes)
- [ ] `receiptStatus == 1` (line 718). Test: `test_rejectsRevertedSourceTx`; scenario `revertedTx`
- [ ] Logs filtered by signature then by trusted emitter for the batch's chain key (lines 719 to 729). Tests: `test_rejectsSpoofedEmitter`, `test_onlyUntrustedEmitterLogs_isWrongEmitter`, `test_extraContributedLogFromUntrustedEmitterIsIgnored`, `test_vaultTrustedOnAnotherChainIsNotAValidEmitter`; scenario `spoofEmitter`
- [ ] `_rejectEmitter` always reverts and only chooses between `WrongChain` and `WrongEmitter` (lines 737 to 745). Tests: `test_onlyUntrustedEmitterLogs_isWrongEmitter` (`WrongEmitter`), `test_mainnetBatchCannotFeedASepoliaCircle` (`WrongChain`)
- [ ] `ExpectedExactlyOneLog(found)` for two trusted-vault logs in one transaction: not covered
- [ ] `_decodeVaultLog` shape checks (line 753): `BadLogShape` not covered (unreachable through a genuine vault)
- [ ] Circle existence via non-zero `sourceVault` (line 857). Tests: `test_getCircleFull_unknownCircleReverts`, `test_redeemInvite_unknownCircle`
- [ ] `chainKey == c.chainKey` (line 670). Tests: `test_batch_rejectsWrongChainKey`, `test_sepoliaBatchCannotFeedAMainnetCircle`, `test_payoutBatchIsBoundToTheCirclesChain`
- [ ] `CircleNotActive` (line 671) from `_recordContribution`: not directly covered (`test_fullCircleRotatesAndCompletes` asserts it from `closeRound` on a completed circle, line 433)
- [ ] `CircleStillOpen` (line 672). Test: `test_recordContributions_revertsWhileOpen`
- [ ] `log.address_ == c.sourceVault` (line 673): a vault trusted on the circle's chain but not the circle's own vault. Not directly covered (`test_vaultTrustedOnAnotherChainIsNotAValidEmitter` stops earlier, in `_rejectEmitter`, because the emitter is untrusted on the batch's chain); the `_confirmPayout` twin at line 652 is likewise not covered
- [ ] `tx.to == c.sourceVault` and `!toIsNull` (line 677). Test: `test_rejectsTxNotSentToVault`
- [ ] `tx.from == member` (line 678). `SenderMismatch` covered by `test_rejectsPaymentSentByAnotherAddress`; `TxNotToVault` by `test_rejectsPaymentRoutedThroughAnotherContract`
- [ ] `isMember`, `WrongAmount`, `NotCurrentRound` (lines 680 to 682). Tests: `test_rejectsNonMember`, `test_rejectsWrongAmountAndWrongRound`
- [ ] `height >= c.startHeight` (line 685). Test: `test_rejectsPaymentThatPredatesTheCircle`
- [ ] `RoundNotOpen` (line 687) and `AlreadyContributed` (line 688). Tests: `test_rejectsDoubleContributionByMember`; `RoundNotOpen` from `_recordContribution` is not directly covered (the round is always `Open` while it is `currentRound`, so this guard is defence in depth)
- [ ] Effects: consent, contribution stored with `onTime = height <= deadline`, counters, `volume`, event (lines 690 to 701). Tests: `test_batch_recordsWholeRoundInOnePrecompileCall`, `test_lateContributionIsFlagged`, `test_creditScore_math`

### 2.5 Circle creation and invites

- [ ] `_initCircle` guards in order: contribution, roundBlocks, registry, trusted vault, height range, frontier bound (lines 787 to 797). Tests: `test_createCircle_rejectsBadInputs`, `test_unknownChainKeyIsRejectedAtCreation`, `test_createCircle_rejectsUntrustedVault`, `test_createCircle_revertsWhenRound0DeadlineAlreadyAttested`; `InvalidCircle("height range")` not covered
- [ ] Member list 2..10, distinct, non-zero (lines 325, 330). Test: `test_createCircle_rejectsBadInputs`
- [ ] Listed members are not consented; organiser of an open circle is (lines 331, 351). Tests: `test_listedButUnconsentedMemberIsNeverPenalised`, `test_createOpenCircle_onlyOrganiserIsMember`
- [ ] `inviteDigest` binds `(address(this), block.chainid, circleId, invitee, nonce)` under EIP-191 (line 424). Tests: `test_redeemInvite_validSignatureJoins`, `test_redeemInvite_rejectsInviteForSomeoneElse`, `test_redeemInvite_rejectsWrongSigner`
- [ ] `redeemInvite` guard order (lines 364 to 371). Tests: `test_redeemInvite_rejectsNonceReplay`, `test_redeemInvite_rejectsAfterCloseInvites`, `test_redeemInvite_rejectsAfterFirstContribution`, `test_redeemInvite_enforcesMaxMembers`, `test_redeemInvite_unknownCircle`, `test_redeemInvite_rejectsNonceReplay` (which also asserts `AlreadyMember` for a second redemption by the same member)
- [ ] `closeInvites` requires organiser, open, at least 2 members; fixes `maxMembers` (lines 412 to 420). Tests: `test_closeInvites_onlyOrganiser`, `test_closeInvites_requiresTwoMembers`, `test_closeInvites_twiceReverts`, `test_openCircle_fullLifecycleAfterClose`
- [ ] `setRotation` locked after the first proof (line 385). Test: `test_setRotation_onlyOrganiserAndOnlyBeforeFirstProof`
- [ ] `circleCount` starts at 1 and is dense (line 798). Test: `test_createCircle_recordsOrganiserAndIndex`

### 2.6 Round close, clock and rotation

- [ ] `closeRound` guards: active, invites closed, round open (lines 433 to 437). Tests: `test_closeRound_earlyWhenEveryonePaid`; `CircleStillOpen` from `closeRound` not directly covered
- [ ] Incomplete rounds require `is_height_attested(c.chainKey, deadline + GRACE_BLOCKS)` (line 445) with the circle's own chain key. Tests: `test_closeRound_blockedUntilDeadlineAttested`, `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace`, `test_closeRoundUsesTheCirclesOwnChainForAttestation`; scenario `stealFromSteward`
- [ ] Attestation evidence stored and emitted on the deadline path, zero on early close (lines 448 to 450, 460, 483). Test: `test_closeRound_recordsAttestationEvidence`
- [ ] Misses only for consented members (line 457). Test: `test_listedButUnconsentedMemberIsNeverPenalised`, `test_closeRound_afterDeadlineRecordsMissed`
- [ ] `_pickRecipient` requires a proven contribution in both modes; Fixed order starts at index `r`; ByScore takes the best score with first-member tie-break (lines 826 to 853). Tests: `test_fixedRotation_skipsNonPayer_andCarriesPotWhenNobodyEligible`, `test_fixedRotationUnchanged`, `test_byScore_missingMemberGoesLast_andEveryoneReceivesOnce`, `test_byScore_higherHistoryBeatsIndexOrder`
- [ ] Pot carry-over on non-final rounds, final-round fallback, `receivedPot` and `received` updates (lines 466 to 482). Tests: `test_potCarriesOverToNextRound`, `test_finalRound_fallbackPaysAPayer`
- [ ] Circle completes on the final round, otherwise advances and emits `RoundOpened` (lines 485 to 491). Tests: `test_fullCircleRotatesAndCompletes`, `test_getCircleFull_completedCircleReturnsAllRounds`
- [ ] `deadlineHeight` arithmetic cannot overflow within the ranges `_initCircle` admits (`startHeight <= 2^62`, `roundBlocks <= 2^40`, `round < 10`). Verified by inspection; not covered in the reviewed suites
- [ ] `creditScore` clamps and tiers (lines 607 to 617). Test: `test_creditScore_math`

### 2.7 Payout confirmation

- [ ] `_confirmPayout`: `PAIDOUT_SIG` log from the circle's vault on the circle's chain; round `Closed`; recipient non-zero; recipient and amount equal the round's (lines 646 to 660). Tests: `test_confirmPayout_closesTheLoop`, `test_confirmPayout_rejectsWrongRecipientOrAmount`, `test_confirmPayout_requiresClosedRound`, `test_mismatchedAmountRevertsTheWholeBatch`, `test_wrongRecipientRevertsTheWholeBatch`, `test_openRoundCannotBePaidInABatch`, `test_payoutBatchIsBoundToTheCirclesChain`
- [ ] `NoRecipient` for a round that closed with nobody eligible (line 655). Test: `test_fixedRotation_skipsNonPayer_andCarriesPotWhenNobodyEligible` (uses a bare `vm.expectRevert()`, so the selector is not asserted)
- [ ] `confirmPayout` does not check `tx.to`/`tx.from` (unlike contributions); the operator address is not bound. Acceptable because the vault is the only trusted emitter and `payout` is operator-only, but note it

### 2.8 Events

- [ ] Every state change emits: `CircleCreated`, `CircleChainSet`, `RoundOpened`, `MembershipAccepted`, `InviteRedeemed`, `InvitesClosed`, `RotationSet`, `VaultTrusted`, `BatchVerified`, `ContributionRecorded`, `ContributionMissed`, `RoundClosed`, `PotCarriedOver`, `FallbackRecipient`, `CircleCompleted`, `PayoutConfirmed`. Tests use `vm.expectEmit` for `ContributionMissed`, `RoundClosed`, `FallbackRecipient` (`test_closeRound_recordsAttestationEvidence`, `test_potCarriesOverToNextRound`, `test_finalRound_fallbackPaysAPayer`); the dashboard and `pnpm receipts` depend on `ContributionRecorded`, `ContributionMissed`, `RoundClosed`, `PayoutConfirmed`, `BatchVerified`, `RoundOpened`, `CircleCreated`, `CircleCompleted`, `InviteRedeemed`
- [ ] `VaultTrusted` fires even when nothing changed (line 398). Not covered; harmless

## 3. KittyVault

- [ ] `contribute`: `ZeroAmount`, `safeTransferFrom` before state, `pot` and `contributor` updated, `Contributed` emitted with `msg.sender` (lines 62 to 68). Tests: `test_contribute_escrowsAndEmits`, `test_contribute_rejectsZero`
- [ ] `payout`: operator only, once per `(circle, round)`, non-zero, within `pot[circleId]`, recipient is a contributor, effects before transfer (lines 72 to 82). Test: `test_payout_onlyOperatorOncePerRound`
- [ ] `nonReentrant` on both. Not covered by a reentrancy test
- [ ] `setOperator` is `onlyOwner` and emits `OperatorChanged`. Not covered
- [ ] Event signatures equal the ledger's constants. Test: `test_eventSignaturesMatchLedgerConstants`
- [ ] The vault performs no circle, member, round or amount check on `contribute` (by design; the ledger does). Scenarios `revertedTx`, `late`, worker quarantine of wrong-amount and non-member payments
- [ ] `pot` is per circle, not per round: a round's payout can spend escrow paid for a later round of the same circle. The ledger's `PayoutMismatch` and the vault's `InsufficientPot` do not prevent this; note as a known property of the minimal vault (not covered)
- [ ] `FakeVault` is never trusted by any script. `scripts/deploy.sh` and `scripts/local-setup.sh` call `setTrustedVault` only for `KITTY_VAULT_ADDRESS`

## 4. KittyCreditLine

- [ ] `creditLimit`: zero without history, tier factors 100/50/20/0, `CAP`. Tests: `test_noHistory_limitZeroAndBorrowReverts`, `test_tierC_oneOnTime_is20pct`, `test_tierB_sevenOnTime_is50pct`, `test_tierA_fourteenOnTime_is100pct`, `test_capAt5000`, `test_tierD_withMissed_isZero`
- [ ] `borrow`: `ZeroAmount`, `ExceedsCreditLimit`, `InsufficientLiquidity`, fee added to debt and `totalOutstanding`. Tests: `test_borrowRepayFlow`, `test_borrowZeroReverts`, `test_liquidityConstraints`
- [ ] `repay`: `NothingToRepay`, clamp, `totalOutstanding` decrement. Test: `test_borrowRepayFlow`
- [ ] Share units: `deposit` prices at `poolValue`, `withdraw` rounds units up and never exceeds `entitlement` or `liquidity`. Tests: `test_depositEmitsAndTracks`, `test_secondLpDoesNotCaptureEarlierFees`, `test_fullExitAfterFees`
- [ ] `underwrite` reason strings. Covered by `scripts/local-e2e.sh`'s `cast call underwrite` smoke check; not asserted in Foundry
- [ ] No time accrual, no liquidation, no default feedback into the ledger (documented limits)

## 5. KittyBadge

- [ ] `claim` requires history, one per address, `tokenId = uint160(caller)`, emits `Locked`. Tests: `test_claimRequiresProvenHistory`, `test_claimMintsOneSoulboundBadge`
- [ ] Transfers, approvals and burns revert `Soulbound`. Test: `test_transfersAndApprovalsRevert`
- [ ] `locked` reverts for unknown tokens; `tokenURI` reverts for unminted. Tests: `test_lockedRevertsForUnknownToken`, `test_tokenURIRevertsForUnminted`
- [ ] `tokenURI` renders the live score. Test: `test_tokenURIReflectsLiveScore`
- [ ] `supportsInterface` includes `IERC5192`. Not covered

## 6. KittyViewer

- [ ] `getCircleFull` matches the ledger after batches and closes and returns all rounds when completed. Tests: `test_getCircleFull_freshCircle`, `test_getCircleFull_matchesLedgerAfterBatchAndClose`, `test_getCircleFull_completedCircleReturnsAllRounds`, `test_getCircleFull_unknownCircleReverts`
- [ ] `memberStatus` mapping (pending, proven, late, missed) and `getMemberDashboard` over consented circles only. Tests: `test_getMemberDashboard_statusesAcrossCircles`, `test_getMemberDashboard_strangerIsEmpty`

## 7. Test infrastructure

- [ ] `MockVerifier` (`test/mocks/MockVerifier.sol`) accepts or rejects everything by a flag and derives `txIndex` from the Merkle root; it does not verify anything. Real verification is covered only by `pnpm verify:live` and the testnet rounds
- [ ] `MockChainInfo` implements the eight interface functions with a settable frontier and a `{1, 3}` default registry
- [ ] `TxFixtures.encode` builds type-2 prover bytes with `[common, type-specific, receipt]` chunks; `test_realProverBytesDecodeLikeTheLedgerExpects` decodes real Proof Builder output (`test/fixtures/sepolia-11656295-tx44.json`) with the same calls to guard against drift

## 8. Worker: `worker/src/worker.ts`

- [ ] `scanSource` never advances `lastSourceBlock` past a pending payment (line 58) and scans in `MAX_LOG_RANGE = 50` windows. Not covered by a unit test; exercised by `scripts/local-e2e.sh`
- [ ] `flushBatches` quarantines unknown circles, completed circles and past rounds as recorded; leaves future rounds and open-invite circles unmarked; drops pre-start, non-member, wrong-amount, duplicate and already-proven payments in that order (lines 83 to 133). Not covered by a unit test; the ordering rationale is in the comments
- [ ] `decideBatch` is called with the live frontier and `force = once` (line 146). Test: `policy.test.ts` (`a forced single pass fires whatever is provable`)
- [ ] `preflight` before every submission; a rejected preflight records `skip` and does not send (lines 157 to 163). Not covered by a unit test
- [ ] `state.recorded` is marked only after `submitRecordContributions` returned a receipt (line 167). Verified by inspection
- [ ] `ccSigner.reset()` after a failed batch, close or confirm; `sourceSigner.reset()` after a failed payout; both reset at the start of every tick. Verified by inspection
- [ ] `closeRounds` skips open-invite circles and requires full or `is_height_attested(cfg.chainKey, closeHeight)` (note: `cfg.chainKey`, not the circle's `chainKey`; the ledger enforces the circle's key, so this only affects when the worker tries). Not covered
- [ ] `payouts` refuses to pay a round twice, checks `vault.paidOut` before paying, writes `state.paid` before proving back, and only marks `confirmed` after the receipt (lines 217 to 262). Not covered by a unit test; the manual recovery path is in `OPERATIONS.md`
- [ ] `--once` runs two ticks so an attested round can close and pay in one pass (lines 295 to 298)

## 9. Worker: `worker/src/agent/policy.ts`

- [ ] `provable` and `slack` read the frontier, not the clock. Test: `provable and slack read the attestation frontier, not the clock`
- [ ] Nothing provable yields `wait` with `provable: 0`. Test: `waits while nothing is attested yet`
- [ ] One chain key per call; the most urgent group wins, larger group on ties. Tests: `never mixes chain keys in one call, and serves the most urgent chain first`, `equal slack: the larger group wins`
- [ ] Cap at 10, most urgent first. Test: `caps at the protocol maximum of ten and takes the most urgent first`
- [ ] Span under `MAX_BATCH_RANGE = 1000`. Test: `never pools payments more than 1000 blocks apart`
- [ ] `round-complete` counts only rounds fully inside this batch, and duplicates by one member do not complete a round. Tests: `a full batch only counts rounds it fully contains`, `duplicate payments by one member do not complete a round`
- [ ] Reason priority `forced > full > round-complete > deadline-risk > waited`. Tests: `fires immediately when a round is complete`, `fires on deadline risk even with an unfull batch`, `fires once the batching window has elapsed`, `waits for a fuller batch when there is slack and the window has not elapsed`
- [ ] Cross-circle pooling under one key. Test: `batches across circles under one chain key`
- [ ] Roundmate hold only demotes `waited`, only with unattested roundmates, only above `URGENT_BLOCKS + ATTESTATION_LAG_BLOCKS`. Tests: `holds a provable payment while roundmates are unattested and slack is ample`, `does not hold when slack is short`, `the hold never overrides round-complete, full or forced`
- [ ] Evidence contains only chain-derived numbers (no wall-clock timestamps except `waitedSeconds`). Verified by inspection

## 10. Worker: `worker/src/agent/citations.ts` and `explain.ts`

- [ ] A sentence with an unverifiable `[[citation]]` is stripped. Test: `strips a sentence citing a value the chain does not have`
- [ ] A sentence with an uncited figure is stripped even if true. Test: `strips a sentence with an uncited figure even when the figure is true`
- [ ] Hex matches only as a prefix of a logged hash, never through the numeric fallback, and never when shorter than 10 characters. Tests: `accepts a truncated hash prefix against the full hash`, `rejects a hash that merely looks plausible`, `a fake address is not rescued by the numeric fallback (regression: 0x… stripped to "0")`, `a short hex citation is never accepted as a prefix`
- [ ] Units and separators around numbers are tolerated. Test: `tolerates separators and units around a cited number`
- [ ] Prose without figures passes. Test: `prose with no figures at all passes through untouched`
- [ ] A fully fabricated paragraph yields empty text. Test: `a fabricated paragraph is removed entirely`; scenario `poisonReasoning`
- [ ] `explain` falls back to the deterministic sentence with no key, an empty log, or an API error. Tests: `falls back to the deterministic sentence with no API key`, `an empty log never reaches the model`
- [ ] `citableValues` flattens evidence values and transaction hashes only (`log.ts`); the model is handed the last 12 entries. Verified by inspection
- [ ] The model has no tool, no key and no write path (`explain.ts` creates a client and reads text). Verified by inspection

## 11. Worker: proofs, verifier, chain

- [ ] `buildBatchProof` waits for the highest height to be attested before requesting a batch (`proofs.ts`, `waitUntilHeightAttested`). Not covered by a unit test; the testnet log shows every batch landing after attestation
- [ ] The single-proof fallback groups by height and trusts `mergeProofs` only when every Merkle root is covered. Not covered
- [ ] Local mode still runs the SDK's `abiEncode` so the decoder sees real bytes (`localBatch`). Exercised by `scripts/local-e2e.sh` and `pnpm scenarios`
- [ ] `preflight` selects the single or batch `verify` overload by length and returns the precompile's reason on revert (`verifier.ts`). Not unit-tested; exercised by every local and testnet run
- [ ] `gasFor` floors at 1,500,000 on testnet and uses 6,000,000 locally; `staticCall` precedes every send (`chain.ts`). Not covered
- [ ] `revertReason` decodes custom errors through the contract interface. Exercised by every scenario's expected-error match

## 12. Lab API, scenarios and recorder

- [ ] `api.ts` binds to `PORT`, CORS `*`, no auth; documented local-only; the hosted build sets `labApi = ''` (`web/src/config.ts`). Not covered by a test
- [ ] One scenario at a time (`running` guard, 409). Not covered
- [ ] Each scenario expects a specific error prefix or outcome (`expectRevert` compares `got.startsWith(expected)`), and `wrongChain` accepts the precompile's own continuity rejection. Run by `pnpm scenarios` in CI
- [ ] `record-lab.ts` exits 1 on any failure so a broken recording never ships; `LAB_ONLY` merges subsets. Not covered

## 13. Web

- [ ] `ProvePanel` only offers payments of exactly the installment and only those `find_lowest_attested_after` reports covered; preflights with the view `verify` and simulates the ledger call before signing; floors gas at 4,000,000. Manual; no automated UI test
- [ ] `ReverifyModal` asks the live precompile and tampers the last byte as a negative. Manual
- [ ] The score page never shows a number the chain did not produce (`value === undefined` until read). Manual
- [ ] Hosted pages never call `localhost` (`labApi` empty in production). Verified by `web/src/config.ts`; audit round 2 finding

## 14. Deployment and operations

- [ ] `deploy.sh` pairs a ledger redeploy with a fresh vault and trusts only that vault. Verified by reading the script; ADR 0005
- [ ] `web/.env.production` and `deployments.json` name the same addresses as the README deployment table
- [ ] `KittyViewer`, `KittyCreditLine`, `KittyBadge` on testnet report `LEDGER() == KittyLedger` in `deployments.json` (checked with `cast call` during this review)
- [ ] Secrets stay out of git (`.gitignore`: `.env`, `worker/state*.json`, `worker/steward*.json`, `worker/demo-members.local.json`)

## 15. Findings log

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Fabricated address passed the citation validator through the numeric fallback (`0x…` stripped to `0`) | medium (layer 3 only) | fixed; regression tests in `citations.test.ts` |
| 2 | A listed member could be marked missed without consent | high | fixed; `accepted` mapping, `test_listedButUnconsentedMemberIsNeverPenalised` |
| 3 | A rival could close a round before an on-time payment's proof landed | high | fixed; `GRACE_BLOCKS = 64`, `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace` |
| 4 | An organiser could open a circle whose round 0 was already over and trap invitees | high | fixed; frontier bound in `_initCircle`, `test_redeemInvite_cannotBeGriefedByPastStart` |
| 5 | A payment counted by an earlier ledger sharing the vault could be credited again | high | fixed; `BeforeCircleStart`, `test_rejectsPaymentThatPredatesTheCircle`, deploy pairing |
| 6 | The batch timer split a round the protocol could settle in one call | low (cost) | fixed; roundmate hold, three policy tests |
| 7 | Hosted pages called `localhost:8790` and logged CORS errors | low | fixed; `labApi` empty in production |
| 8 | `UnsupportedTxType`, `BadLogShape`, `ExpectedExactlyOneLog(n > 1)`, `WrongEmitter` for a trusted-but-wrong vault (lines 652, 673), `InvalidCircle("height range")`, vault `setOperator`, reentrancy | coverage gap | open; listed above as not covered |
| 9 | `closeRounds` in the worker reads `is_height_attested` with `cfg.chainKey` rather than the circle's key | low (worker timing only; the ledger enforces the circle's key) | open |
| 10 | Vault `pot` is per circle, so escrow paid for round r+1 can fund round r's payout | low (operator-bounded; the ledger requires the exact pot) | open, documented |
