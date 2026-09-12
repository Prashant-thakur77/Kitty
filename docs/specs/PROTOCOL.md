# Kitty Protocol Specification

This is the normative description of the contracts in [`src/`](../../src). Where this document and the Solidity disagree, the Solidity is right and this document has a bug; every symbol, constant and formula below is taken from the code at the paths given. The narrative is in [`../TECH.md`](../TECH.md).

## Contents

1. [Definitions](#1-definitions)
2. [System components](#2-system-components)
3. [Data model](#3-data-model)
4. [State machines](#4-state-machines)
5. [KittyLedger external interface](#5-kittyledger-external-interface)
6. [KittyVault external interface](#6-kittyvault-external-interface)
7. [Auxiliary contracts](#7-auxiliary-contracts)
8. [Event catalogue](#8-event-catalogue)
9. [Error catalogue](#9-error-catalogue)
10. [Query-id derivation](#10-query-id-derivation)
11. [Invariants](#11-invariants)

## 1. Definitions

| Term | Meaning |
|---|---|
| Source chain | The chain where members hold and pay stablecoins. Identified on Creditcoin by an Attestcoin chain key (Sepolia is key 1 on CC3 Testnet; Ethereum mainnet is key 3). |
| Vault | A `KittyVault` deployment on a source chain. Escrows tokens and emits `Contributed` and `PaidOut`. |
| Ledger | A `KittyLedger` deployment on Creditcoin. Holds circles, rounds, contributions and member records. |
| Circle | A group of 2 to 10 members, an installment, a round length in source-chain blocks, a start height, a vault and a chain key. |
| Round | One installment period of a circle, numbered from 0. A circle of `n` members has rounds `0 .. n-1`. |
| Proof | A Proof Builder response: prover `txBytes` (EvmV1 encoding), a Merkle inclusion proof and a continuity proof, verifiable by the block-prover precompile at `0x0000000000000000000000000000000000000FD2`. |
| Attested | A source-chain height that the ChainInfo precompile at `0x0000000000000000000000000000000000000fD3` reports as covered by an attestation. |
| Query id | `keccak256(chainKey ‖ height ‖ txIndex)`, see section 10. The identity of a proven transaction. |
| Steward | The off-chain worker in `worker/`. Holds no ledger role. |
| Operator | The address allowed to call `KittyVault.payout`. Set by the vault owner. |

## 2. System components

| Contract | Chain | File | Role |
|---|---|---|---|
| `KittyVault` | source | `src/source/KittyVault.sol` | Escrow and event emitter. `Ownable`, `ReentrancyGuard`. |
| `TestUSD` | source | `src/source/TestUSD.sol` | 6-decimal demo stablecoin with open `mint`. |
| `FakeVault` | source | `src/source/FakeVault.sol` | Attack-lab spoof emitter. Never trusted by the ledger. |
| `KittyLedger` | Creditcoin | `src/asc/KittyLedger.sol` | The Attestcoin Smart Contract. `Ownable` (owner curates the vault allowlist only). |
| `KittyViewer` | Creditcoin | `src/asc/KittyViewer.sol` | Read-only aggregation for one-call hydration. |
| `KittyUSD` | Creditcoin | `src/asc/KittyUSD.sol` | 6-decimal demo lending asset with open `mint`. |
| `KittyCreditLine` | Creditcoin | `src/asc/KittyCreditLine.sol` | Demo lender underwriting from the ledger. `ReentrancyGuard`. |
| `KittyBadge` | Creditcoin | `src/asc/KittyBadge.sol` | ERC-721 with ERC-5192 `locked`; soulbound score badge. |
| `IChainInfo` | Creditcoin | `src/interfaces/IChainInfo.sol` | Interface to the ChainInfo precompile (8 of its functions). |

Precompiles (Creditcoin): block prover `0x…0FD2` as `INativeQueryVerifier` from `@gluwa/asc-contracts@0.2.1`; ChainInfo `0x…0fD3` as `IChainInfo`. `EvmV1Decoder` (same package) is an internal library linked into `KittyLedger`.

Constants (`KittyLedger`):

| Constant | Value |
|---|---|
| `CONTRIBUTED_SIG` | `keccak256("Contributed(uint256,uint32,address,uint256)")` |
| `PAIDOUT_SIG` | `keccak256("PaidOut(uint256,uint32,address,uint256)")` |
| `MAX_BATCH` | 10 |
| `MAX_MEMBERS` | 10 |
| `GRACE_BLOCKS` | 64 |
| `VERIFIER` (immutable) | `NativeQueryVerifierLib.getVerifier()`, the `0x0FD2` precompile |
| `CHAIN_INFO` (immutable) | `ChainInfoLib.chainInfo()`, the `0x0fD3` precompile |
| `SOURCE_CHAIN_KEY` (immutable) | constructor argument; the default chain key for the 6-argument `createCircle` and `createOpenCircle` overloads and the 2-argument `setTrustedVault` |

## 3. Data model

### 3.1 `KittyLedger.Circle`

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | Display name. Not validated. |
| `members` | `address[]` | Members in join order. Fixed rotation uses this order. Length 2..10 once invites are closed. |
| `contribution` | `uint256` | Exact installment per member per round in token units (6 decimals on the demo tokens). A `Contributed` log with any other amount is rejected. |
| `roundBlocks` | `uint64` | Round length in source-chain blocks. Must be non-zero and at most `2^40`. |
| `startHeight` | `uint64` | Source-chain block at which round 0 opens. Must be at most `type(uint64).max / 4`. A payment proven below it is rejected. |
| `currentRound` | `uint32` | The open round. Advances in `closeRound`. |
| `sourceVault` | `address` | The only vault whose logs may feed this circle. Non-zero for every existing circle (the existence test in `_circle`). |
| `status` | `CircleStatus` | `Active` (0) or `Completed` (1). |
| `organiser` | `address` | `msg.sender` of the creating call. Signs invites; may call `setRotation` and `closeInvites`. |
| `open` | `bool` | Invites still redeemable. Only `createOpenCircle` sets it; `closeInvites` clears it. No contribution can be recorded while true. |
| `maxMembers` | `uint32` | Cap for open circles; set to `members.length` at creation for listed circles and by `closeInvites`. |
| `rotation` | `Rotation` | `Fixed` (0) or `ByScore` (1). Default `Fixed`. |
| `chainKey` | `uint64` | The source chain the circle settles from. Validated against the ChainInfo registry at creation. |

### 3.2 `KittyLedger.Round`

| Field | Type | Meaning |
|---|---|---|
| `status` | `RoundStatus` | `Open` (0), `Closed` (1), `Paid` (2). |
| `contributions` | `uint32` | Number of proven contributions this round. At most `members.length`. |
| `pot` | `uint256` | Sum of proven contributions plus any pot carried from the previous round; zeroed if carried forward. |
| `recipient` | `address` | Chosen at close. Zero when nobody was eligible. |
| `payoutQueryId` | `bytes32` | Query id of the proven `PaidOut` transaction; non-zero iff `status == Paid`. |
| `attestedCloseHeight` | `uint64` | Height of the attestation that proved the deadline (from `find_lowest_attested_after(chainKey, closeHeight)`). Zero when the round closed early because everyone paid. |
| `attestedCloseHash` | `bytes32` | Hash from the same call. Zero on an early close. |

### 3.3 `KittyLedger.Contribution`

| Field | Type | Meaning |
|---|---|---|
| `height` | `uint64` | Source-chain block that contained the payment. |
| `queryId` | `bytes32` | Proof identity. Non-zero iff the contribution exists. |
| `onTime` | `bool` | `height <= deadlineHeight(circleId, round)` at recording time. |

### 3.4 `KittyLedger.MemberRecord`

| Field | Type | Meaning |
|---|---|---|
| `onTime` | `uint32` | Count of on-time proven installments across all circles. |
| `late` | `uint32` | Count of late proven installments. |
| `missed` | `uint32` | Count of rounds closed on the deadline path where the member had consented and had no contribution. |
| `received` | `uint32` | Count of pots received. |
| `volume` | `uint256` | Sum of proven contribution amounts. The base of `KittyCreditLine`'s limit. |

### 3.5 Other ledger storage

| Name | Type | Meaning |
|---|---|---|
| `circleCount` | `uint256` | Ids are `1 .. circleCount`. Id 0 never exists. |
| `isMember[circleId][addr]` | `bool` | Listed or joined. |
| `receivedPot[circleId][addr]` | `bool` | Has received a pot in this circle. |
| `trustedVault[chainKey][vault]` | `bool` | Owner-curated allowlist, keyed by source chain. |
| `trustedVaultChains[vault]` | `uint64` | Number of chains `vault` is trusted on. Diagnostics for `_rejectEmitter`. |
| `accepted[circleId][addr]` | `bool` | Consent. Set by organising, invite redemption, `acceptMembership`, or a recorded contribution. |
| `usedInviteNonces[circleId][nonce]` | `bool` | Invite replay protection. |
| `processedQueries[queryId]` | `bool` | Proof replay protection, shared by every proving entry point. |

### 3.6 `KittyVault` storage

| Name | Type | Meaning |
|---|---|---|
| `TOKEN` | `IERC20` immutable | The escrowed token. |
| `operator` | `address` | The only caller of `payout`. |
| `pot[circleId]` | `uint256` | Escrowed balance per circle, across rounds. |
| `paidOut[circleId][round]` | `bool` | One payout per `(circle, round)`. |
| `contributor[circleId][addr]` | `bool` | Anyone who ever paid into the circle; the only allowed payout recipients. |

## 4. State machines

### 4.1 Circle

```
                 createCircle / createOpenCircle
                              |
                              v
        +------------------ Active ------------------+
        |   open = true (createOpenCircle only)      |
        |      redeemInvite, closeInvites            |
        |   open = false: rounds may record          |
        +--------------------------------------------+
                              |
                closeRound on round n-1
                              v
                          Completed
```

| Transition | Trigger | Who | Guards |
|---|---|---|---|
| none to `Active` | `createCircle` (either overload) | anyone | 2..10 distinct non-zero members; `contribution != 0`; `roundBlocks != 0`; `get_chain_by_key(chainKey).exists`; `trustedVault[chainKey][sourceVault]`; `startHeight <= type(uint64).max / 4` and `roundBlocks <= 2^40`; `startHeight + roundBlocks > latest attested height` when an attestation exists |
| none to `Active`, `open = true` | `createOpenCircle` | anyone (becomes organiser) | `2 <= maxMembers <= 10`; the same `_initCircle` guards |
| `open = true`, add member | `redeemInvite` | invitee | circle open; nonce unused; not already a member; `members.length < maxMembers`; round 0 still open with zero contributions; signature recovers to the organiser |
| `open = true` to `open = false` | `closeInvites` | organiser | at least 2 members; not already closed |
| `rotation` set | `setRotation` | organiser | `currentRound == 0`, round 0 has no contributions and is `Open` |
| `Active` to `Completed` | `closeRound` when `currentRound + 1 == members.length` | anyone | round close guards (4.2) |

A circle never leaves `Completed`. `redeemInvite` and `closeInvites` are unreachable once `open` is false.

### 4.2 Round

```
   RoundOpened (creation for round 0; closeRound for r+1)
                    |
                    v
                  Open  <-- recordContributions (0..n times, one per member)
                    |
        closeRound: everyone paid, or closeHeight attested
                    v
                 Closed
                    |
     confirmPayout / confirmPayouts with a PaidOut proof
     matching (recipient, pot)
                    v
                  Paid
```

| Transition | Trigger | Who | Guards |
|---|---|---|---|
| `Open`, record | `recordContributions` | anyone with a proof | the 19 checks in section 5.9 |
| `Open` to `Closed` | `closeRound` | anyone | circle `Active`; `!open`; round `Open`; and either `contributions == members.length` or `is_height_attested(chainKey, closeHeight)` |
| `Closed` to `Paid` | `confirmPayout`, `confirmPayouts` | anyone with a proof | round `Closed`; `recipient != 0`; log recipient and amount equal `recipient` and `pot`; emitter and chain checks |

Rounds do not reopen. A round with `recipient == 0` (nobody eligible) stays `Closed` forever; its pot has been carried to the next round or, on the final round with no payer at all, stays recorded on the round.

Round `r`'s deadline and close height, for every `r`:

```
deadlineHeight(c, r) = startHeight + (r + 1) * roundBlocks
closeHeight(c, r)    = deadlineHeight(c, r) + GRACE_BLOCKS
```

### 4.3 Member consent

`accepted[circleId][m]` moves from false to true exactly once, in `_accept`, which also appends `circleId` to `_memberCircles[m]` and emits `MembershipAccepted`. It is reached from `_createOpenCircle` (organiser), `redeemInvite`, `acceptMembership`, and `_recordContribution`. Members listed by `createCircle` start unconsented.

## 5. KittyLedger external interface

Access is "anyone" unless stated. All state-changing functions are non-payable. Line numbers refer to `src/asc/KittyLedger.sol`.

### 5.1 `createCircle(string name, address[] members, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault) returns (uint256 circleId)` (line 261)

Delegates to the 7-argument overload with `chainKey = SOURCE_CHAIN_KEY`.

### 5.2 `createCircle(string name, address[] members, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault, uint64 chainKey) returns (uint256 circleId)` (line 277)

Preconditions: `2 <= members.length <= MAX_MEMBERS` else `InvalidCircle("2..10 members")`; every member non-zero and distinct else `InvalidCircle("duplicate/zero member")`; `_initCircle` guards: `contribution != 0` else `InvalidCircle("contribution")`; `roundBlocks != 0` else `InvalidCircle("roundBlocks")`; `CHAIN_INFO.get_chain_by_key(chainKey).exists` else `UnsupportedSourceChain(chainKey)`; `sourceVault != 0 && trustedVault[chainKey][sourceVault]` else `VaultNotTrusted(sourceVault)`; `startHeight <= type(uint64).max / 4 && roundBlocks <= 2^40` else `InvalidCircle("height range")`; if `get_latest_attestation_height_and_hash(chainKey).exists` then `startHeight + roundBlocks > latest.height` else `InvalidCircle("round 0 already attested")`.

Effects: `circleId = ++circleCount`; stores all fields with `organiser = msg.sender`, `maxMembers = members.length`, `open = false`, `rotation = Fixed`; each member gets `isMember = true` and is pushed, without consent.

Events: `CircleCreated`, `CircleChainSet`, `RoundOpened(circleId, 0, deadlineHeight(circleId, 0))`.

### 5.3 `createOpenCircle(string name, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault, uint32 maxMembers) returns (uint256)` (line 290) and the 7-argument overload with `chainKey` (line 304)

Preconditions: `2 <= maxMembers <= MAX_MEMBERS` else `InvalidCircle("2..10 members")`; the `_initCircle` guards of 5.2.

Effects: as 5.2, then `open = true`; `msg.sender` joins with consent (`MembershipAccepted`).

Events: `MembershipAccepted`, `CircleCreated` (members array of one), `CircleChainSet`, `RoundOpened`.

### 5.4 `redeemInvite(uint256 circleId, uint256 nonce, bytes sig)` (line 362)

Access: the invitee (`msg.sender` is bound into the digest).

Preconditions, in order: circle exists else `UnknownCircle`; `open` else `CircleNotOpen`; nonce unused else `InviteAlreadyUsed`; not a member else `AlreadyMember`; `members.length < maxMembers` else `CircleFull`; `currentRound == 0 && rounds[0].contributions == 0` else `CircleStillOpen`; `ECDSA.recover(inviteDigest(circleId, msg.sender, nonce), sig) == organiser` else `InvalidInviteSigner(signer, organiser)` (or an OpenZeppelin `ECDSA` error on a malformed signature).

Effects: nonce marked used; sender joins with consent.

Events: `MembershipAccepted`, `InviteRedeemed`.

### 5.5 `inviteDigest(uint256 circleId, address invitee, uint256 nonce) view returns (bytes32)` (line 423)

`MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(address(this), block.chainid, circleId, invitee, nonce)))`. The EIP-191 digest an organiser signs. Binds the ledger address, the Creditcoin chain id, the circle, the invitee and a nonce.

### 5.6 `closeInvites(uint256 circleId)` (line 412)

Access: organiser else `NotOrganiser`. Preconditions: `open` else `InvitesAlreadyClosed`; `members.length >= 2` else `InvalidCircle("2..10 members")`. Effects: `open = false`; `maxMembers = members.length`. Event: `InvitesClosed`.

### 5.7 `setRotation(uint256 circleId, Rotation mode)` (line 382)

Access: organiser else `NotOrganiser`. Precondition: `currentRound == 0 && rounds[0].contributions == 0 && rounds[0].status == Open` else `RotationLocked`. Effect: `rotation = mode`. Event: `RotationSet`.

### 5.8 `setTrustedVault(uint64 chainKey, address vault, bool trusted)` (line 392) and `setTrustedVault(address vault, bool trusted)` (line 402)

Access: owner (`onlyOwner`; OpenZeppelin `OwnableUnauthorizedAccount(caller)`). The 2-argument form calls the 3-argument form with `SOURCE_CHAIN_KEY`, and the `onlyOwner` check runs there. Effects: sets `trustedVault[chainKey][vault]`; increments or decrements `trustedVaultChains[vault]` only when the flag actually changes. Event: `VaultTrusted` (emitted even on a no-op).

### 5.9 `acceptMembership(uint256 circleId)` (line 407)

Access: a listed member else `NotAMember`. Effect: consent (idempotent). Event: `MembershipAccepted` on first call only.

### 5.10 `closeRound(uint256 circleId)` (line 431)

Preconditions: circle exists; `status == Active` else `CircleNotActive`; `!open` else `CircleStillOpen`; round `Open` else `RoundNotOpen`; if `contributions < members.length` then `is_height_attested(chainKey, closeHeight)` else `RoundStillOpenOnSource(closeHeight)`.

Effects, in order:
1. On the deadline path, store `attestedCloseHeight` and `attestedCloseHash` from `find_lowest_attested_after(chainKey, closeHeight)`.
2. For each member with no contribution and `accepted == true`: `records[m].missed += 1`, emit `ContributionMissed`.
3. `recipient = _pickRecipient(…, ignoreReceived = false)`; if none and this is the final round, retry with `ignoreReceived = true` and note the fallback.
4. `status = Closed`, `recipient` stored. If a recipient exists: `receivedPot = true`, `records[recipient].received += 1`, `FallbackRecipient` if applicable. Else if not the final round and `pot > 0`: add the pot to round `r + 1`, emit `PotCarriedOver`, zero this round's pot.
5. Emit `RoundClosed(circleId, r, recipient, pot, missed, attestedCloseHeight)`.
6. Final round: `status = Completed`, `CircleCompleted`. Otherwise `currentRound = r + 1`, `RoundOpened(circleId, r + 1, deadlineHeight(circleId, r + 1))`.

`_pickRecipient` requires a proven contribution this round in both modes. `Fixed`: first of `members[(r + k) % n]`, `k = 0..n-1`, that paid and (unless `ignoreReceived`) has not received. `ByScore`: highest `creditScore` among payers who (unless `ignoreReceived`) have not received; the first member wins ties.

### 5.11 `recordContributions(uint64 chainKey, uint64[] heights, bytes[] encodedTxs, MerkleProof[] merkleProofs, ContinuityProof continuity)` (line 502)

Preconditions (`_prepareBatch`, view): `heights.length != 0` else `EmptyBatch`; `<= MAX_BATCH` else `BatchTooLarge(n)`; array lengths equal else `LengthMismatch`; no query id processed or repeated else `QueryAlreadyProcessed(qid)`.

Verification: `VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity)` must return true else `ProofRejected` (a precompile revert propagates as is).

Per element `i`, `processedQueries[qid_i] = true` then `_recordContribution`, whose checks in order are:

| # | Condition | Error |
|---|---|---|
| 1 | valid EvmV1 transaction type | `UnsupportedTxType(txType)` |
| 2 | `receiptStatus == 1` | `SourceTxFailed()` |
| 3 | at least one log with `CONTRIBUTED_SIG` | `ExpectedExactlyOneLog(0)` |
| 4 | at least one of them from a vault in `trustedVault[chainKey]` | `WrongChain(chainKey, c.chainKey)` if the emitter is the circle's own vault trusted elsewhere, else `WrongEmitter(logs[0].address_, 0)` |
| 5 | exactly one from a trusted vault | `ExpectedExactlyOneLog(found)` |
| 6 | 4 topics, 32 data bytes, round fits `uint32` | `BadLogShape()` |
| 7 | circle exists | `UnknownCircle(circleId)` |
| 8 | `chainKey == c.chainKey` | `WrongChain(chainKey, c.chainKey)` |
| 9 | circle `Active` | `CircleNotActive(circleId)` |
| 10 | invites closed | `CircleStillOpen(circleId)` |
| 11 | `log.address_ == c.sourceVault` | `WrongEmitter(got, want)` |
| 12 | tx `to` non-null and `== c.sourceVault` | `TxNotToVault(got, want)` |
| 13 | tx `from == member` | `SenderMismatch(from, member)` |
| 14 | `isMember[circleId][member]` | `NotAMember(circleId, member)` |
| 15 | `amount == c.contribution` | `WrongAmount(got, want)` |
| 16 | `round == c.currentRound` | `NotCurrentRound(got, want)` |
| 17 | `height >= c.startHeight` | `BeforeCircleStart(height, startHeight)` |
| 18 | round `Open` | `RoundNotOpen(circleId, round)` |
| 19 | no prior contribution | `AlreadyContributed(circleId, round, member)` |

Effects per element: consent; `Contribution{height, qid, onTime}` stored; `contributions += 1`; `pot += amount`; `records[member].onTime` or `.late += 1`; `volume += amount`; `ContributionRecorded`. After the loop: `BatchVerified(chainKey, minHeight, maxHeight, n)`.

Atomicity: any failure reverts the whole batch, including the precompile call.

### 5.12 `confirmPayout(uint64 chainKey, uint64 height, bytes encodedTx, MerkleProof merkleProof, ContinuityProof continuity)` (line 528)

Preconditions: query id unprocessed else `QueryAlreadyProcessed`; single-overload `verifyAndEmit` true else `ProofRejected`; then `_confirmPayout`: checks 1 to 6 as above with `PAIDOUT_SIG`; circle exists; `chainKey == c.chainKey` else `WrongChain`; `log.address_ == c.sourceVault` else `WrongEmitter`; round `Closed` else `RoundNotClosed`; `recipient != 0` else `NoRecipient`; log recipient `== rd.recipient` and amount `== rd.pot` else `PayoutMismatch`.

Effects: `status = Paid`, `payoutQueryId = qid`. Event: `PayoutConfirmed`.

### 5.13 `confirmPayouts(uint64 chainKey, uint64[] heights, bytes[] encodedTxs, MerkleProof[] merkleProofs, ContinuityProof continuity)` (line 547)

The batch form of 5.12 with the `_prepareBatch` prologue and a `BatchVerified` event. Payouts from different circles may share the continuity proof.

### 5.14 Views

| Function | Returns |
|---|---|
| `getCircle(uint256)` | `Circle`; reverts `UnknownCircle` for a missing id |
| `getRound(uint256, uint32)` | `Round` (zeroed for a round that does not exist) |
| `getContribution(uint256, uint32, address)` | `Contribution` |
| `getRecord(address)` | `MemberRecord` |
| `getMemberCircles(address)` | consented circle ids in consent order |
| `deadlineHeight(uint256, uint32)` | `startHeight + (round + 1) * roundBlocks` (does not check existence; a missing circle yields 0) |
| `closeHeight(uint256, uint32)` | `deadlineHeight + GRACE_BLOCKS` |
| `creditScore(address)` | `(uint16 score, string tier)`, see 11.7 |
| `inviteDigest(uint256, address, uint256)` | see 5.5 |
| public mappings | `circleCount`, `isMember`, `receivedPot`, `trustedVault`, `trustedVaultChains`, `accepted`, `usedInviteNonces`, `processedQueries` |
| public constants and immutables | `CONTRIBUTED_SIG`, `PAIDOUT_SIG`, `MAX_BATCH`, `MAX_MEMBERS`, `GRACE_BLOCKS`, `VERIFIER`, `CHAIN_INFO`, `SOURCE_CHAIN_KEY`, `owner()` |

## 6. KittyVault external interface

File: `src/source/KittyVault.sol`.

### 6.1 `constructor(IERC20 token, address operator_)`

Sets `TOKEN`, `operator`; owner is the deployer. Emits `OperatorChanged`.

### 6.2 `setOperator(address operator_)`

Access: owner. Effect: replaces the operator. Event: `OperatorChanged`.

### 6.3 `contribute(uint256 circleId, uint32 round, uint256 amount)`, `nonReentrant`

Access: anyone. No membership, circle or round check by design; the ledger decides whether the payment counts.

Preconditions: `amount != 0` else `ZeroAmount`; `TOKEN.safeTransferFrom(msg.sender, this, amount)` succeeds (requires allowance and balance; a failure reverts with the token's error, and the mined-but-reverted transaction is what the `revertedTx` scenario proves).

Effects: `pot[circleId] += amount`; `contributor[circleId][msg.sender] = true`. Event: `Contributed(circleId, round, msg.sender, amount)`.

### 6.4 `payout(uint256 circleId, uint32 round, address recipient, uint256 amount)`, `nonReentrant`

Access: `operator` else `NotOperator`.

Preconditions, in order: not already paid for `(circleId, round)` else `AlreadyPaid`; `amount != 0` else `ZeroAmount`; `pot[circleId] >= amount` else `InsufficientPot`; `contributor[circleId][recipient]` else `NotAContributor`.

Effects: `paidOut[circleId][round] = true`; `pot[circleId] -= amount`; `TOKEN.safeTransfer(recipient, amount)`. Event: `PaidOut(circleId, round, recipient, amount)`.

### 6.5 Views

`TOKEN()`, `operator()`, `pot(uint256)`, `paidOut(uint256, uint32)`, `contributor(uint256, address)`, `owner()`.

## 7. Auxiliary contracts

### 7.1 `KittyViewer`

`getCircleFull(circleId)` returns the circle, rounds `0 .. currentRound`, every member's current-round contribution, score, tier and record, and the current deadline. `getMemberDashboard(member)` returns the member's consented circles with names, current rounds and a per-circle status, plus score, tier and record. `memberStatus(circleId, round, member)` returns `STATUS_PENDING` (0), `STATUS_PROVEN` (1), `STATUS_LATE` (2) or `STATUS_MISSED` (3): proven contributions map to 1 or 2 by `onTime`; otherwise 0 while the round is `Open` and 3 once it is not.

### 7.2 `KittyCreditLine`

Constants `CAP = 5_000e6`, `FEE_BPS = 500`. `deposit(amount)` mints share units at `amount * totalDeposits / poolValue()` (or 1:1 for the first deposit or an empty pool). `withdraw(amount)` requires `amount <= entitlement(lp)` and `<= liquidity()` and burns units rounded up. `borrow(amount)` requires `amount <= availableCredit(caller)` and `<= liquidity()`, adds `amount * 500 / 10_000` fee to the debt. `repay(amount)` clamps to the debt. `creditLimit(member)`: 0 if `onTime + late + missed == 0`; else `min(CAP, volume * factor / 100)` with factor by tier A 100, B 50, C 20, D 0. `underwrite(member)` returns `(score, tier, limit, reason)`.

### 7.3 `KittyBadge`

`claim()`: requires `onTime + late + missed > 0` else `NoProvenHistory`, one badge per address else `AlreadyClaimed`, `tokenId = uint160(caller)`, emits `Locked`. `locked(tokenId)` is always true for an owned token. `_update` reverts `Soulbound()` for any transfer or burn; `approve` and `setApprovalForAll` revert `Soulbound()`. `tokenURI`, `metadata`, `image` render from the live ledger.

## 8. Event catalogue

### 8.1 `KittyLedger`

| Event | Emitted by | Meaning |
|---|---|---|
| `CircleCreated(uint256 indexed circleId, string name, address[] members, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault)` | creation | A circle exists. For open circles `members` holds only the organiser. |
| `CircleChainSet(uint256 indexed circleId, uint64 indexed chainKey)` | creation | The source chain the circle settles from. |
| `RoundOpened(uint256 indexed circleId, uint32 indexed round, uint64 deadlineHeight)` | creation (round 0), `closeRound` | A round is open; pay by this source-chain block. |
| `MembershipAccepted(uint256 indexed circleId, address indexed member)` | `_accept` | Consent recorded; from now on the member can be marked missed. |
| `InviteRedeemed(uint256 indexed circleId, address indexed member, uint256 nonce)` | `redeemInvite` | An invite was consumed. |
| `InvitesClosed(uint256 indexed circleId, uint256 memberCount)` | `closeInvites` | Membership is fixed. |
| `RotationSet(uint256 indexed circleId, Rotation rotation)` | `setRotation` | Rotation mode chosen before the first proof. |
| `VaultTrusted(uint64 indexed chainKey, address indexed vault, bool trusted)` | `setTrustedVault` | Allowlist change (also on a no-op). |
| `BatchVerified(uint64 indexed chainKey, uint64 fromHeight, uint64 toHeight, uint256 count)` | `recordContributions`, `confirmPayouts` | One precompile call verified `count` transactions spanning these heights. |
| `ContributionRecorded(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount, uint64 sourceHeight, bool onTime, bytes32 queryId)` | `_recordContribution` | A proven payment was credited. |
| `ContributionMissed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint64 deadlineHeight, uint64 attestedHeight, bytes32 attestedHash)` | `closeRound` | A consented member had no proven payment when the attested close height passed; the last two fields name the attestation. |
| `RoundClosed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 pot, uint32 missedCount, uint64 attestedHeight)` | `closeRound` | `attestedHeight == 0` on an early close. `recipient == 0` when nobody was eligible. |
| `PotCarriedOver(uint256 indexed circleId, uint32 indexed fromRound, uint256 amount)` | `closeRound` | No eligible recipient on a non-final round. |
| `FallbackRecipient(uint256 indexed circleId, uint32 indexed round, address indexed recipient)` | `closeRound` | Final round paid to a payer who had already received. |
| `CircleCompleted(uint256 indexed circleId)` | `closeRound` | Final round closed. |
| `PayoutConfirmed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount, bytes32 queryId)` | `_confirmPayout` | The source-chain payout is proven; the round is `Paid`. |

Inherited: `OwnershipTransferred` from `Ownable`.

### 8.2 `KittyVault`

| Event | Meaning |
|---|---|
| `Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount)` | Escrow received. Signature equals `KittyLedger.CONTRIBUTED_SIG` (`test_eventSignaturesMatchLedgerConstants`). |
| `PaidOut(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount)` | Escrow released. Signature equals `PAIDOUT_SIG`. |
| `OperatorChanged(address indexed operator)` | Operator set. |

### 8.3 Auxiliary

`KittyCreditLine`: `Deposited(lp, amount)`, `Withdrawn(lp, amount)`, `Borrowed(member, amount, fee, outstanding)`, `Repaid(member, amount, outstanding)`. `KittyBadge`: `Locked(tokenId)`, `Unlocked(tokenId)` (declared by ERC-5192, never emitted), plus ERC-721 `Transfer` on mint.

## 9. Error catalogue

### 9.1 `KittyLedger`

| Error | Raised by | Condition |
|---|---|---|
| `WrongChain(uint64 got, uint64 want)` | `_recordContribution`, `_confirmPayout`, `_rejectEmitter` | batch chain key differs from the circle's |
| `EmptyBatch()` | `_prepareBatch` | zero queries |
| `BatchTooLarge(uint256 n)` | `_prepareBatch` | more than 10 |
| `LengthMismatch()` | `_prepareBatch` | array lengths differ |
| `QueryAlreadyProcessed(bytes32 queryId)` | `_prepareBatch`, `confirmPayout` | replay or in-batch duplicate |
| `ProofRejected()` | proving entry points | precompile returned false |
| `UnsupportedTxType(uint8 txType)` | `_singleLog` | EvmV1 type outside 0..4 |
| `SourceTxFailed()` | `_singleLog` | receipt status not 1 |
| `ExpectedExactlyOneLog(uint256 n)` | `_singleLog` | zero matching logs, or more than one trusted-vault log |
| `BadLogShape()` | `_decodeVaultLog` | topics or data of the wrong size, or round above `uint32` |
| `UnknownCircle(uint256 circleId)` | `_circle` | no such circle |
| `CircleNotActive(uint256 circleId)` | `closeRound`, `_recordContribution` | circle completed |
| `WrongEmitter(address got, address want)` | `_recordContribution`, `_confirmPayout`, `_rejectEmitter` | log not from the circle's vault (`want == 0` from `_rejectEmitter`) |
| `TxNotToVault(address got, address want)` | `_recordContribution` | transaction target is not the vault |
| `SenderMismatch(address txFrom, address logMember)` | `_recordContribution` | transaction sender is not the logged member |
| `NotAMember(uint256 circleId, address member)` | `_recordContribution`, `acceptMembership` | address not listed |
| `WrongAmount(uint256 got, uint256 want)` | `_recordContribution` | amount differs from the installment |
| `RoundNotOpen(uint256 circleId, uint32 round)` | `closeRound`, `_recordContribution` | round already closed |
| `NotCurrentRound(uint32 got, uint32 want)` | `_recordContribution` | payment tagged with another round |
| `BeforeCircleStart(uint64 height, uint64 startHeight)` | `_recordContribution` | payment mined before the circle's start |
| `AlreadyContributed(uint256 circleId, uint32 round, address member)` | `_recordContribution` | second payment by the same member |
| `RoundStillOpenOnSource(uint64 deadlineHeight)` | `closeRound` | close height not attested (the argument is the close height) |
| `RoundNotClosed(uint256 circleId, uint32 round)` | `_confirmPayout` | payout proof for an open or paid round |
| `PayoutMismatch()` | `_confirmPayout` | recipient or amount differs from the round |
| `InvalidCircle(string reason)` | creation, `closeInvites` | `"2..10 members"`, `"duplicate/zero member"`, `"contribution"`, `"roundBlocks"`, `"height range"`, `"round 0 already attested"` |
| `RotationLocked(uint256 circleId)` | `setRotation` | round 0 already has a proof or is closed |
| `CircleStillOpen(uint256 circleId)` | `redeemInvite`, `closeRound`, `_recordContribution` | invites open (or, in `redeemInvite`, round 0 already started) |
| `CircleNotOpen(uint256 circleId)` | `redeemInvite` | circle does not accept invites |
| `NotOrganiser(uint256 circleId)` | `setRotation`, `closeInvites` | caller is not the organiser |
| `InviteAlreadyUsed(uint256 circleId, uint256 nonce)` | `redeemInvite` | nonce consumed |
| `InvalidInviteSigner(address got, address want)` | `redeemInvite` | signature not from the organiser |
| `AlreadyMember(uint256 circleId, address member)` | `redeemInvite` | invitee already listed |
| `CircleFull(uint256 circleId, uint32 maxMembers)` | `redeemInvite` | cap reached |
| `InvitesAlreadyClosed(uint256 circleId)` | `closeInvites` | second close |
| `VaultNotTrusted(address vault)` | `_initCircle` | vault not on the allowlist for that chain |
| `UnsupportedSourceChain(uint64 chainKey)` | `_initCircle` | registry has no such chain |
| `NoRecipient(uint256 circleId, uint32 round)` | `_confirmPayout` | round closed with no recipient |

Inherited: `OwnableUnauthorizedAccount(address)`, `OwnableInvalidOwner(address)` from `Ownable`; `ECDSAInvalidSignature*` from `ECDSA`.

### 9.2 `KittyVault`

| Error | Raised by | Condition |
|---|---|---|
| `NotOperator()` | `payout` | caller is not `operator` |
| `ZeroAmount()` | `contribute`, `payout` | `amount == 0` |
| `AlreadyPaid()` | `payout` | `(circleId, round)` already paid |
| `InsufficientPot()` | `payout` | `pot[circleId] < amount` |
| `NotAContributor()` | `payout` | recipient never paid into the circle |

Inherited: `OwnableUnauthorizedAccount`, `ReentrancyGuardReentrantCall`, `SafeERC20FailedOperation`.

### 9.3 Auxiliary

`KittyCreditLine`: `ZeroAmount`, `InsufficientDeposit(requested, deposited)`, `InsufficientLiquidity(requested, available)`, `ExceedsCreditLimit(requested, available)`, `NothingToRepay`. `KittyBadge`: `NoProvenHistory(member)`, `AlreadyClaimed(member)`, `Soulbound`, plus ERC-721 errors.

## 10. Query-id derivation

```solidity
function _computeQueryId(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProof calldata merkleProof)
    internal view returns (bytes32 queryId)
{
    uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);
    assembly {
        let ptr := mload(0x40)
        mstore(ptr, chainKey)                 // 32 bytes, left-padded uint64
        mstore(add(ptr, 32), shl(192, blockHeight)) // 8 bytes at offset 32
        mstore(add(ptr, 40), txIndex)         // 32 bytes at offset 40
        queryId := keccak256(ptr, 72)
    }
}
```

The 72-byte preimage is `uint256(chainKey) ‖ uint64(blockHeight) ‖ uint256(txIndex)`. `txIndex` comes from the precompile, derived from the Merkle proof's position, so two different transactions in the same block cannot collide and the same transaction always yields the same id whatever the submitter. The derivation is byte-identical to `ASCBase._computeQueryId` in `@gluwa/asc-contracts@0.2.1` (`contracts/readability/ASCBase.sol`). `processedQueries` is one mapping shared by `recordContributions`, `confirmPayout` and `confirmPayouts`, so a transaction proven under one entry point can never be proven again under another.

## 11. Invariants

Each invariant names the code that maintains it and a test that exercises it.

1. **One contribution per member per round.** `_contributions[c][r][m].queryId != 0` at most once; `AlreadyContributed` guards it, and `Round.contributions <= members.length`. Test: `test_rejectsDoubleContributionByMember`.
2. **Pot equals installment times proven count, plus carry.** For every round, `pot == contribution * contributions + carriedIn`, where `carriedIn` is the sum of `PotCarriedOver` into the round, and a carried-out round has `pot == 0`. Maintained by `_recordContribution` (`WrongAmount`, `pot += amount`) and `closeRound`. Tests: `test_batch_recordsWholeRoundInOnePrecompileCall`, `test_potCarriesOverToNextRound`.
3. **Score is within 300..850.** `creditScore` clamps; a fresh address reads 500, tier C. Test: `test_creditScore_math`.
4. **A payment never predates its circle.** Every recorded `Contribution.height >= startHeight`. Guard: `BeforeCircleStart`. Test: `test_rejectsPaymentThatPredatesTheCircle`.
5. **A proof counts once.** Every query id in `processedQueries` was set exactly once, and no two `Contribution` or `payoutQueryId` values share an id. Guard: `_prepareBatch` and `confirmPayout`. Tests: `test_batch_replayIsRejected`, `test_batch_duplicateInsideBatchIsRejected`, `test_replayOfAConfirmedPayoutIsRejected`, `test_inBatchDuplicateIsRejected`.
6. **Only trusted vaults feed the ledger, per chain.** Every recorded contribution and confirmed payout decoded from a log whose emitter was `trustedVault[chainKey][emitter]` at the time and equal to the circle's `sourceVault`, with `chainKey == circle.chainKey`. Tests: `test_rejectsSpoofedEmitter`, `test_onlyUntrustedEmitterLogs_isWrongEmitter`, `test_vaultTrustedOnAnotherChainIsNotAValidEmitter`, `test_sepoliaBatchCannotFeedAMainnetCircle`, `test_payoutBatchIsBoundToTheCirclesChain`.
7. **Transaction binding.** Every recorded contribution's prover bytes have `to == sourceVault` and `from == member`. Tests: `test_rejectsTxNotSentToVault` and `test_rejectsPaymentRoutedThroughAnotherContract` cover the `to` half; `test_rejectsPaymentSentByAnotherAddress` covers the `from` half (`SenderMismatch`).
8. **No miss without consent.** `records[m].missed` increments only in `closeRound` and only when `accepted[c][m]`. Test: `test_listedButUnconsentedMemberIsNeverPenalised`.
9. **No close before the attested close height unless full.** A round with `contributions < members.length` closes only when `is_height_attested(chainKey, deadline + 64)`. Tests: `test_closeRound_blockedUntilDeadlineAttested`, `test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace`, `test_closeRoundUsesTheCirclesOwnChainForAttestation`.
10. **Every deadline-path close carries evidence.** `attestedCloseHeight != 0` iff the round closed with `contributions < members.length`, and every `ContributionMissed` of that round carries the same height and hash. Test: `test_closeRound_recordsAttestationEvidence`.
11. **The recipient paid.** `Round.recipient` is either zero or an address with a non-zero contribution for that round. Tests: `test_fixedRotation_skipsNonPayer_andCarriesPotWhenNobodyEligible`, `test_finalRound_fallbackPaysAPayer`.
12. **Each member receives at most once, except by explicit fallback.** `receivedPot[c][m]` is set at most once per circle unless `FallbackRecipient` was emitted for the final round. Tests: `test_byScore_missingMemberGoesLast_andEveryoneReceivesOnce`, `test_finalRound_fallbackPaysAPayer`.
13. **Paid means proven.** `Round.status == Paid` iff `payoutQueryId != 0`, and that query id decodes to a `PaidOut` from the circle's vault with `recipient == Round.recipient` and `amount == Round.pot`. Tests: `test_confirmPayout_closesTheLoop`, `test_confirmPayout_rejectsWrongRecipientOrAmount`, `test_confirmPayout_requiresClosedRound`, `test_openRoundCannotBePaidInABatch`.
14. **On-time is a function of height and deadline only.** `Contribution.onTime == (height <= deadlineHeight(c, r))`. Test: `test_lateContributionIsFlagged`.
15. **Rotation is fixed before the first proof.** `rotation` changes only while `currentRound == 0` and round 0 has no contributions. Test: `test_setRotation_onlyOrganiserAndOnlyBeforeFirstProof`.
16. **Membership is fixed before the first proof.** `members` changes only while `open`, and nothing is recorded while `open`. Tests: `test_redeemInvite_rejectsAfterCloseInvites`, `test_redeemInvite_rejectsAfterFirstContribution`, `test_recordContributions_revertsWhileOpen`.
17. **Invites are single-use and bound.** A signature redeems at most once per `(circle, nonce)`, only by the invitee it names, only if signed by the organiser. Tests: `test_redeemInvite_rejectsNonceReplay`, `test_redeemInvite_rejectsInviteForSomeoneElse`, `test_redeemInvite_rejectsWrongSigner`.
18. **Round 0 is in the future at creation.** `startHeight + roundBlocks > latest attested height` whenever the registry reports an attestation. Tests: `test_createCircle_revertsWhenRound0DeadlineAlreadyAttested`, `test_redeemInvite_cannotBeGriefedByPastStart`.
19. **The vault pays each round once, from its own escrow, to a contributor.** `paidOut[c][r]` set at most once; `pot[c]` never underflows; recipients satisfy `contributor[c][recipient]`. Test: `test_payout_onlyOperatorOncePerRound`.
20. **The circle count only grows and ids are dense.** `circleCount` increments by one per creation; every id in `1..circleCount` has a non-zero `sourceVault`. Guard: `_initCircle`. Tests: `test_createCircle_recordsOrganiserAndIndex`, `test_getCircleFull_unknownCircleReverts`.
21. **The score's inputs are proofs and attested deadlines only.** No external function writes `_records` other than through `_recordContribution` and `closeRound`. Verified by inspection of `src/asc/KittyLedger.sol`; enforced socially by the `stealFromSteward` scenario, which shows that the steward key has no path to any counter.
