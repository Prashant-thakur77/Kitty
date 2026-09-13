# Contract reference

A function-by-function reference for every Solidity contract in [`src/`](../../src) and for the two test doubles in [`test/mocks/`](../../test/mocks). Everything here is taken from the code at the line numbers given (`src/asc/KittyLedger.sol` unless another file is named); where a NatSpec comment exists it is quoted, with its punctuation normalised. This document describes *what each function does and when it reverts*. For the narrative see [`../TECH.md`](../TECH.md); for the normative interface, state machines and numbered invariants see [`../specs/PROTOCOL.md`](../specs/PROTOCOL.md); for the adversarial view see [`../THREAT_MODEL.md`](../THREAT_MODEL.md); for measured gas see [`../GAS.md`](../GAS.md); for the storage slots see [`STORAGE_LAYOUT.md`](STORAGE_LAYOUT.md); for the tests see [`../TESTING.md`](../TESTING.md).

## Contents

1. [Toolchain and inventory](#1-toolchain-and-inventory)
2. [KittyLedger](#2-kittyledger)
3. [KittyVault](#3-kittyvault)
4. [TestUSD](#4-testusd)
5. [FakeVault](#5-fakevault)
6. [KittyViewer](#6-kittyviewer)
7. [KittyCreditLine](#7-kittycreditline)
8. [KittyUSD](#8-kittyusd)
9. [KittyBadge](#9-kittybadge)
10. [IChainInfo and ChainInfoLib](#10-ichaininfo-and-chaininfolib)
11. [Test doubles: MockVerifier and MockChainInfo](#11-test-doubles-mockverifier-and-mockchaininfo)

## 1. Toolchain and inventory

`foundry.toml`: `solc_version = "0.8.30"`, `optimizer = true`, `optimizer_runs = 200`, `via_ir = true`, `evm_version = "shanghai"`. Every source file declares `pragma solidity ^0.8.28`. Dependencies are pinned in `package.json`: `@openzeppelin/contracts@5.4.0`, `@gluwa/asc-contracts@0.2.1`. `forge --version` at the time of writing: 1.7.1.

| Contract | Chain | File | Inherits | Runtime size (bytes, `forge build --sizes`) |
|---|---|---|---|---:|
| `KittyLedger` | Creditcoin | `src/asc/KittyLedger.sol` | `Ownable` | 22,306 |
| `KittyViewer` | Creditcoin | `src/asc/KittyViewer.sol` | none | 5,479 |
| `KittyCreditLine` | Creditcoin | `src/asc/KittyCreditLine.sol` | `ReentrancyGuard` | 4,657 |
| `KittyUSD` | Creditcoin | `src/asc/KittyUSD.sol` | `ERC20` | 1,726 |
| `KittyBadge` | Creditcoin | `src/asc/KittyBadge.sol` | `ERC721`, `IERC5192` | 7,971 |
| `KittyVault` | source (Sepolia) | `src/source/KittyVault.sol` | `Ownable`, `ReentrancyGuard` | 1,828 |
| `TestUSD` | source (Sepolia) | `src/source/TestUSD.sol` | `ERC20` | 1,726 |
| `FakeVault` | source (Sepolia) | `src/source/FakeVault.sol` | none | 192 |
| `IChainInfo` | interface | `src/interfaces/IChainInfo.sol` | | |
| `ChainInfoLib` | library | `src/interfaces/IChainInfo.sol` | | 57 (empty library stub) |
| `MockVerifier` | test only | `test/mocks/MockVerifier.sol` | none | 1,057 |
| `MockChainInfo` | test only | `test/mocks/MockChainInfo.sol` | none | 5,497 |

External libraries linked into `KittyLedger`: `EvmV1Decoder` (`@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol`, internal, inlined), `INativeQueryVerifier` and `NativeQueryVerifierLib` (`.../write-ability/common/INativeQueryVerifier.sol`), OpenZeppelin `Ownable`, `ECDSA`, `MessageHashUtils`.

## 2. KittyLedger

### 2.1 Purpose

NatSpec (`KittyLedger.sol:14-30`):

> KittyLedger: proof-settled rotating savings circles on Creditcoin. An Attestcoin Smart Contract (ASC). Every state change that involves money is driven by a *proven* Ethereum transaction, never by an operator's word:
> 1. Members pay their installment into KittyVault on Ethereum (Sepolia).
> 2. The attestor network attests the Sepolia block on Creditcoin.
> 3. A worker fetches ONE batch proof for the whole round (up to 10 contributions sharing a single continuity proof) and calls `recordContributions`.
> 4. This contract asks the block-prover precompile (0x0FD2) to verify inclusion + continuity for all of them in a single call, decodes the `Contributed` logs with EvmV1Decoder, checks the emitter is the registered vault, the amount is exact, the member belongs to the circle, and the source-chain *block height* is on time.
> 5. The round closes when everyone has paid, or when the ChainInfo precompile (0x0FD3) reports the round's deadline block as attested. Missed payments become permanent, proof-backed credit history. The rotation recipient is chosen deterministically.
> 6. The vault operator pays out on Ethereum; that `PaidOut` tx is proven back here so the ledger only shows "Paid" for money that verifiably moved.

### 2.2 Inheritance

`contract KittyLedger is Ownable` (line 38). `Ownable(msg.sender)` in the constructor makes the deployer the owner. The owner's only power is `setTrustedVault` (section 2.8); `Ownable` also contributes `owner()`, `transferOwnership`, `renounceOwnership`, the `OwnershipTransferred` event and the `OwnableUnauthorizedAccount(address)` / `OwnableInvalidOwner(address)` errors.

Why the contract does not inherit `ASCBase` from `@gluwa/asc-contracts` (NatSpec `@dev`, lines 32-37): its `execute` drops `chainKey` and the source `blockHeight` before calling app logic. Kitty needs both, the chain key to bind proofs to Sepolia and the height to enforce deadlines from attested source-chain time, so this contract re-implements the same verify, dedupe, act pipeline (query id derivation is identical to `ASCBase`, section 2.12) and adds the batch entry point.

### 2.3 Constructor and immutables

```solidity
constructor(uint64 sourceChainKey) Ownable(msg.sender)   // line 252
```

| Immutable | Type | Value | Meaning |
|---|---|---|---|
| `VERIFIER` | `INativeQueryVerifier` | `NativeQueryVerifierLib.getVerifier()` = `0x0000000000000000000000000000000000000FD2` | Block-prover precompile. Every proof goes through `verifyAndEmit`; `calculateTxIndex` feeds the query id. |
| `CHAIN_INFO` | `IChainInfo` | `ChainInfoLib.chainInfo()` = `0x0000000000000000000000000000000000000fD3` | ChainInfo precompile. The only clock and the only chain registry. |
| `SOURCE_CHAIN_KEY` | `uint64` | constructor argument (1 for Sepolia on CC3 Testnet) | Default chain key for the 6-argument `createCircle` / `createOpenCircle` overloads and the 2-argument `setTrustedVault`. |

The two precompile addresses are compiled in; tests substitute behaviour by `vm.etch`-ing mocks at those addresses before deploying the ledger (section 11).

### 2.4 Types

| Enum | Values |
|---|---|
| `CircleStatus` | `Active` (0), `Completed` (1) |
| `Rotation` | `Fixed` (0), `ByScore` (1). NatSpec: "Fixed: members[round], the classic ROSCA order. ByScore: the member with the highest Kitty Score who has not received a pot yet (ties: earlier member). Missing or paying late this round lowers your score *before* the pick, so proven behaviour decides the order inside the circle too." |
| `RoundStatus` | `Open` (0), `Closed` (1), `Paid` (2) |

Structs `Circle`, `Round`, `Contribution`, `MemberRecord` (lines 62-105) are documented field by field in [`PROTOCOL.md` section 3](../specs/PROTOCOL.md#3-data-model) and slot by slot in [`STORAGE_LAYOUT.md`](STORAGE_LAYOUT.md). Two fields deserve a note here because they carry evidence: `Round.attestedCloseHeight` and `Round.attestedCloseHash` are "the attestation that proved the deadline when the round closed on the deadline path (`find_lowest_attested_after(chainKey, closeHeight)`); zero when everyone paid and the round closed early. This is the evidence behind every `ContributionMissed` of the round" (lines 84-88). `MemberRecord` is "proof-backed credit history. Only ever written from verified transactions or from attested deadlines, never from an operator input" (lines 97-98).

### 2.5 Constants

| Constant | Value | Why |
|---|---|---|
| `CONTRIBUTED_SIG` | `keccak256("Contributed(uint256,uint32,address,uint256)")` | Topic 0 of the vault's contribution event; `_singleLog` filters receipt logs by it. Equality with `KittyVault.Contributed` is asserted by `test_eventSignaturesMatchLedgerConstants`. |
| `PAIDOUT_SIG` | `keccak256("PaidOut(uint256,uint32,address,uint256)")` | Topic 0 of the vault's payout event. |
| `MAX_BATCH` | 10 | "Attestcoin allows up to 10 queries to share one continuity proof." `_prepareBatch` rejects larger batches. |
| `MAX_MEMBERS` | 10 | Upper bound on `members.length` and `maxMembers`. A circle of `n` members has `n` rounds, so this also bounds the number of rounds. |
| `GRACE_BLOCKS` | 64 | "Source-chain blocks after the deadline during which a payment mined on time can still be proven before the round may close. Covers attestation lag (~36 blocks on testnet) plus proving." Rationale in [ADR 0001](../adr/0001-attestation-as-the-only-clock.md). |

### 2.6 Storage variables

"Who writes" names the functions that assign the variable. Read paths are omitted.

| Variable | Type | Meaning | Who writes |
|---|---|---|---|
| `_owner` (inherited) | `address` | `Ownable` owner. | `Ownable` constructor, `transferOwnership`, `renounceOwnership` |
| `circleCount` | `uint256` public | Number of circles ever created; ids are `1..circleCount`. | `_initCircle` (`++circleCount`) |
| `_circles` | `mapping(uint256 => Circle)` internal | Circle by id. | `_initCircle` (all scalar fields), `_join` (`members.push`), `_createOpenCircle` (`open = true`), `closeInvites` (`open`, `maxMembers`), `setRotation` (`rotation`), `closeRound` (`currentRound`, `status`) |
| `_rounds` | `mapping(uint256 => mapping(uint32 => Round))` internal | Round `r` of circle `c`. | `_recordContribution` (`contributions`, `pot`), `closeRound` (`status`, `recipient`, `attestedCloseHeight`, `attestedCloseHash`, next round's `pot` on carry-over, this round's `pot` zeroed), `_confirmPayout` (`status = Paid`, `payoutQueryId`) |
| `_contributions` | `mapping(uint256 => mapping(uint32 => mapping(address => Contribution)))` internal | One proven payment per (circle, round, member). `queryId != 0` is the existence test. | `_recordContribution` only |
| `isMember` | `mapping(uint256 => mapping(address => bool))` public | Listed or joined. | `_join` only |
| `_records` | `mapping(address => MemberRecord)` internal | Cross-circle credit history. | `_recordContribution` (`onTime` or `late`, `volume`), `closeRound` (`missed`, `received`) |
| `receivedPot` | `mapping(uint256 => mapping(address => bool))` public | "Has this member already received a pot in this circle (each member receives exactly once)." | `closeRound` only |
| `_memberCircles` | `mapping(address => uint256[])` internal | Circles a member has consented to, in consent order. | `_accept` only |
| `trustedVault` | `mapping(uint64 => mapping(address => bool))` public | "Source-chain vaults whose events may feed this ledger (owner-curated: the deployed KittyVault), keyed by *source chain*. Without this, anyone could bind a circle to a contract that merely *emits* Contributed and mint 'proven volume' out of thin air. Keying it by chain closes the same-address-on-another-chain hole." | `setTrustedVault` only (owner) |
| `trustedVaultChains` | `mapping(address => uint64)` public | "How many chains a vault is trusted on. Diagnostics only (see `_rejectEmitter`): it lets a proof submitted under the wrong chain key report `WrongChain` instead of `WrongEmitter`." | `setTrustedVault` only |
| `accepted` | `mapping(uint256 => mapping(address => bool))` public | "A member is only ever penalised for a circle they consented to: they redeemed an invite, organised it, called acceptMembership, or paid into it at least once." | `_accept` only |
| `usedInviteNonces` | `mapping(uint256 => mapping(uint256 => bool))` public | "Invite replay protection: each (circle, nonce) signed by the organiser is redeemable once." | `redeemInvite` only |
| `processedQueries` | `mapping(bytes32 => bool)` public | "Replay protection: one proof, one effect. Same derivation as ASCBase." Shared by all three proving entry points. | `recordContributions`, `confirmPayout`, `confirmPayouts` |

### 2.7 Circle creation

#### `createCircle(string name, address[] members, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault) returns (uint256 circleId)` (line 261)

NatSpec: "Open a circle on the ledger's default source chain (`SOURCE_CHAIN_KEY`)." Delegates to `_createCircle(..., SOURCE_CHAIN_KEY)`.

#### `createCircle(..., address sourceVault, uint64 chainKey) returns (uint256 circleId)` (line 277)

NatSpec: "Open a circle. Permissionless: whoever organises the group creates it. Money never touches this contract; the vault on the source chain holds escrow. `chainKey`: source chain this circle settles from. Must exist in the ChainInfo registry (`get_chain_by_key(chainKey).exists`) and `sourceVault` must be trusted *for that chain*, so one ledger serves Sepolia and Ethereum mainnet circles side by side."

Access: anyone; `msg.sender` becomes `organiser`.

Preconditions and reverts, in order (`_createCircle`, line 316, then `_initCircle`, section 2.12):

| # | Condition | Revert |
|---|---|---|
| 1 | `members.length < 2 || members.length > MAX_MEMBERS` | `InvalidCircle("2..10 members")` |
| 2 | `contribution == 0` | `InvalidCircle("contribution")` |
| 3 | `roundBlocks == 0` | `InvalidCircle("roundBlocks")` |
| 4 | `!CHAIN_INFO.get_chain_by_key(chainKey).exists` | `UnsupportedSourceChain(chainKey)` |
| 5 | `sourceVault == 0 || !trustedVault[chainKey][sourceVault]` | `VaultNotTrusted(sourceVault)` |
| 6 | `startHeight > type(uint64).max / 4 || roundBlocks > 2**40` | `InvalidCircle("height range")` |
| 7 | latest attestation exists and `startHeight + roundBlocks <= latest.height` | `InvalidCircle("round 0 already attested")` |
| 8 | any member is `address(0)` or repeats an earlier member | `InvalidCircle("duplicate/zero member")` |

Effects: `circleId = ++circleCount`; the `Circle` fields are stored with `organiser = msg.sender`, `maxMembers = uint32(members.length)`, `open = false`, `rotation = Fixed`, `status = Active`, `currentRound = 0`; each member gets `isMember = true` and is pushed to `members` *without consent* (`_join(..., false)`).

Events: `CircleCreated(circleId, name, members, contribution, roundBlocks, startHeight, sourceVault)`, `CircleChainSet(circleId, chainKey)`, `RoundOpened(circleId, 0, deadlineHeight(circleId, 0))`.

Gas ([`GAS.md`](../GAS.md)): 331,549 with 3 members, 654,735 with 10.

#### `createOpenCircle(string name, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault, uint32 maxMembers) returns (uint256)` (line 290) and the 7-argument overload with `uint64 chainKey` (line 304)

NatSpec: "Open a circle with only the organiser as member. Others join via `redeemInvite` using an off-chain signature from the organiser; the organiser then calls `closeInvites` before the first contribution can be recorded (rotation order = join order)."

Preconditions: `maxMembers < 2 || maxMembers > MAX_MEMBERS` reverts `InvalidCircle("2..10 members")`; then the `_initCircle` checks 2 to 7 above.

Effects: as `createCircle` with `maxMembers` as given, then `open = true` and `msg.sender` joins *with consent* (`_join(..., true)`, which calls `_accept`).

Events: `MembershipAccepted(circleId, msg.sender)` (from `_accept`), `CircleCreated` with a one-element `members` array, `CircleChainSet`, `RoundOpened`.

Gas: 289,528.

#### `redeemInvite(uint256 circleId, uint256 nonce, bytes sig)` (line 362)

NatSpec: "Join an open circle with an invite signed by its organiser (EIP-191 over `keccak256(abi.encodePacked(ledger, chainid, circleId, invitee, nonce))`). Pattern after Breadchain SavingCircles.redeemInvite (MIT), bound here to the invitee's address."

Access: the invitee; `msg.sender` is part of the signed digest.

Preconditions, in order:

| # | Condition | Revert |
|---|---|---|
| 1 | circle does not exist (`sourceVault == 0`) | `UnknownCircle(circleId)` |
| 2 | `!c.open` | `CircleNotOpen(circleId)` |
| 3 | `usedInviteNonces[circleId][nonce]` | `InviteAlreadyUsed(circleId, nonce)` |
| 4 | `isMember[circleId][msg.sender]` | `AlreadyMember(circleId, msg.sender)` |
| 5 | `c.members.length >= c.maxMembers` | `CircleFull(circleId, c.maxMembers)` |
| 6 | `c.currentRound != 0 || _rounds[circleId][0].contributions != 0` | `CircleStillOpen(circleId)` (defence in depth: an open circle cannot record, so this is unreachable through `_recordContribution`) |
| 7 | `ECDSA.recover(inviteDigest(circleId, msg.sender, nonce), sig) != c.organiser` | `InvalidInviteSigner(signer, c.organiser)`; a malformed signature reverts earlier inside `ECDSA` with `ECDSAInvalidSignature()`, `ECDSAInvalidSignatureLength(length)` or `ECDSAInvalidSignatureS(s)` |

Effects: `usedInviteNonces[circleId][nonce] = true`; `_join(circleId, c, msg.sender, true)` (membership plus consent).

Events: `MembershipAccepted`, `InviteRedeemed(circleId, msg.sender, nonce)`.

Gas: 148,117.

#### `closeInvites(uint256 circleId)` (line 412)

NatSpec (written at lines 378-379, physically attached to `setRotation` but describing this function): "Stop accepting invites. Required before contributions can be recorded so the member list, and therefore the rotation order and per-round pot, is fixed."

Access: organiser. Reverts: `UnknownCircle`; `NotOrganiser(circleId)` if `msg.sender != c.organiser`; `InvitesAlreadyClosed(circleId)` if `!c.open`; `InvalidCircle("2..10 members")` if `c.members.length < 2`.

Effects: `c.open = false`; `c.maxMembers = uint32(c.members.length)`. Event: `InvitesClosed(circleId, members.length)`. Gas: 19,505.

#### `acceptMembership(uint256 circleId)` (line 407)

NatSpec: "A member listed by createCircle opts in. Until then the circle cannot hurt their score."

Access: any listed member; reverts `NotAMember(circleId, msg.sender)` otherwise. Effect: `_accept(circleId, msg.sender)` (idempotent). Event: `MembershipAccepted` on the first call only. Gas: 61,299.

#### `setRotation(uint256 circleId, Rotation mode)` (line 382)

NatSpec: "Choose Fixed or ByScore rotation. Organiser only, and only before round 0 holds any proof (so the rule is known to everyone before the first payment)."

Reverts: `UnknownCircle`; `NotOrganiser(circleId)`; `RotationLocked(circleId)` if `c.currentRound != 0 || _rounds[circleId][0].contributions != 0 || _rounds[circleId][0].status != Open`. Effect: `c.rotation = mode`. Event: `RotationSet(circleId, mode)`. Gas: 21,822.

#### `inviteDigest(uint256 circleId, address invitee, uint256 nonce) view returns (bytes32)` (line 423)

NatSpec: "The EIP-191 digest an organiser signs to invite `invitee` into `circleId`." Returns `MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(address(this), block.chainid, circleId, invitee, nonce)))`. The ledger address and the Creditcoin chain id are in the preimage, so a signature is useless on another ledger or another chain.

### 2.8 Vault allowlist

#### `setTrustedVault(uint64 chainKey, address vault, bool trusted)` (line 392, `public onlyOwner`)

NatSpec: "Curate which source-chain vaults may feed the ledger, per source chain. Trust is never global: the same address on another supported chain is a different contract."

Reverts: `OwnableUnauthorizedAccount(msg.sender)` for a non-owner. Effects: only when `trustedVault[chainKey][vault] != trusted`, the flag is set and `trustedVaultChains[vault]` is incremented (`trusted`) or decremented (`!trusted`). Event: `VaultTrusted(chainKey, vault, trusted)`, emitted on every call including no-ops.

#### `setTrustedVault(address vault, bool trusted)` (line 402, `external`)

NatSpec: "Convenience for the ledger's default source chain." Calls the 3-argument form with `SOURCE_CHAIN_KEY`; the owner check runs there (`test_singleArgSetTrustedVaultTargetsTheDefaultChain`).

### 2.9 Round close

#### `closeRound(uint256 circleId)` (line 431)

NatSpec: "Close the current round. Allowed when every member has a proven contribution, or when the deadline block on the source chain has been attested on Creditcoin."

Access: anyone.

Preconditions, in order:

| # | Condition | Revert |
|---|---|---|
| 1 | circle does not exist | `UnknownCircle(circleId)` |
| 2 | `c.status != Active` | `CircleNotActive(circleId)` |
| 3 | `c.open` | `CircleStillOpen(circleId)` |
| 4 | `_rounds[circleId][currentRound].status != Open` | `RoundNotOpen(circleId, r)` |
| 5 | `rd.contributions < members.length` and `!CHAIN_INFO.is_height_attested(c.chainKey, deadline + GRACE_BLOCKS)` | `RoundStillOpenOnSource(deadline + GRACE_BLOCKS)` |

Effects, in order (`r = c.currentRound`, `n = members.length`, `deadline = deadlineHeight(circleId, r)`):

1. Deadline path only (`contributions < n`): `a = CHAIN_INFO.find_lowest_attested_after(c.chainKey, deadline + GRACE_BLOCKS)`; `rd.attestedCloseHeight = a.height`; `rd.attestedCloseHash = a.hash`.
2. For each member `m` in list order with `_contributions[circleId][r][m].queryId == 0 && accepted[circleId][m]`: `_records[m].missed += 1`, `missed++`, emit `ContributionMissed(circleId, r, m, deadline, rd.attestedCloseHeight, rd.attestedCloseHash)`. On an early close every member has paid, so this loop marks nobody.
3. `recipient = _pickRecipient(circleId, c, r, false)`. If `recipient == 0 && r + 1 == n` (final round): `recipient = _pickRecipient(circleId, c, r, true)`, `usedFallback = recipient != 0`.
4. `rd.status = Closed`; `rd.recipient = recipient`.
5. If `recipient != 0`: `receivedPot[circleId][recipient] = true`; `_records[recipient].received += 1`; if `usedFallback` emit `FallbackRecipient(circleId, r, recipient)`. Else if `r + 1 < n && rd.pot > 0`: `_rounds[circleId][r + 1].pot += rd.pot`; emit `PotCarriedOver(circleId, r, rd.pot)`; `rd.pot = 0`.
6. Emit `RoundClosed(circleId, r, recipient, rd.pot, missed, rd.attestedCloseHeight)` (`pot` is the post-carry-over value, so 0 after a carry).
7. If `r + 1 == n`: `c.status = Completed`, emit `CircleCompleted(circleId)`. Else `c.currentRound = r + 1`, emit `RoundOpened(circleId, r + 1, deadlineHeight(circleId, r + 1))`.

A final round in which nobody paid closes with `recipient == 0` and keeps its pot on the round (there is no next round to carry to); see [`THREAT_MODEL.md` limit 5](../THREAT_MODEL.md#6-known-limits).

Gas: 99,350 (early, 3 paid, Fixed); 113,148 (early, 3 paid, ByScore); 173,545 (deadline, 1 paid, 2 missed); 282,976 (deadline, 1 paid, 9 missed); 97,920 (final round to `Completed`).

### 2.10 Attestcoin entry points

#### `recordContributions(uint64 chainKey, uint64[] heights, bytes[] encodedTxs, INativeQueryVerifier.MerkleProof[] merkleProofs, INativeQueryVerifier.ContinuityProof continuity)` (line 502)

NatSpec: "Record up to 10 proven `Contributed` transactions with ONE precompile call. `chainKey`: source chain key on Creditcoin (Sepolia = 1 on CC3 Testnet). `heights`: source block height of each transaction. `encodedTxs`: prover `txBytes` (EvmV1 encoding) for each transaction. `merkleProofs`: per-transaction inclusion proof against its block's Kitty-merkle root. `continuity`: continuity proof shared by all heights in the batch."

Access: anyone.

Algorithm:

1. `queryIds = _prepareBatch(chainKey, heights, encodedTxs, merkleProofs)` (section 2.12): shape checks and replay checks, all before the precompile is paid.
2. `ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity)` (batch overload). A precompile revert propagates unchanged; `ok == false` reverts `ProofRejected()`.
3. For `i` in `0..n-1`: `processedQueries[queryIds[i]] = true`; `_recordContribution(chainKey, queryIds[i], heights[i], encodedTxs[i])` (section 2.12); track `lo = min(heights)`, `hi = max(heights)`.
4. Emit `BatchVerified(chainKey, lo, hi, n)`.

Atomicity: any revert in step 3 rolls back every element and the `processedQueries` writes.

Reverts: those of `_prepareBatch`, `ProofRejected`, and the nineteen checks of `_recordContribution` (listed in [`TECH.md`](../TECH.md#step-2-per-transaction-in-batch-order)). Events: one `ContributionRecorded` per element (plus `MembershipAccepted` for a member paying into a circle for the first time), then `BatchVerified`.

Gas: 309,174 (batch 1, member's first record); 257,874 (batch 1, member with history); 788,930 (batch 3, fresh); 2,496,380 (batch 10, fresh); 1,983,380 (batch 10, history). These are contract-side figures with the verifier mocked; see [`GAS.md`](../GAS.md) for the live precompile cost.

#### `confirmPayout(uint64 chainKey, uint64 height, bytes encodedTx, INativeQueryVerifier.MerkleProof merkleProof, INativeQueryVerifier.ContinuityProof continuity)` (line 528)

NatSpec: "Prove that the vault actually paid the round's recipient on the source chain. Thin wrapper over the shared payout validation, using the single-query prover overload."

Algorithm: `qid = _computeQueryId(chainKey, height, merkleProof)`; revert `QueryAlreadyProcessed(qid)` if processed; `VERIFIER.verifyAndEmit` (single overload) must return true else `ProofRejected()`; `processedQueries[qid] = true`; `_confirmPayout(chainKey, qid, encodedTx)`. Event: `PayoutConfirmed`. Gas: 105,391.

#### `confirmPayouts(uint64 chainKey, uint64[] heights, bytes[] encodedTxs, MerkleProof[] merkleProofs, ContinuityProof continuity)` (line 547)

NatSpec: "Confirm up to 10 payouts with ONE precompile call: payouts from *different circles* closing in the same window share the continuity proof the way contributions do."

Same structure as `recordContributions` with `_confirmPayout` in the loop and a closing `BatchVerified`. Gas: 249,146 for a batch of 3.

### 2.11 Views

| Function (line) | Returns | Notes |
|---|---|---|
| `getCircle(uint256)` (573) | `Circle` | Reverts `UnknownCircle` for a missing id (via `_circle`). |
| `getRound(uint256, uint32)` (577) | `Round` | Zeroed struct for a round that does not exist; no existence check. |
| `getContribution(uint256, uint32, address)` (581) | `Contribution` | Zeroed struct if none. |
| `getRecord(address)` (585) | `MemberRecord` | Zeroed for an unknown address. |
| `getMemberCircles(address)` (590) | `uint256[]` | NatSpec: "Every circle `member` belongs to, in join order." Precisely: circles the member has *consented* to, in `_accept` order. |
| `deadlineHeight(uint256, uint32)` (595) | `uint64` | NatSpec: "Source-chain block by which round `round` must be paid." `startHeight + (round + 1) * roundBlocks`; no existence check, so a missing circle yields 0. |
| `closeHeight(uint256, uint32)` (603) | `uint64` | NatSpec: "Source-chain block that must be attested before a round with missing payments can close." `deadlineHeight + GRACE_BLOCKS`. |
| `creditScore(address)` (607) | `(uint16 score, string tier)` | NatSpec (written at lines 600-601, above `closeHeight`): "Kitty Score: a 300-850 style score derived purely from proven behaviour. Base 500, +15 per on-time installment, -20 per late, -120 per missed." Computed in `int256`, clamped to `[300, 850]`; tier `"A"` if `>= 700`, `"B"` if `>= 600`, `"C"` if `>= 500`, else `"D"`. |
| `inviteDigest(uint256, address, uint256)` (423) | `bytes32` | Section 2.7. |
| public getters | `circleCount`, `isMember`, `receivedPot`, `trustedVault`, `trustedVaultChains`, `accepted`, `usedInviteNonces`, `processedQueries`, `CONTRIBUTED_SIG`, `PAIDOUT_SIG`, `MAX_BATCH`, `MAX_MEMBERS`, `GRACE_BLOCKS`, `VERIFIER`, `CHAIN_INFO`, `SOURCE_CHAIN_KEY`, `owner()` | |

### 2.12 Internal helpers

#### `_initCircle(name, contribution, roundBlocks, startHeight, sourceVault, maxMembers, chainKey) returns (uint256 circleId)` (line 778)

Shared by both creation paths.

1. `contribution == 0` reverts `InvalidCircle("contribution")`.
2. `roundBlocks == 0` reverts `InvalidCircle("roundBlocks")`.
3. `!CHAIN_INFO.get_chain_by_key(chainKey).exists` reverts `UnsupportedSourceChain(chainKey)`. Comment: "The registry, not a constant, decides which chains exist: ask the precompile."
4. `sourceVault == 0 || !trustedVault[chainKey][sourceVault]` reverts `VaultNotTrusted(sourceVault)`.
5. `startHeight > type(uint64).max / 4 || roundBlocks > (1 << 40)` reverts `InvalidCircle("height range")`. With `round <= 9` these bounds keep `closeHeight` inside `uint64` (`test_deadlineHeight_worstCaseFits`).
6. `latest = CHAIN_INFO.get_latest_attestation_height_and_hash(chainKey)`; if `latest.exists && startHeight + roundBlocks <= latest.height` revert `InvalidCircle("round 0 already attested")`. Comment: "Round 0's deadline must lie beyond the attested frontier. Otherwise an organiser could open a circle whose first round is already over, collect consent via invites, and have every invitee marked `missed` for a round that never existed for them."
7. `circleId = ++circleCount`; store `chainKey`, `name`, `contribution`, `roundBlocks`, `startHeight`, `sourceVault`, `organiser = msg.sender`, `maxMembers`.

#### `_join(circleId, Circle storage c, address m, bool consent)` (line 810)

`isMember[circleId][m] = true`; `c.members.push(m)`; if `consent`, `_accept(circleId, m)`.

#### `_accept(circleId, address m)` (line 816)

If `accepted[circleId][m]` return (idempotent). Else set it, `_memberCircles[m].push(circleId)`, emit `MembershipAccepted(circleId, m)`. Reached from `_createOpenCircle` (organiser), `redeemInvite`, `acceptMembership` and `_recordContribution`.

#### `_circle(uint256 circleId) returns (Circle storage)` (line 855)

Existence test: reverts `UnknownCircle(circleId)` if `_circles[circleId].sourceVault == address(0)`. Every existing circle has a non-zero vault because `_initCircle` step 4 requires one.

#### `_prepareBatch(chainKey, heights, encodedTxs, merkleProofs) view returns (bytes32[] queryIds)` (line 623)

NatSpec: "Shared batch prologue: shape checks plus query-id derivation with replay *and* in-batch duplicate rejection, before a single wei of gas goes to the prover."

1. `n = heights.length`; `n == 0` reverts `EmptyBatch()`; `n > MAX_BATCH` reverts `BatchTooLarge(n)`; `encodedTxs.length != n || merkleProofs.length != n` reverts `LengthMismatch()`.
2. For each `i`: `qid = _computeQueryId(chainKey, heights[i], merkleProofs[i])`; `processedQueries[qid]` reverts `QueryAlreadyProcessed(qid)`; any earlier `queryIds[j] == qid` (`j < i`) reverts `QueryAlreadyProcessed(qid)`; store `queryIds[i] = qid`.

The in-batch comparison is quadratic in `n`, bounded by `MAX_BATCH = 10` (at most 45 comparisons).

#### `_computeQueryId(chainKey, blockHeight, MerkleProof calldata merkleProof) view returns (bytes32)` (line 763)

NatSpec: "Identical derivation to ASCBase: keccak(chainKey || height || txIndex)."

`txIndex = VERIFIER.calculateTxIndex(merkleProof)` (an external view call to the precompile), then in assembly a 72-byte preimage at the free memory pointer: bytes 0-31 `uint256(chainKey)`, bytes 32-39 `uint64(blockHeight)` (`shl(192, blockHeight)` places it in the high 8 bytes of the word written at offset 32), bytes 40-71 `uint256(txIndex)`; `queryId = keccak256(ptr, 72)`. The same bytes are produced by `abi.encodePacked(uint256(chainKey), uint64(height), uint256(txIndex))`, which is what the invariant handler uses to predict ids (`KittyLedgerHandler._queryId`). `ASCBase._computeQueryId` in `@gluwa/asc-contracts@0.2.1` (`contracts/readability/ASCBase.sol:94-112`) writes the same three words.

#### `_singleLog(chainKey, bytes calldata encodedTx, bytes32 sig) view returns (LogEntry chosen)` (line 709)

NatSpec: "Decode receipt, require success, then require exactly one log with `sig` emitted by a *trusted vault*. Same-shaped events from other contracts in the same tx are ignored, so a token or router that happens to emit `Contributed` cannot block a genuine payment; a tx whose only matching logs come from untrusted emitters is rejected as WrongEmitter."

1. `txType = EvmV1Decoder.getTransactionType(encodedTx)` (byte 31 of the first word); `!isValidTransactionType(txType)` (type `> 4`) reverts `UnsupportedTxType(txType)`.
2. `receipt = EvmV1Decoder.decodeReceiptFields(encodedTx)`; `receipt.receiptStatus != 1` reverts `SourceTxFailed()`. Comment: "The precompile proves inclusion, not success: a reverted tx is still 'included'."
3. `logs = getLogsByEventSignature(receipt, sig)`; `logs.length == 0` reverts `ExpectedExactlyOneLog(0)`.
4. Count `found` = logs whose `address_` is in `trustedVault[chainKey]`, remembering the last such log as `chosen`.
5. `found == 0`: `_rejectEmitter(chainKey, logs)` (always reverts).
6. `found != 1`: revert `ExpectedExactlyOneLog(found)`.

Malformed prover bytes revert inside `EvmV1Decoder` with its own `require` strings (`"EvmV1Decoder: Empty"`, `"EvmV1Decoder: Invalid tx type"`, `"EvmV1Decoder: Wrong chunk count"`, `"EvmV1Decoder: bad chunks (t0-2)"` / `"(t3-4)"`) or with an ABI decoding failure.

#### `_rejectEmitter(chainKey, LogEntry[] memory logs) view` (line 737)

NatSpec: "Nothing in this transaction came from a vault trusted on `chainKey`. Always reverts; the only question is *which* error is truthful. A proof submitted under the wrong chain key for a circle whose own vault emitted the log is a chain mismatch (`WrongChain`), not a spoof: report it as such so the caller can retry with the circle's chain. Anything else is `WrongEmitter`. Diagnostics only: no path here can accept a log."

For each log: skip if `trustedVaultChains[emitter] == 0` or `topics.length != 4`; read `c = _circles[uint256(topics[1])]`; if `c.sourceVault == emitter && c.chainKey != chainKey` revert `WrongChain(chainKey, c.chainKey)`. After the loop revert `WrongEmitter(logs[0].address_, address(0))`. The `want` argument is `address(0)` because no circle has been resolved at this point.

#### `_decodeVaultLog(LogEntry memory log) pure returns (circleId, round, who, amount)` (line 748)

NatSpec: "Both vault events share the shape (uint256 indexed, uint32 indexed, address indexed, uint256 data)." Reverts `BadLogShape()` if `topics.length != 4 || data.length != 32`, or if `uint256(topics[2]) > type(uint32).max`. Otherwise `circleId = uint256(topics[1])`, `round = uint32(topics[2])`, `who = address(uint160(uint256(topics[3])))`, `amount = abi.decode(data, (uint256))`.

#### `_recordContribution(chainKey, bytes32 qid, uint64 height, bytes calldata encodedTx)` (line 663)

1. `log = _singleLog(chainKey, encodedTx, CONTRIBUTED_SIG)`; `(circleId, round, member, amount) = _decodeVaultLog(log)`.
2. `c = _circle(circleId)` (reverts `UnknownCircle`).
3. `chainKey != c.chainKey` reverts `WrongChain(chainKey, c.chainKey)`. Comment: "Every circle in a batch must settle from the batch's chain: a Sepolia proof can never credit a circle that settles from Ethereum mainnet, even with an identical vault address."
4. `c.status != Active` reverts `CircleNotActive(circleId)`.
5. `c.open` reverts `CircleStillOpen(circleId)`.
6. `log.address_ != c.sourceVault` reverts `WrongEmitter(log.address_, c.sourceVault)`.
7. `tx_ = EvmV1Decoder.decodeCommonTxFields(encodedTx)`; `tx_.toIsNull || tx_.to != c.sourceVault` reverts `TxNotToVault(tx_.to, c.sourceVault)`; `tx_.from != member` reverts `SenderMismatch(tx_.from, member)`. Comment: "Defense in depth: the proven transaction itself must be a call *to* the vault *from* the member."
8. `!isMember[circleId][member]` reverts `NotAMember(circleId, member)`.
9. `amount != c.contribution` reverts `WrongAmount(amount, c.contribution)`.
10. `round != c.currentRound` reverts `NotCurrentRound(round, c.currentRound)`.
11. `height < c.startHeight` reverts `BeforeCircleStart(height, c.startHeight)`. Comment: "A payment cannot predate the circle: without this, a payment tagged (circleId, round) made before the circle existed (or counted by an earlier ledger instance that shares the vault) would be credited here." See [ADR 0005](../adr/0005-one-vault-per-ledger.md).
12. `_rounds[circleId][round].status != Open` reverts `RoundNotOpen(circleId, round)`.
13. `_contributions[circleId][round][member].queryId != 0` reverts `AlreadyContributed(circleId, round, member)`.
14. Effects: `_accept(circleId, member)` ("paying into a circle is consent"); `onTime = height <= deadlineHeight(circleId, round)`; store `Contribution{height, queryId: qid, onTime}`; `rd.contributions += 1`; `rd.pot += amount`; `rec.onTime += 1` or `rec.late += 1`; `rec.volume += amount`; emit `ContributionRecorded(circleId, round, member, amount, height, onTime, qid)`.

Together with `_singleLog` these are the nineteen checks tabulated in [`TECH.md`](../TECH.md#step-2-per-transaction-in-batch-order).

#### `_confirmPayout(chainKey, bytes32 qid, bytes calldata encodedTx)` (line 646)

NatSpec: "Validate one proven `PaidOut` transaction and settle the round it belongs to."

1. `log = _singleLog(chainKey, encodedTx, PAIDOUT_SIG)`; decode `(circleId, round, recipient, amount)`.
2. `c = _circle(circleId)`; `chainKey != c.chainKey` reverts `WrongChain`; `log.address_ != c.sourceVault` reverts `WrongEmitter(log.address_, c.sourceVault)`.
3. `rd.status != Closed` reverts `RoundNotClosed(circleId, round)`; `rd.recipient == 0` reverts `NoRecipient(circleId, round)`; `recipient != rd.recipient || amount != rd.pot` reverts `PayoutMismatch()`.
4. `rd.status = Paid`; `rd.payoutQueryId = qid`; emit `PayoutConfirmed(circleId, round, recipient, amount, qid)`.

Unlike `_recordContribution`, the transaction's own `to` and `from` are not checked here (noted in [`AUDIT_CHECKLIST.md` 2.7](../AUDIT_CHECKLIST.md)); the emitter binding and the operator-only `payout` on the vault are the guards.

#### `_pickRecipient(circleId, Circle storage c, uint32 r, bool ignoreReceived) view returns (address best)` (line 826)

NatSpec: "Fixed: members[r]. ByScore: best current score among members who have not received a pot. Always requires a proven payment this round; `ignoreReceived` lifts only the has-not-received filter (used for the final-round fallback)."

Fixed: for `k` in `0..n-1`, `m = members[(r + k) % n]`; return the first `m` with `(ignoreReceived || !receivedPot[circleId][m]) && _contributions[circleId][r][m].queryId != 0`; else `address(0)`.

ByScore: for `i` in `0..n-1`, `m = members[i]`; skip if `!ignoreReceived && receivedPot[circleId][m]`; skip if no contribution this round; `(sc,) = creditScore(m)`; take `m` if `best == 0 || sc > bestScore` (strict, so ties go to the lowest index). Returns `address(0)` if nobody qualifies. Scores are read *after* `closeRound` has recorded this round's misses, so a miss lowers a member's standing before the pick.

### 2.13 Events

| Event | Emitted by | When |
|---|---|---|
| `CircleCreated(uint256 indexed circleId, string name, address[] members, uint256 contribution, uint64 roundBlocks, uint64 startHeight, address sourceVault)` | `_createCircle`, `_createOpenCircle` | Creation. Open circles list only the organiser. |
| `CircleChainSet(uint256 indexed circleId, uint64 indexed chainKey)` | creation | NatSpec: "The source chain a circle settles from, emitted alongside CircleCreated." |
| `RoundOpened(uint256 indexed circleId, uint32 indexed round, uint64 deadlineHeight)` | creation (round 0), `closeRound` (round `r + 1`) | A round is open. |
| `MembershipAccepted(uint256 indexed circleId, address indexed member)` | `_accept` | First consent by a member to a circle. |
| `InviteRedeemed(uint256 indexed circleId, address indexed member, uint256 nonce)` | `redeemInvite` | After the join. |
| `InvitesClosed(uint256 indexed circleId, uint256 memberCount)` | `closeInvites` | Membership fixed. |
| `RotationSet(uint256 indexed circleId, Rotation rotation)` | `setRotation` | |
| `VaultTrusted(uint64 indexed chainKey, address indexed vault, bool trusted)` | `setTrustedVault` | Every call, including no-ops. |
| `BatchVerified(uint64 indexed chainKey, uint64 fromHeight, uint64 toHeight, uint256 count)` | `recordContributions`, `confirmPayouts` | After the loop; `fromHeight`/`toHeight` are the min and max heights in the batch. |
| `ContributionRecorded(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount, uint64 sourceHeight, bool onTime, bytes32 queryId)` | `_recordContribution` | Per proven payment. |
| `ContributionMissed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint64 deadlineHeight, uint64 attestedHeight, bytes32 attestedHash)` | `closeRound` | Per consented non-payer on the deadline path. NatSpec: "`attestedHeight`/`attestedHash` identify the attestation (the first at or after the round's close height) that proved the deadline had passed on the source chain." |
| `RoundClosed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 pot, uint32 missedCount, uint64 attestedHeight)` | `closeRound` | NatSpec: "`attestedHeight` is zero when the round closed early because everyone paid." |
| `PotCarriedOver(uint256 indexed circleId, uint32 indexed fromRound, uint256 amount)` | `closeRound` | Non-final round, no eligible recipient, non-zero pot. |
| `FallbackRecipient(uint256 indexed circleId, uint32 indexed round, address indexed recipient)` | `closeRound` | NatSpec: "The final round had no member who both paid and had not yet received, so the pot went to a member who paid this round (ignoring prior receipt) instead of stranding in escrow." |
| `CircleCompleted(uint256 indexed circleId)` | `closeRound` | Final round closed. |
| `PayoutConfirmed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount, bytes32 queryId)` | `_confirmPayout` | Round is `Paid`. |
| `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)` | `Ownable` | Construction and ownership changes. |

### 2.14 Errors

| Error | Thrown by | Condition |
|---|---|---|
| `WrongChain(uint64 got, uint64 want)` | `_recordContribution`, `_confirmPayout`, `_rejectEmitter` | Batch chain key differs from the circle's `chainKey`. |
| `EmptyBatch()` | `_prepareBatch` | `heights.length == 0`. |
| `BatchTooLarge(uint256 n)` | `_prepareBatch` | `n > 10`. |
| `LengthMismatch()` | `_prepareBatch` | `encodedTxs` or `merkleProofs` length differs from `heights`. |
| `QueryAlreadyProcessed(bytes32 queryId)` | `_prepareBatch`, `confirmPayout` | Replay across calls or duplicate inside a batch. |
| `ProofRejected()` | `recordContributions`, `confirmPayout`, `confirmPayouts` | `verifyAndEmit` returned `false`. |
| `UnsupportedTxType(uint8 txType)` | `_singleLog` | EvmV1 type byte above 4. |
| `SourceTxFailed()` | `_singleLog` | Receipt status not 1. |
| `ExpectedExactlyOneLog(uint256 n)` | `_singleLog` | `n == 0`: no log with the signature; `n > 1`: more than one trusted-vault log. |
| `BadLogShape()` | `_decodeVaultLog` | Wrong topic count, data length, or round above `uint32`. |
| `UnknownCircle(uint256 circleId)` | `_circle` | `sourceVault == 0`. |
| `CircleNotActive(uint256 circleId)` | `closeRound`, `_recordContribution` | Circle `Completed`. |
| `WrongEmitter(address got, address want)` | `_recordContribution`, `_confirmPayout` (`want` = circle vault), `_rejectEmitter` (`want` = 0) | Log not from the circle's vault. |
| `TxNotToVault(address got, address want)` | `_recordContribution` | `to` null or not the vault. |
| `SenderMismatch(address txFrom, address logMember)` | `_recordContribution` | `from` is not the logged member. |
| `NotAMember(uint256 circleId, address member)` | `_recordContribution`, `acceptMembership` | Not listed. |
| `WrongAmount(uint256 got, uint256 want)` | `_recordContribution` | Amount differs from `contribution`. |
| `RoundNotOpen(uint256 circleId, uint32 round)` | `closeRound`, `_recordContribution` | Round already closed. |
| `NotCurrentRound(uint32 got, uint32 want)` | `_recordContribution` | Log tagged with another round. |
| `BeforeCircleStart(uint64 height, uint64 startHeight)` | `_recordContribution` | Proven height below `startHeight`. |
| `AlreadyContributed(uint256 circleId, uint32 round, address member)` | `_recordContribution` | Second payment by the same member in a round. |
| `RoundStillOpenOnSource(uint64 deadlineHeight)` | `closeRound` | Close height not attested. The argument is `deadline + GRACE_BLOCKS`. |
| `RoundNotClosed(uint256 circleId, uint32 round)` | `_confirmPayout` | Round `Open` or already `Paid`. |
| `PayoutMismatch()` | `_confirmPayout` | Recipient or amount differs from the round's. |
| `InvalidCircle(string reason)` | `_createCircle`, `_createOpenCircle`, `_initCircle`, `closeInvites` | Reasons: `"2..10 members"`, `"duplicate/zero member"`, `"contribution"`, `"roundBlocks"`, `"height range"`, `"round 0 already attested"`. |
| `RotationLocked(uint256 circleId)` | `setRotation` | Round 0 has a proof, is closed, or `currentRound != 0`. |
| `CircleStillOpen(uint256 circleId)` | `redeemInvite`, `closeRound`, `_recordContribution` | Invites still open (in `redeemInvite`: round 0 already has a proof or advanced). |
| `CircleNotOpen(uint256 circleId)` | `redeemInvite` | Not an open-invite circle, or invites closed. |
| `NotOrganiser(uint256 circleId)` | `setRotation`, `closeInvites` | Caller is not `organiser`. |
| `InviteAlreadyUsed(uint256 circleId, uint256 nonce)` | `redeemInvite` | Nonce consumed. |
| `InvalidInviteSigner(address got, address want)` | `redeemInvite` | Recovered signer is not the organiser. |
| `AlreadyMember(uint256 circleId, address member)` | `redeemInvite` | Invitee already listed. |
| `CircleFull(uint256 circleId, uint32 maxMembers)` | `redeemInvite` | `members.length >= maxMembers`. |
| `InvitesAlreadyClosed(uint256 circleId)` | `closeInvites` | `open` already false. |
| `VaultNotTrusted(address vault)` | `_initCircle` | Zero vault or not on the allowlist for `chainKey`. |
| `UnsupportedSourceChain(uint64 chainKey)` | `_initCircle` | Registry has no such chain. |
| `NoRecipient(uint256 circleId, uint32 round)` | `_confirmPayout` | Round closed with `recipient == 0`. |

Inherited: `OwnableUnauthorizedAccount(address)`, `OwnableInvalidOwner(address)`; `ECDSAInvalidSignature()`, `ECDSAInvalidSignatureLength(uint256)`, `ECDSAInvalidSignatureS(bytes32)`.

## 3. KittyVault

File `src/source/KittyVault.sol`. NatSpec: "KittyVault (source chain: Ethereum Sepolia). Deliberately minimal source-chain contract, following the Attestcoin design pattern: hold stablecoin escrow and emit unambiguous events. ALL circle logic (membership, deadlines, rotation, missed-payment records, credit history) lives on Creditcoin in KittyLedger, which consumes these events through the Attestcoin block-prover precompile. Events are intentionally specific (`Contributed` / `PaidOut`, never a bare ERC20 `Transfer`) so the Creditcoin side can bind on emitter + signature + fields."

Inheritance: `Ownable`, `ReentrancyGuard`; `using SafeERC20 for IERC20`.

Constructor `(IERC20 token, address operator_) Ownable(msg.sender)` (line 47): sets immutable `TOKEN`, `operator = operator_`, emits `OperatorChanged(operator_)`.

| Storage | Type | Meaning | Who writes |
|---|---|---|---|
| `_owner` | `address` | `Ownable`. | `Ownable` |
| `_status` | `uint256` | `ReentrancyGuard` (1 not entered, 2 entered). | `nonReentrant` |
| `operator` | `address` public | "Operator that executes payouts decided on Creditcoin (KittyLedger.RoundClosed)." | constructor, `setOperator` |
| `pot` | `mapping(uint256 => uint256)` public | "Escrowed balance per circle." Per circle, not per round. | `contribute` (+), `payout` (-) |
| `paidOut` | `mapping(uint256 => mapping(uint32 => bool))` public | "One payout per (circle, round). Guards the operator against double release." | `payout` |
| `contributor` | `mapping(uint256 => mapping(address => bool))` public | "Anyone who ever paid into a circle. Payouts may only go to an address that has paid into that circle, which bounds a misbehaving operator to the circle's own contributors." | `contribute` |

Functions:

| Function (line) | Access | Reverts | Effects and events | Gas |
|---|---|---|---|---|
| `setOperator(address operator_)` (53) | owner (`OwnableUnauthorizedAccount`) | | `operator = operator_`; `OperatorChanged`. | not measured |
| `contribute(uint256 circleId, uint32 round, uint256 amount)` (62), `nonReentrant` | anyone | `ZeroAmount()` if `amount == 0`; token errors from `safeTransferFrom` (`SafeERC20FailedOperation`, `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`); `ReentrancyGuardReentrantCall` | `TOKEN.safeTransferFrom(msg.sender, this, amount)`; `pot[circleId] += amount`; `contributor[circleId][msg.sender] = true`; `Contributed(circleId, round, msg.sender, amount)`. NatSpec: "No membership check here on purpose: the ledger on Creditcoin decides whether a proven contribution counts." | 75,066 first into a circle; 57,966 pot non-zero, new contributor; 38,066 repeat contributor |
| `payout(uint256 circleId, uint32 round, address recipient, uint256 amount)` (72), `nonReentrant` | `operator` | in order: `NotOperator()`, `AlreadyPaid()`, `ZeroAmount()`, `InsufficientPot()` (`pot[circleId] < amount`), `NotAContributor()` | `paidOut[circleId][round] = true`; `pot[circleId] -= amount`; `TOKEN.safeTransfer(recipient, amount)`; `PaidOut(circleId, round, recipient, amount)`. Effects precede the transfer. | 62,622 |

Events: `Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount)`, `PaidOut(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount)`, `OperatorChanged(address indexed operator)`. Errors: `NotOperator`, `ZeroAmount`, `AlreadyPaid`, `InsufficientPot`, `NotAContributor`.

## 4. TestUSD

File `src/source/TestUSD.sol`. NatSpec: "6-decimal stablecoin stand-in for the Sepolia demo. Anyone can mint (testnet only)." `ERC20("Kitty Test USD", "tUSD")`; the constructor mints `1_000_000 * 10**6` to the deployer; `decimals()` returns 6; `mint(address to, uint256 amount)` is open. No custom storage beyond `ERC20`.

## 5. FakeVault

File `src/source/FakeVault.sol`. NatSpec: "DEMO ONLY: a spoof emitter for the 'wrong emitter' attack scenario. Emits an event byte-for-byte compatible with KittyVault.Contributed (same signature, same indexed layout) from an address that is NOT the circle's registered vault. Even with a perfectly valid Attestcoin proof of this tx, KittyLedger rejects it with `WrongEmitter` (and `TxNotToVault`), demonstrating that proofs are bound to the emitter, not the shape. Holds no funds. Never deploy as part of the real flow."

One function, `emitContributed(uint256 circleId, uint32 round, address member, uint256 amount)`, which emits `Contributed(circleId, round, member, amount)`. No storage. `test_emitsExactContributedShape` asserts the event shape; the `spoofEmitter` scenario proves such a transaction and expects `WrongEmitter`. Runtime size 192 bytes. The real Proof Builder fixture in `test/fixtures/` is the proof of this contract's Sepolia deployment (section 11 and [`TESTING.md`](../TESTING.md)).

## 6. KittyViewer

File `src/asc/KittyViewer.sol`. NatSpec: "One-call read models for the Kitty dashboard. Read-only aggregation over KittyLedger so the web app and worker can hydrate a whole circle (or a member's dashboard) in a single eth_call instead of dozens. Shape ported from BreadchainCoop `SavingCirclesViewer` (MIT). Never writes to the ledger."

Constructor `(KittyLedger ledger)`: immutable `LEDGER`. Constants: `STATUS_PENDING = 0`, `STATUS_PROVEN = 1`, `STATUS_LATE = 2`, `STATUS_MISSED = 3`. No storage.

| Function | Returns | Algorithm |
|---|---|---|
| `getCircleFull(uint256 circleId) view returns (CircleFull)` | `circle`, `rounds[0..currentRound]`, `current[i]` (each member's current-round `Contribution`), `scores[i]`, `tiers[i]`, `records[i]`, `deadline` | `LEDGER.getCircle` (reverts `UnknownCircle`), then `getRound` for `0..cur`, then per member `getContribution(circleId, cur, m)`, `creditScore(m)`, `getRecord(m)`; `deadline = deadlineHeight(circleId, cur)`. Once a circle is `Completed`, `currentRound == n - 1`, so all rounds are returned. |
| `getMemberDashboard(address member) view returns (MemberDashboard)` | `circleIds` (consented circles), `names`, `currentRounds`, `myStatus[i]`, `score`, `tier`, `record` | `LEDGER.getMemberCircles(member)`, then per circle `getCircle`, `memberStatus(id, currentRound, member)`; finally `creditScore` and `getRecord`. A stranger gets empty arrays and score 500 / tier C. |
| `memberStatus(uint256 circleId, uint32 round, address member) view returns (uint8)` | one of the four `STATUS_*` values | NatSpec: "0 Pending (round open, nothing proven yet), 1 Proven on time, 2 Late, 3 Missed (round closed without a proven contribution)." If `getContribution(...).queryId != 0` return `onTime ? 1 : 2`; else `getRound(...).status == Open ? 0 : 3`. Note that `3` is returned for any non-consented listed member of a closed round too, even though the ledger records no miss for them. |

## 7. KittyCreditLine

File `src/asc/KittyCreditLine.sol`. NatSpec: "A demo lender that underwrites purely from proof-backed history. The Kitty Score is only worth something if a contract *uses* it. This pool lends kUSD on Creditcoin against nothing but the ledger's `MemberRecord`: every input to the credit decision is a proven Sepolia transaction or an attested deadline. No admin, no oracle, no KYC, and no history means no credit. Underwriting table (from `KittyLedger.creditScore` tiers): tier A (>=700) 100% of proven volume, tier B (>=600) 50%, tier C (>=500) 20%, tier D (<500) 0%, capped at `CAP` (5,000 kUSD). A member with zero proven installments gets 0. Deliberately minimal: a flat 5% fee is added to the debt at borrow time, no time accrual. Fees repaid by borrowers stay in the pool and raise every LP's entitlement; `deposits` and `totalDeposits` are share units, not kUSD. Not a production lender."

Inheritance: `ReentrancyGuard`; `using SafeERC20 for IERC20`. Constructor `(KittyLedger ledger, IERC20 asset)`: immutables `LEDGER`, `ASSET`.

Constants: `CAP = 5_000e6` ("hard ceiling per member, in asset units (6 decimals)"), `FEE_BPS = 500` ("flat fee added to every borrow, in basis points").

| Storage | Type | Meaning | Who writes |
|---|---|---|---|
| `_status` | `uint256` | `ReentrancyGuard`. | `nonReentrant` |
| `totalDeposits` | `uint256` public | Total share units outstanding. | `deposit` (+), `withdraw` (-) |
| `totalOutstanding` | `uint256` public | Principal plus fees owed by all borrowers. | `borrow` (+ amount + fee), `repay` (-) |
| `deposits` | `mapping(address => uint256)` public | Share units per LP. | `deposit`, `withdraw` |
| `_debt` | `mapping(address => uint256)` internal | Principal plus fee owed per member. | `borrow`, `repay` |

Functions (all state-changing ones are `nonReentrant`):

| Function (line) | Reverts | Effects and events |
|---|---|---|
| `deposit(uint256 amount)` (62) | `ZeroAmount()` if `amount == 0`; `ZeroAmount()` again if the computed `units == 0` | `value = poolValue()`; `units = (totalDeposits == 0 || value == 0) ? amount : amount * totalDeposits / value` (rounds down); `deposits[msg.sender] += units`; `totalDeposits += units`; `ASSET.safeTransferFrom(msg.sender, this, amount)`; `Deposited(lp, amount)`. NatSpec: "Deposit `amount` kUSD and receive share units at the current pool price, so a late LP cannot capture fees earned before they joined. Units round down (the safe direction)." |
| `withdraw(uint256 amount)` (75) | `ZeroAmount()`; `InsufficientDeposit(amount, entitlement)` if `amount > entitlement(msg.sender)`; `InsufficientLiquidity(amount, liquidity)` if `amount > liquidity()` | `units = (amount * totalDeposits + value - 1) / value` (rounds up), clamped to `deposits[msg.sender]`; `deposits[msg.sender] -= units`; `totalDeposits -= units`; `ASSET.safeTransfer(msg.sender, amount)`; `Withdrawn(lp, amount)`. |
| `borrow(uint256 amount)` (106) | `ZeroAmount()`; `ExceedsCreditLimit(amount, availableCredit)`; `InsufficientLiquidity(amount, liquidity)` | `fee = amount * FEE_BPS / 10_000`; `_debt[msg.sender] += amount + fee`; `totalOutstanding += amount + fee`; `ASSET.safeTransfer(msg.sender, amount)`; `Borrowed(member, amount, fee, owed)`. |
| `repay(uint256 amount)` (122) | `NothingToRepay()` if `_debt == 0`; `ZeroAmount()` | `amount = min(amount, owed)`; `_debt[msg.sender] = owed - amount`; `totalOutstanding -= amount`; `ASSET.safeTransferFrom(msg.sender, this, amount)`; `Repaid(member, amount, owed - amount)`. |

Views: `poolValue() = liquidity() + totalOutstanding`; `entitlement(lp) = totalDeposits == 0 ? 0 : deposits[lp] * poolValue() / totalDeposits`; `outstanding(member) = _debt[member]`; `liquidity() = ASSET.balanceOf(this)`; `creditLimit(member)` = the `limit` from `_underwrite`; `availableCredit(member) = owed >= limit ? 0 : limit - owed`; `underwrite(member)` returns `(score, tier, limit, reason)` where `reason` is `"no proven history yet: contribute to a circle on Ethereum and let the proof land"` when `onTime + late + missed == 0`, `"tier D: no credit (<missed> missed, <late> late)"` when `factor == 0`, otherwise `"tier <T>: <factor>% of <volume / 1e6> tUSD proven volume"` with `", capped at 5000 kUSD"` appended when `limit == CAP`.

`_underwrite(member)` (line 193): `rec = LEDGER.getRecord(member)`; `(score, tier) = LEDGER.creditScore(member)`; if `onTime + late + missed == 0` return `(score, 0, tier, 0, rec)`; `factor` = 100 / 50 / 20 / 0 for tier `"A"` / `"B"` / `"C"` / other; if `factor == 0 && rec.missed > 0` return limit 0 (the same result as the general formula, kept explicit); `limit = min(CAP, rec.volume * factor / 100)`.

Events: `Deposited(address indexed lp, uint256 amount)`, `Withdrawn(address indexed lp, uint256 amount)`, `Borrowed(address indexed member, uint256 amount, uint256 fee, uint256 outstanding)`, `Repaid(address indexed member, uint256 amount, uint256 outstanding)`. Errors: `ZeroAmount()`, `InsufficientDeposit(uint256 requested, uint256 deposited)`, `InsufficientLiquidity(uint256 requested, uint256 available)`, `ExceedsCreditLimit(uint256 requested, uint256 available)`, `NothingToRepay()`.

## 8. KittyUSD

File `src/asc/KittyUSD.sol`. NatSpec: "Demo liquidity token on Creditcoin. 6-decimal stablecoin stand-in that KittyCreditLine lends out. Open mint: testnet only." `ERC20("Kitty USD", "kUSD")`, no initial supply, `decimals()` returns 6, open `mint(address to, uint256 amount)`.

## 9. KittyBadge

File `src/asc/KittyBadge.sol`. NatSpec: "Soulbound 'Kitty Score' badge on Creditcoin. One badge per address, claimable only once the ledger holds proven history for the caller. The token never leaves its owner (ERC-5192: `locked` is always true, transfers revert). Its image and metadata are rendered on-chain from the *live* ledger, so the badge changes as proofs land: it is a window onto `creditScore`, not a snapshot."

Inheritance: `ERC721("Kitty Score", "KITTY")`, `IERC5192` (declared in the same file: events `Locked(uint256)`, `Unlocked(uint256)`, function `locked(uint256) view returns (bool)`). Constructor `(KittyLedger ledger)`: immutable `LEDGER`. No storage beyond `ERC721`.

| Function (line) | Reverts | Behaviour |
|---|---|---|
| `claim() returns (uint256 tokenId)` (38) | `NoProvenHistory(msg.sender)` if `onTime + late + missed == 0`; `AlreadyClaimed(msg.sender)` if the token exists | `tokenId = uint256(uint160(msg.sender))`; `_mint`; emits ERC-721 `Transfer(0, caller, tokenId)` and `Locked(tokenId)`. |
| `tokenIdOf(address) pure` (47) | | `uint256(uint160(member))`. |
| `hasClaimed(address) view` (51) | | `_ownerOf(tokenId) != 0`. |
| `locked(uint256 tokenId) view` (57) | `ERC721NonexistentToken(tokenId)` for an unminted id | Always `true` for an owned token. |
| `supportsInterface(bytes4)` (62) | | `IERC5192` interface id or `ERC721`'s. |
| `_update(address to, uint256 tokenId, address auth)` (67, internal override) | `Soulbound()` whenever the token already exists | NatSpec: "Mint is the only allowed state change: any transfer or burn reverts." |
| `approve(address, uint256)` (72), `setApprovalForAll(address, bool)` (76) | always `Soulbound()` | |
| `tokenURI(uint256)` (82) | `ERC721NonexistentToken` if unminted | `"data:application/json;base64," + Base64(metadata(tokenId))`. |
| `metadata(uint256) view` (88) | | JSON with `name` `"Kitty Score <score> (<tier>)"`, a description, attributes `score`, `tier`, `on_time`, `late`, `missed`, `proven_volume_usd` (`volume / 1e6`), and `image` as a base64 SVG. Read live from `LEDGER.creditScore` and `LEDGER.getRecord`. |
| `image(uint256) view` (119) | | NatSpec: "400x240 on-chain SVG, unencoded." Score, tier pill, counters and the member address. |

Errors: `NoProvenHistory(address member)`, `AlreadyClaimed(address member)`, `Soulbound()`, plus ERC-721's. `Unlocked` is declared by ERC-5192 and never emitted.

## 10. IChainInfo and ChainInfoLib

File `src/interfaces/IChainInfo.sol`. NatSpec: "Subset of the Attestcoin ChainInfo precompile at `0x0FD3` (4051) used by Kitty. Function names are snake_case on the precompile; selectors derive from these exact names. Mirrors the chain_info.json ABI shipped in the usc-sdk package. Struct *names* are local; only the tuple layouts below are part of the ABI, and they match the precompile exactly."

### Struct layouts and precompile equivalents

| Local struct | Tuple layout | Precompile result type |
|---|---|---|
| `HeightHash { uint64 height; bytes32 hash; bool isAttestation; bool exists; }` | `(uint64,bytes32,bool,bool)` | `HeightHashResult` |
| `BoundsCheck { uint64 parentHeight; bytes32 parentHash; bool parentIsAttestation; uint64 childHeight; bytes32 childHash; bool childIsAttestation; bool isAttested; }` | `(uint64,bytes32,bool,uint64,bytes32,bool,bool)` | `BoundsCheckResult` |
| `ChainInfoData { uint64 chainKey; uint64 chainId; bytes chainName; uint8 chainEncoding; }` | `(uint64,uint64,bytes,uint8)` | `ChainInfoData` as published |
| `ChainInfoResult { ChainInfoData info; bool exists; }` | `((uint64,uint64,bytes,uint8),bool)` | `ChainInfoResult` as published |

Because ABI encoding of a struct return value depends only on the tuple layout, a Solidity caller declaring these local names decodes the precompile's bytes correctly; the names never enter the selector or the encoding. `MockChainInfo` declares the same four structs under the same names and layouts (section 11).

### Functions

| Function | Returns | Used by |
|---|---|---|
| `is_height_attested(uint64 chainKey, uint64 targetHeight)` | `bool` | `KittyLedger.closeRound` (the deadline-path gate). NatSpec: "True once the attestor network has attested `targetHeight` on `chainKey`. Kitty uses this as its only clock: a round can close early if everyone paid, or after the round's deadline *source-chain block* is attested. No timestamps, no oracle." |
| `get_latest_attestation_height_and_hash(uint64 chainKey)` | `HeightHash` | `KittyLedger._initCircle` (frontier bound at creation). |
| `find_lowest_attested_after(uint64 chainKey, uint64 targetHeight)` | `HeightHash` | `KittyLedger.closeRound` (the attestation recorded as evidence). NatSpec: "The first attested height at or after `targetHeight`, i.e. *which* attestation will make a payment mined at `targetHeight` provable. `exists == false` while none has landed." |
| `find_highest_attested_before(uint64 chainKey, uint64 targetHeight)` | `HeightHash` | not called by the contracts; exercised against the mock in `test/KittyMultiChain.t.sol`. |
| `get_attestation_bounds(uint64 chainKey, uint64 targetHeight)` | `BoundsCheck` | dashboard (`web/src/hooks.ts`); mock test `test_attestationBoundsAnswerWhenAPaymentBecomesProvable`. |
| `get_attestation_genesis_height(uint64 chainKey)` | `uint64` | mock test only. |
| `get_chain_by_key(uint64 chainKey)` | `ChainInfoResult` | `KittyLedger._initCircle` (registry check). NatSpec: "`exists == false` means the network does not attest that chain, so a circle must never be bound to it." |
| `get_supported_chains()` | `ChainInfoData[]` | mock test `test_chainInfoRegistryIsReadableThroughTheInterface`. |

`ChainInfoLib` (line 83): `PRECOMPILE = 0x0000000000000000000000000000000000000fD3`; `chainInfo() pure returns (IChainInfo)` wraps the address. The pair is the ChainInfo counterpart of `NativeQueryVerifierLib.getVerifier()` for `0x0FD2`.

## 11. Test doubles: MockVerifier and MockChainInfo

Neither mock is deployed by the production scripts. Tests etch their runtime code at the precompile addresses:

```solidity
vm.etch(0x0000000000000000000000000000000000000FD2, address(new MockVerifier()).code);
vm.etch(0x0000000000000000000000000000000000000fD3, address(new MockChainInfo()).code);
```

The local two-anvil scripts do the same with `anvil_setCode` and `forge inspect <Mock> deployedBytecode` (`scripts/local-setup.sh`). Because `vm.etch` and `anvil_setCode` copy code but not constructor effects, both mocks must work with zero-initialised storage; that is why `MockVerifier.accept` defaults to `true` through an initialiser that is *not* part of the etched code (every `setUp` calls `setAccept(true)` explicitly) and why `MockChainInfo` derives its default registry instead of writing it at deploy time.

### MockVerifier (`test/mocks/MockVerifier.sol`)

NatSpec: "Stand-in for the block-prover precompile (0x0FD2). Etched at that address in tests. txIndex is derived from the merkle root so distinct fixtures get distinct query ids."

| Member | Behaviour |
|---|---|
| `bool accept` | Returned by every verify call. Zero after etching; `setAccept(true)` in every `setUp`; `setAccept(false)` in `test_batch_rejectsWhenPrecompileRejects`. |
| `uint256 batchCalls`, `singleCalls`, `lastBatchSize` | Counters incremented by the `verifyAndEmit` overloads; tests assert `batchCalls == 1` to prove a round settled in one precompile call. |
| `calculateTxIndex(MerkleProof) pure returns (uint64)` | `uint64(uint256(p.root) & 0xffff)`: the low 16 bits of the Merkle root. Two fixtures with different roots (and the same height) therefore usually get different query ids; a collision is possible and the invariant handler's `_freshProof` loops until it finds an unused id. |
| `verify(...)` (single and batch, `view`) | Return `accept`. |
| `verifyAndEmit(...)` (single and batch) | Increment the counter, record `lastBatchSize = heights.length` for the batch form, return `accept`. Nothing is inspected and no `TransactionVerified` event is emitted. |

What it does *not* emulate: Merkle inclusion, continuity against attestations, the real `calculateTxIndex` arithmetic, and the precompile's revert reasons. Those are covered only by `pnpm verify:live` and the testnet rounds ([`THREAT_MODEL.md` limit 8](../THREAT_MODEL.md#6-known-limits)).

### MockChainInfo (`test/mocks/MockChainInfo.sol`)

NatSpec: "Stand-in for the ChainInfo precompile (0x0FD3). Etched at that address in tests (and by scripts/local-setup.sh via anvil_setCode), so it must work with *no* constructor: every default below is derived, never written at deploy time. Attestation model: one settable head per chain key. `attestedHeight[k] >= h` iff h attested. Registry model: an empty registry means 'chainKey 1 (Sepolia) and chainKey 3 (Ethereum mainnet) exist', matching CC3 Testnet, so a freshly etched mock supports circle creation immediately. The moment `setChain` is called the explicit registry takes over completely."

Setters: `setAttestedHeight(uint64 chainKey, uint64 h)` (the attested frontier), `setGenesisHeight(uint64, uint64)`, `setChain(uint64 chainKey, uint64 chainId, string name, bool exists)` (flips `registrySet` and thereafter only explicitly registered keys exist), `initDefaultChains()` (registers key 1 as `11155111 "Ethereum Sepolia"` and key 3 as `1 "Ethereum Mainnet"` explicitly, used by `KittyMultiChainTest.setUp`).

Precompile surface, in terms of `head = attestedHeight[chainKey]`:

| Function | Mock answer |
|---|---|
| `is_height_attested(k, h)` | `head >= h` |
| `get_latest_attestation_height_and_hash(k)` | `{height: head, hash: _hash(k, head), isAttestation: true, exists: head > 0}` |
| `find_lowest_attested_after(k, h)` | if `head >= h`: `{h, _hash(k, h), true, true}`, else all-zero with `exists = false`. The mock reports the target itself as the covering attestation, which is why `test_closeRound_recordsAttestationEvidence` and `invariant_closeEvidence` expect `attestedCloseHeight == closeHeight`. |
| `find_highest_attested_before(k, h)` | `head == 0`: not found; else `min(head, h)` with `_hash`. |
| `get_attestation_bounds(k, h)` | `parent = head >= h ? h : head`; `childHeight = h`; `childIsAttestation = isAttested = head >= h`; `parentIsAttestation = head > 0`. |
| `get_attestation_genesis_height(k)` | `genesisHeight[k]`. |
| `get_chain_by_key(k)` | default registry: exists for 1 and 3 only; explicit registry: `_exists[k]`. |
| `get_supported_chains()` | default: `[1, 3]`; explicit: every key with `_exists`. |

`_hash(chainKey, h) = keccak256(abi.encode(chainKey, h))`. Tests that assert evidence recompute it the same way.

How tests advance the attested frontier: unit and fuzz tests call `chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(id, r))` (or `deadline + 64` literally) before a deadline-path `closeRound`, and set it one block short to assert `RoundStillOpenOnSource`; `test_createCircle_revertsWhenRound0DeadlineAlreadyAttested` sets it to `START + ROUND_BLOCKS` to trigger the creation bound. The invariant handler mirrors the frontier in its own `frontier` variable: `advanceFrontier(delta)` adds `bound(delta, 0, 2**18)` and writes it to the mock, and `closeRound(..., viaDeadline = true)` jumps the frontier to `closeHeight` when a partial round is to be closed. New circles are created at `startHeight = frontier + bound(startOffset, 0, 2**20)` so they never trip the creation bound. The shell scripts move it with `cast send 0x…0fD3 "setAttestedHeight(uint64,uint64)" $SOURCE_CHAIN_KEY <height>` against the Creditcoin anvil (`scripts/local-e2e.sh`, `scripts/scenarios.sh`).
