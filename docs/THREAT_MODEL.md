# Kitty Threat Model

Kitty was reviewed against an adversarial model in which the Attestcoin precompiles are trusted and everything else is hostile: proof submitters, members, organisers, the vault operator, other contracts on either chain, the RPCs, and the language model in the steward's third layer. This document records the assets, the actors, the trust assumptions, each threat with the exact check that mitigates it and the test or scenario that demonstrates the check, the eight attack scenarios mapped to threats, and the limits that remain.

Companion documents: [`TECH.md`](TECH.md) for the pipeline, [`specs/PROTOCOL.md`](specs/PROTOCOL.md) for every check in order, [`AUDIT_CHECKLIST.md`](AUDIT_CHECKLIST.md) for the reviewer's list.

## 1. Assets

| Asset | Where | Why it matters |
|---|---|---|
| Escrowed stablecoins | `KittyVault.pot[circleId]` on Sepolia | The members' money. |
| Round state | `KittyLedger._rounds` on Creditcoin | Who paid, who receives, whether the payout happened. |
| Member records and the Kitty Score | `KittyLedger._records` | The credit history lenders underwrite against. A minted or damaged score is the highest-value target after the escrow. |
| Consent | `KittyLedger.accepted` | Whether a member can be marked missed. |
| The trusted-vault allowlist | `KittyLedger.trustedVault` | The only thing standing between "a contract emitted Contributed" and "a payment counts". |
| The credit pool | `KittyCreditLine` on Creditcoin | LP deposits lent against the score. |
| The decision log | `worker/steward*.json` | What the steward saw and did; the only source of figures the explainer may cite. |
| Keys | deployer/owner, vault operator, members, organisers | Compromise of the operator key is the one key compromise with a money path. |

## 2. Actors

| Actor | What they can do | Assumed intent |
|---|---|---|
| Member | Pay into the vault; call any ledger function; prove from the browser; claim a badge; borrow. | Hostile: wants credit without paying, or wants to damage others' records. |
| Organiser | Create circles; sign invites; set rotation; close invites. | Hostile: wants to trap invitees into misses, or steer the pot. |
| Steward | Runs `worker/`; holds a Creditcoin key with no ledger role and, in this build, the Sepolia operator key. | Hostile or compromised: wants to move escrow, mint score, or lie about what happened. |
| Stranger | Any address. Can call `recordContributions`, `closeRound`, `confirmPayout`, `confirmPayouts`, `contribute`. | Hostile: wants to grief a round, replay proofs, or feed forged data. |
| Vault operator | Calls `KittyVault.payout`. | Hostile: wants to route escrow to itself or to the wrong member. |
| Ledger owner | Calls `setTrustedVault`. | Trusted for the allowlist only; has no other power. |
| Attestor network | Attests Sepolia headers on Creditcoin. | Trusted. If it lies about a header, every Attestcoin contract is broken, not just Kitty. |
| Proof Builder | Serves proofs over HTTP. | Untrusted for correctness: every proof it returns is checked by `0x0FD2`. Trusted for liveness only. |
| RPC endpoints | Serve blocks, logs and calls to the worker and the browser. | Untrusted for the ledger's state (it never reads them); can delay or censor the steward and the dashboard. |
| Language model | Writes explanations from the decision log. | Hostile: assumed to fabricate. |

## 3. Trust assumptions

1. The block-prover precompile at `0x0FD2` verifies Merkle inclusion and continuity correctly, and `calculateTxIndex` is deterministic for a given Merkle proof.
2. The ChainInfo precompile at `0x0FD3` reports attestation state honestly.
3. The attestor network attests only canonical Sepolia headers; Sepolia does not reorg below an attested height.
4. `EvmV1Decoder` from `@gluwa/asc-contracts@0.2.1` decodes prover bytes faithfully (`test/RealProofFixture.t.sol` decodes genuine Proof Builder output with the same calls the ledger makes).
5. OpenZeppelin `Ownable`, `ECDSA`, `MessageHashUtils`, `SafeERC20`, `ReentrancyGuard`, `ERC721` and `ERC20` at version 5.4.0 behave as documented.
6. The ledger owner adds only genuine `KittyVault` deployments to the allowlist. `scripts/deploy.sh` adds exactly the vault it deployed.
7. The escrow token behaves like a standard ERC-20 (no fee-on-transfer, no rebasing). `TestUSD` and `KittyUSD` do.

Everything not listed is untrusted.

## 4. Threat table

Each row names the vector, the exact mitigating check with its location, the residual risk, and the test (`test/*.t.sol`) or scenario (`worker/src/scenarios.ts`) that demonstrates it.

### 4.1 Proof-level threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Replay a counted proof | Resubmit the same prover bytes and Merkle proof. | `_prepareBatch` derives `keccak(chainKey ‖ height ‖ txIndex)` and reverts `QueryAlreadyProcessed` if `processedQueries[qid]`; `confirmPayout` does the same. One mapping shared by all entry points. | none | `test_batch_replayIsRejected`, `test_replayOfAConfirmedPayoutIsRejected`; scenario `replay` |
| Duplicate inside one batch | Put the same transaction twice in one `recordContributions` call. | `_prepareBatch` compares each new id to every earlier id in the batch before the precompile is called. | none | `test_batch_duplicateInsideBatchIsRejected`, `test_inBatchDuplicateIsRejected` |
| Forged inclusion or continuity proof | Tamper with `txBytes`, siblings or continuity roots. | `VERIFIER.verifyAndEmit` (batch or single) must return true else `ProofRejected`; the live precompile reverts `Merkle proof validation failed` on tampered bytes. | trust assumption 1 | `test_batch_rejectsWhenPrecompileRejects`; `pnpm verify:live` negative checks; `ReverifyModal` tampered-bytes line |
| Proof from another chain | Submit a valid proof under `chainKey = 3` for a Sepolia circle. | The live `0x0FD2` rejects the continuity proof under the wrong chain's attestations (`Continuity proof does not match attestation or checkpoint`). If a permissive verifier let it through, `_recordContribution` reverts `WrongChain(chainKey, c.chainKey)`, and `_rejectEmitter` reports `WrongChain` when the circle's own vault emitted the log. | none | `test_batch_rejectsWrongChainKey`, `test_sepoliaBatchCannotFeedAMainnetCircle`, `test_mainnetBatchCannotFeedASepoliaCircle`, `test_crossChainBatchIsRejectedWholesale`; scenario `wrongChain` |
| Included but reverted source transaction | A `contribute` call that mined with status 0 (no allowance) still has an inclusion proof. | `_singleLog` requires `decodeReceiptFields(encodedTx).receiptStatus == 1` else `SourceTxFailed`. | none | `test_rejectsRevertedSourceTx`; scenario `revertedTx` |
| Spoofed emitter | Deploy a contract that emits a byte-identical `Contributed` event and prove that transaction. | `_singleLog` keeps only logs whose `address_` is in `trustedVault[chainKey]`; `_recordContribution` additionally requires `log.address_ == c.sourceVault`. `FakeVault` is never trusted. | none | `test_rejectsSpoofedEmitter`, `test_onlyUntrustedEmitterLogs_isWrongEmitter`, `test_vaultTrustedOnAnotherChainIsNotAValidEmitter`; scenario `spoofEmitter` |
| Look-alike log alongside the real one | A token or router in the same transaction emits `Contributed` to jam the "exactly one log" rule. | Untrusted emitters are ignored before counting; `ExpectedExactlyOneLog(found)` only fires for more than one trusted-vault log. | none | `test_extraContributedLogFromUntrustedEmitterIsIgnored` |
| Someone else's transaction with a vault log | Prove a transaction whose sender is not the member but which contains a vault log naming the member (only possible through a contract that calls the vault). | `decodeCommonTxFields`: `!toIsNull && to == c.sourceVault` else `TxNotToVault`; `from == member` else `SenderMismatch`. | Smart-account wallets are excluded as a side effect (section 6). | `test_rejectsTxNotSentToVault` (`to`); `SenderMismatch` has no dedicated test |
| Wrong amount, wrong round, non-member | Pay a different amount, tag a future round, pay from an unlisted address. | `WrongAmount`, `NotCurrentRound`, `NotAMember` in `_recordContribution`. The vault deliberately checks none of these. | none | `test_rejectsWrongAmountAndWrongRound`, `test_rejectsNonMember` |
| Payment that predates the circle | Reuse a payment an earlier ledger instance (sharing the vault) already counted, tagged with a reused `(circleId, round)`. | `height < c.startHeight` reverts `BeforeCircleStart`; `deploy.sh` also pairs a ledger redeploy with a fresh vault. | none | `test_rejectsPaymentThatPredatesTheCircle` |
| Malformed log | A trusted vault could not emit one, but the decoder path must not misread topics. | `_decodeVaultLog` requires 4 topics, 32 data bytes and a round that fits `uint32` else `BadLogShape`. | none | not covered by a dedicated test (unreachable through a genuine `KittyVault`) |

### 4.2 Time and round threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Close a round before an on-time payment is provable | A payment mined at the deadline block is attested at the same moment the deadline is; a rival closes first. | `closeRound` on the incomplete path requires `is_height_attested(chainKey, deadline + GRACE_BLOCKS)` with `GRACE_BLOCKS = 64`, else `RoundStillOpenOnSource(closeHeight)`. | A payment whose proof is not landed within 64 blocks after the deadline is lost (section 6). The steward proves as soon as the block is attested and fires on `deadline-risk` at 24 blocks of slack. | `test_closeRound_blockedUntilDeadlineAttested`, `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace`; scenario `stealFromSteward` (`closeRound` early) |
| Admin or timestamp-based close | Anyone declares the round over. | There is no timestamp and no privileged close. The only inputs are `contributions == members.length` and the precompile's answer. | trust assumption 2 | `test_closeRoundUsesTheCirclesOwnChainForAttestation` |
| Mark a listed member missed who never agreed | `createCircle` lists any address; close on the deadline. | `closeRound` increments `missed` only when `accepted[circleId][m]`; listing does not grant consent. | none | `test_listedButUnconsentedMemberIsNeverPenalised` |
| Consent trap through a past start | Open an invite circle whose round 0 is already over, collect invites, close it on every invitee. | `_initCircle` reverts `InvalidCircle("round 0 already attested")` when `startHeight + roundBlocks <= get_latest_attestation_height_and_hash(chainKey).height`. | none | `test_createCircle_revertsWhenRound0DeadlineAlreadyAttested`, `test_redeemInvite_cannotBeGriefedByPastStart` |
| Change the rules after payments | Switch rotation after members have paid. | `setRotation` requires `currentRound == 0`, no contributions, round `Open`, else `RotationLocked`; organiser only. | none | `test_setRotation_onlyOrganiserAndOnlyBeforeFirstProof` |
| Change membership after payments | Redeem an invite after round 0 has a proof, or after invites closed. | `redeemInvite` requires `open`, `currentRound == 0` and zero contributions; `_recordContribution` reverts `CircleStillOpen` while invites are open. | none | `test_redeemInvite_rejectsAfterCloseInvites`, `test_redeemInvite_rejectsAfterFirstContribution`, `test_recordContributions_revertsWhileOpen` |
| Forged or replayed invite | Sign your own invite; reuse a nonce; redeem an invite meant for someone else. | `inviteDigest` binds `(ledger, chainid, circleId, invitee, nonce)` under EIP-191; `ECDSA.recover` must equal `organiser`; `usedInviteNonces` is single-use. | none | `test_redeemInvite_rejectsWrongSigner`, `test_redeemInvite_rejectsInviteForSomeoneElse`, `test_redeemInvite_rejectsNonceReplay` |
| Unbacked miss evidence | A lender cannot tell which attestation justified a miss. | On the deadline path `closeRound` stores `find_lowest_attested_after(chainKey, closeHeight)` on the round and emits it in every `ContributionMissed` and in `RoundClosed`. | none | `test_closeRound_recordsAttestationEvidence` |

### 4.3 Money threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Steward or stranger takes a pot | Call `KittyVault.payout`. | `msg.sender == operator` else `NotOperator`. The steward's Creditcoin key has no relation to this. | The operator key itself (next row). | `test_payout_onlyOperatorOncePerRound`; scenario `stealFromSteward` |
| Operator pays itself or an outsider | Operator calls `payout(circleId, round, self, amount)`. | `contributor[circleId][recipient]` else `NotAContributor`; `pot[circleId] >= amount` else `InsufficientPot`; `paidOut[circleId][round]` else `AlreadyPaid`. The ledger will then refuse the proof-back (`PayoutMismatch`), so the round never shows `Paid`. | A payout to a wrong contributor of the same circle is not recoverable on chain (section 6). Writability removes the operator entirely. | `test_payout_onlyOperatorOncePerRound` |
| Ledger shows Paid without money moving | Operator claims a payout. | `Paid` is reachable only through `confirmPayout` or `confirmPayouts` with a verified `PaidOut` whose recipient and amount equal the round's. | none | `test_confirmPayout_closesTheLoop`, `test_confirmPayout_rejectsWrongRecipientOrAmount`, `test_confirmPayout_requiresClosedRound`, `test_mismatchedAmountRevertsTheWholeBatch`, `test_wrongRecipientRevertsTheWholeBatch` |
| Pot to a non-payer | Fixed order names a member who did not pay. | `_pickRecipient` requires a contribution this round in both modes; non-payers are skipped; a round with nobody eligible carries the pot forward. | none | `test_fixedRotation_skipsNonPayer_andCarriesPotWhenNobodyEligible` |
| Escrow strands in the final round | Everyone eligible has already received. | Final-round fallback lifts the has-not-received filter and pays a payer; `FallbackRecipient` marks it. | A final round in which nobody paid keeps its pot on the round with no recipient; only writability-gated refunds would release it (section 6). | `test_finalRound_fallbackPaysAPayer`, `test_potCarriesOverToNextRound` |
| Reentrancy on the vault or the pool | Malicious token or recipient re-enters `contribute`, `payout`, `borrow`, `withdraw`. | `ReentrancyGuard` on all four; effects before external transfer in `payout`; `SafeERC20`. | trust assumption 7 | not covered by a dedicated test |
| LP fee capture | A late LP deposits after fees accrued and withdraws a share of them. | `deposit` mints units at the current `poolValue`; `withdraw` burns units rounded up. | none | `test_secondLpDoesNotCaptureEarlierFees`, `test_fullExitAfterFees` |
| Borrow beyond the record | Borrow with no history, or with a miss. | `creditLimit` is 0 with zero installments; tier D maps to factor 0; `ExceedsCreditLimit`; the whole debt counts against the limit. | Defaults do not feed the score (section 6). | `test_noHistory_limitZeroAndBorrowReverts`, `test_tierD_withMissed_isZero`, `test_capAt5000` |

### 4.4 Score and reputation threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Mint proven volume | Bind a circle to a contract you control that emits `Contributed`. | `_initCircle` requires `trustedVault[chainKey][sourceVault]` else `VaultNotTrusted`; only the owner can add vaults. | trust assumption 6 | `test_createCircle_rejectsUntrustedVault`, `test_vaultTrustIsPerChain`; scenario `stealFromSteward` (`createCircle` with own vault, `setTrustedVault`) |
| Same-address vault on another chain | A contract at the vault's address on Ethereum mainnet emits `Contributed`. | Allowlist keyed by chain; per-circle `chainKey` validated against `get_chain_by_key`; `UnsupportedSourceChain` for unknown keys. | none | `test_unknownChainKeyIsRejectedAtCreation`, `test_vaultTrustedOnAnotherChainIsNotAValidEmitter`, `test_mainnetCircleProvesFromItsOwnChain` |
| Score written by an operator | Any function that accepts a counter. | None exists. `_records` is written only by `_recordContribution` and `closeRound`. | none | inspection; `test_creditScore_math` |
| Late payment counted as on time | Prove a payment mined after the deadline. | `onTime = height <= deadlineHeight`; the proven height comes from the proof, not the submitter. | none | `test_lateContributionIsFlagged`; scenario `late` |
| Badge transfer or resale | Transfer the soulbound badge. | `_update` reverts `Soulbound()` when the token exists; `approve` and `setApprovalForAll` revert. | none | `test_transfersAndApprovalsRevert`, `test_claimMintsOneSoulboundBadge` |

### 4.5 Steward and agent threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Steward key compromise on Creditcoin | Attacker holds the steward's Creditcoin key. | The key has no role, no ownership and no allowance; everything it calls is callable by anyone and is checked by the ledger. | none | scenario `stealFromSteward` |
| Steward key compromise on Sepolia | Attacker holds the operator key (same process in this build). | `KittyVault` bounds payouts to contributors of the circle, once per round, from the circle's own pot; the ledger refuses a mismatched proof-back. | Mis-routing inside the group (section 6). | `test_payout_onlyOperatorOncePerRound` |
| Steward goes offline or is removed | No proofs are submitted. | Any address can submit; `ProvePanel` fetches the batch proof and submits from the member's wallet; `closeRound` is callable from the circle page. | Liveness depends on someone caring. | scenario `fireTheAgent` |
| Steward submits a bad batch and wastes gas | A stray payment makes the ledger revert the whole batch every tick. | `flushBatches` quarantines unknown-circle, wrong-amount, non-member, duplicate and pre-start payments before deciding; `preflight` asks the view `verify`; `staticCall` surfaces the ledger error before sending. | none | `policy.test.ts` (`duplicate payments by one member do not complete a round`); worker log messages `ignoring …` |
| Steward splits a round the timer could have kept whole | The 45-second timer fires before roundmates are attested. | The roundmate hold in `decideBatch`: only the `waited` reason yields when unattested roundmates exist and slack exceeds 88 blocks. | A slower attestor produces smaller batches, never a missed grace window, because `deadline-risk` fires on slack. | `policy.test.ts` (`holds a provable payment while roundmates are unattested and slack is ample`, `does not hold when slack is short`, `the hold never overrides round-complete, full or forced`); the two testnet round-0 settlements in `TESTNET_LOG.md` |
| Explainer fabricates a figure | The model states a number, address or hash the chain does not back. | `citations.check` removes any sentence with a `[[citation]]` absent from `citableValues(log)` and any sentence with an uncited figure; hex matches only as a prefix of a logged hash and only when the citation is at least 10 characters long including `0x`. | none for figures; prose without figures passes through | `citations.test.ts` (12 tests, including the `0x… stripped to "0"` regression); scenario `poisonReasoning` |
| Explainer as a dependency | No API key or an API failure. | `explain` returns the deterministic layer-2 sentence on `AuthenticationError`, `RateLimitError`, any `APIError`, an empty log or a missing key. | none | `citations.test.ts` (`falls back to the deterministic sentence with no API key`, `an empty log never reaches the model`) |
| Lab API abuse | The lab API holds the operator key and has no auth. | It binds to a local port, is documented as local-only, and the hosted build has `labApi = ''` so no page ever calls it. | Do not expose port 8790. | `web/src/config.ts` |

### 4.6 Infrastructure threats

| Threat | Vector | Mitigation | Residual | Demonstrated by |
|---|---|---|---|---|
| Malicious or flaky RPC | Wrong logs, capped ranges, null receipts. | The ledger never reads an RPC. The worker scans in 50-block windows, never advances `lastSourceBlock` past a pending payment, and resets the `NonceManager` after a failed send; `verify-live` retries a null receipt. | Delay only. | `worker/src/worker.ts` `scanSource`; `worker/src/verify-live.ts` |
| Proof Builder outage or bad proof | Batch endpoint fails or returns a proof that will not verify. | Fallback to single proofs merged with `mergeProofs` when every Merkle root is covered, else separate batches; `preflight` rejects before gas is spent. | Delay only. | `worker/src/proofs.ts` `singleProofs`; `worker/src/verifier.ts` |
| Gas under-estimation through the precompile | `eth_estimateGas` fails or under-reports. | `gasFor` floors the limit at 1,500,000 on testnet; the browser floors at 4,000,000 and takes 1.3 times the estimate when larger. | none | `worker/src/chain.ts`; `web/src/components/ProvePanel.tsx` |
| State-file loss | The worker forgets what it paid. | `payouts` checks `vault.paidOut(id, r)` before paying and logs the manual recovery step (`OPERATIONS.md`). | Manual step. | `worker/src/worker.ts` `payouts` |

## 5. The eight attack scenarios

`worker/src/scenarios.ts`, run by `pnpm scenarios` in CI against two anvils with the precompiles mocked, and recorded against the live testnets in `web/public/lab-testnet.json`.

| Scenario | Threat rows | What it does | Expected answer |
|---|---|---|---|
| `replay` | 4.1 replay | Rebuilds the proof of the first recorded contribution and resubmits it. | `QueryAlreadyProcessed(queryId)` |
| `spoofEmitter` | 4.1 spoofed emitter | `FakeVault.emitContributed` with the circle's exact fields, proven and submitted. | `WrongEmitter(got, want)` |
| `wrongChain` | 4.1 another chain | The same valid proof with `chainKey = 3`. | The live `0x0FD2` rejects the continuity proof; against a permissive verifier, `WrongChain(3, 1)` |
| `revertedTx` | 4.1 reverted tx | A fresh wallet with no allowance calls `contribute` with `gasLimit 200000`; the mined status-0 transaction is proven. | `SourceTxFailed()` |
| `late` | 4.4 late payment | An unpaid member pays after the deadline block (mined on the local anvil, waited for on testnet). | `ContributionRecorded onTime=false` |
| `stealFromSteward` | 4.3 pot, 4.4 mint volume, 4.2 early close, 4.5 key compromise | A fresh key tries `KittyVault.payout`, `setTrustedVault`, `closeRound` early, and `createCircle` bound to its own address. | `NotOperator()`, `OwnableUnauthorizedAccount(…)`, `RoundStillOpenOnSource(…)`, `VaultNotTrusted(…)` |
| `fireTheAgent` | 4.5 steward removed | A member pays; a wallet with no role, membership or history submits the round's proof. | Accepted; the contribution is recorded from the stranger's call |
| `poisonReasoning` | 4.5 fabrication | One true cited fact plus `[[500000]]`, an uncited `850`, and `[[0xdeadbeef…]]` are fed to `check`. | Three sentences stripped, at least one citation verified |

The `poisonReasoning` scenario found a real bug during development: stripping non-digits from a fabricated address left `0`, which the decision log contains, so the address passed. Hex is now matched only as a hash prefix, with regression tests.

## 6. Known limits

Stated plainly. Each is a design boundary of this build, not an oversight.

1. **The operator sends payouts.** `KittyVault.payout` is a privileged action and the steward process holds the key. `KittyVault` bounds it (contributor-only recipients, once per round, from the circle's pot) and the ledger will not show `Paid` for a mismatched payout, but a payout to the wrong contributor of the same circle moves tokens that the protocol cannot claw back. Attestcoin writability, once audited and on testnet, replaces the operator with a message from `closeRound` ([`adr/0002-money-and-rules-on-different-chains.md`](adr/0002-money-and-rules-on-different-chains.md)).
2. **A payment after the close is lost to the round.** A `Contributed` transaction that lands after the round's close height is attested and the round closed is never recorded (`NotCurrentRound` or `RoundNotOpen`), and this build has no refund path. The vault would need a `refundUnrecorded` gated by a proof of the ledger's `RoundClosed`, which is writability territory. The steward's `deadline-risk` rule and the 64-block grace window make this unlikely for a payment made in time.
3. **Smart-account wallets are not credited.** Check 13 (`SenderMismatch`) requires the transaction's own `from` to be the member. A payment routed through a contract wallet has the wallet's `from`.
4. **Loan defaults do not feed the score.** `KittyCreditLine` reads the ledger but never writes to it.
5. **The final round can strand a pot.** If no member paid the final round there is no recipient and no next round; the pot stays on the round. The same refund path as limit 2 would release it.
6. **Liveness is nobody's obligation.** With the steward off, a round settles only if a member or stranger submits the proof and calls `closeRound`. The ledger guarantees safety, not progress.
7. **The lab API is unauthenticated.** `worker/src/api.ts` holds the operator key and must stay on a local port.
8. **The mock precompiles are not the real ones.** Local tests and `pnpm scenarios` run against `MockVerifier` and `MockChainInfo`; `MockVerifier.calculateTxIndex` derives the index from the Merkle root. The real verifier is exercised by `pnpm verify:live`, the recorded testnet lab run and the two settled testnet rounds.
9. **Owner trust for the allowlist.** A dishonest ledger owner could trust a fake vault. The owner has no other power, and `VaultTrusted` events make every change public.
