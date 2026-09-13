# Storage layout

The storage layout of the three stateful contracts that hold protocol state, as reported by `forge inspect <path>:<Contract> storage-layout` with the repository's `foundry.toml` (solc 0.8.30, `via_ir = true`, optimizer 200 runs), followed by the derivations a reader needs to locate a specific mapping entry, and the size constraints that bound future changes. Companion documents: [`CONTRACTS.md`](CONTRACTS.md) for what each variable means and who writes it, [`../specs/PROTOCOL.md`](../specs/PROTOCOL.md) section 3 for the data model, [`../GAS.md`](../GAS.md) for what each slot costs to write.

Reproduce:

```bash
forge inspect src/asc/KittyLedger.sol:KittyLedger storage-layout
forge inspect src/source/KittyVault.sol:KittyVault storage-layout
forge inspect src/asc/KittyCreditLine.sol:KittyCreditLine storage-layout
forge inspect src/asc/KittyLedger.sol:KittyLedger storage-layout --json   # includes struct member offsets
forge build --sizes
```

## Contents

1. [KittyLedger](#1-kittyledger)
2. [KittyVault](#2-kittyvault)
3. [KittyCreditLine](#3-kittycreditline)
4. [Mapping key derivations](#4-mapping-key-derivations)
5. [Immutables and constants](#5-immutables-and-constants)
6. [Size and upgrade constraints](#6-size-and-upgrade-constraints)

## 1. KittyLedger

### 1.1 Top-level slots

| Slot | Offset | Bytes | Type | Variable | Notes |
|---:|---:|---:|---|---|---|
| 0 | 0 | 20 | `address` | `_owner` | Inherited from OpenZeppelin `Ownable` (first base contract), so it takes slot 0. |
| 1 | 0 | 32 | `uint256` | `circleCount` | Ids are dense from 1. |
| 2 | 0 | 32 | `mapping(uint256 => Circle)` | `_circles` | Value occupies 7 consecutive slots (section 1.2). |
| 3 | 0 | 32 | `mapping(uint256 => mapping(uint32 => Round))` | `_rounds` | Value occupies 6 slots (section 1.3). |
| 4 | 0 | 32 | `mapping(uint256 => mapping(uint32 => mapping(address => Contribution)))` | `_contributions` | Value occupies 3 slots (section 1.4). |
| 5 | 0 | 32 | `mapping(uint256 => mapping(address => bool))` | `isMember` | |
| 6 | 0 | 32 | `mapping(address => MemberRecord)` | `_records` | Value occupies 2 slots (section 1.5). `test/KittyLedgerFuzz.t.sol` hard-codes `RECORDS_SLOT = 6` and verifies it through `getRecord` on every use. |
| 7 | 0 | 32 | `mapping(uint256 => mapping(address => bool))` | `receivedPot` | |
| 8 | 0 | 32 | `mapping(address => uint256[])` | `_memberCircles` | Dynamic array per member. |
| 9 | 0 | 32 | `mapping(uint64 => mapping(address => bool))` | `trustedVault` | Keyed by chain key first. |
| 10 | 0 | 32 | `mapping(address => uint64)` | `trustedVaultChains` | |
| 11 | 0 | 32 | `mapping(uint256 => mapping(address => bool))` | `accepted` | |
| 12 | 0 | 32 | `mapping(uint256 => mapping(uint256 => bool))` | `usedInviteNonces` | |
| 13 | 0 | 32 | `mapping(bytes32 => bool)` | `processedQueries` | Query id to processed flag. |

Mapping slots hold nothing themselves; the slot number only seeds the key derivation. The contract's own storage therefore contains two directly addressable words (`_owner` and `circleCount`).

### 1.2 `Circle` (224 bytes, 7 slots)

Relative to the base slot `B = keccak256(abi.encode(circleId, 2))`.

| Slot | Offset | Bytes | Type | Field | Notes |
|---:|---:|---:|---|---|---|
| B+0 | 0 | 32 | `string` | `name` | Standard string encoding: if 31 bytes or shorter, data left-aligned in the slot with `length * 2` in the low byte; otherwise `length * 2 + 1` in the slot and data at `keccak256(B+0)` onward. |
| B+1 | 0 | 32 | `address[]` | `members` | Length in the slot; element `i` at `keccak256(B+1) + i`, one address per slot. |
| B+2 | 0 | 32 | `uint256` | `contribution` | |
| B+3 | 0 | 8 | `uint64` | `roundBlocks` | Packed with the next two. |
| B+3 | 8 | 8 | `uint64` | `startHeight` | |
| B+3 | 16 | 4 | `uint32` | `currentRound` | |
| B+4 | 0 | 20 | `address` | `sourceVault` | `_circle` tests this for existence. |
| B+4 | 20 | 1 | `enum CircleStatus` | `status` | |
| B+5 | 0 | 20 | `address` | `organiser` | |
| B+5 | 20 | 1 | `bool` | `open` | |
| B+5 | 21 | 4 | `uint32` | `maxMembers` | |
| B+5 | 25 | 1 | `enum Rotation` | `rotation` | |
| B+6 | 0 | 8 | `uint64` | `chainKey` | Alone in its slot; declared last in the struct. |

The packing explains the gas table in [`GAS.md`](../GAS.md): `closeInvites` rewrites only B+5 (`open`, `maxMembers`), `setRotation` only B+5, and `closeRound` touches B+3 (`currentRound`) or B+4 (`status`).

### 1.3 `Round` (192 bytes, 6 slots)

Relative to `B = keccak256(abi.encode(round, keccak256(abi.encode(circleId, 3))))` with `round` ABI-padded from `uint32` to 32 bytes.

| Slot | Offset | Bytes | Type | Field | Notes |
|---:|---:|---:|---|---|---|
| B+0 | 0 | 1 | `enum RoundStatus` | `status` | Packed with `contributions`. |
| B+0 | 1 | 4 | `uint32` | `contributions` | |
| B+1 | 0 | 32 | `uint256` | `pot` | |
| B+2 | 0 | 20 | `address` | `recipient` | |
| B+3 | 0 | 32 | `bytes32` | `payoutQueryId` | Non-zero iff `status == Paid`. |
| B+4 | 0 | 8 | `uint64` | `attestedCloseHeight` | Zero on an early close. |
| B+5 | 0 | 32 | `bytes32` | `attestedCloseHash` | |

### 1.4 `Contribution` (96 bytes, 3 slots)

Relative to `B = keccak256(abi.encode(member, keccak256(abi.encode(round, keccak256(abi.encode(circleId, 4))))))`.

| Slot | Offset | Bytes | Type | Field | Notes |
|---:|---:|---:|---|---|---|
| B+0 | 0 | 8 | `uint64` | `height` | |
| B+1 | 0 | 32 | `bytes32` | `queryId` | Existence test throughout the ledger and the viewer. |
| B+2 | 0 | 1 | `bool` | `onTime` | |

Three fields, three slots: `height` and `onTime` are small but the `bytes32` between them prevents packing, so recording a contribution writes three slots, of which `height` and `queryId` are always non-zero.

### 1.5 `MemberRecord` (64 bytes, 2 slots)

Relative to `B = keccak256(abi.encode(member, 6))`.

| Slot | Offset | Bytes | Type | Field | Notes |
|---:|---:|---:|---|---|---|
| B+0 | 0 | 4 | `uint32` | `onTime` | The fuzz suite writes this word as `onTime | late << 32 | missed << 64` (`_setRecord`). |
| B+0 | 4 | 4 | `uint32` | `late` | |
| B+0 | 8 | 4 | `uint32` | `missed` | |
| B+0 | 12 | 4 | `uint32` | `received` | |
| B+1 | 0 | 32 | `uint256` | `volume` | |

All four counters share one slot, which is why a member's first proof costs two fresh slots (counters plus `volume`) and every later proof two rewrites (`GAS.md`, "batch = 1, member with history").

## 2. KittyVault

| Slot | Offset | Bytes | Type | Variable | Notes |
|---:|---:|---:|---|---|---|
| 0 | 0 | 20 | `address` | `_owner` | `Ownable`. |
| 1 | 0 | 32 | `uint256` | `_status` | `ReentrancyGuard`: 1 = not entered, 2 = entered. Set to 1 in the constructor, so this slot is always non-zero after deployment. |
| 2 | 0 | 20 | `address` | `operator` | |
| 3 | 0 | 32 | `mapping(uint256 => uint256)` | `pot` | Per circle: `keccak256(abi.encode(circleId, 3))`. |
| 4 | 0 | 32 | `mapping(uint256 => mapping(uint32 => bool))` | `paidOut` | `keccak256(abi.encode(round, keccak256(abi.encode(circleId, 4))))`. |
| 5 | 0 | 32 | `mapping(uint256 => mapping(address => bool))` | `contributor` | `keccak256(abi.encode(member, keccak256(abi.encode(circleId, 5))))`. |

`TOKEN` is immutable (section 5). The order `Ownable`, `ReentrancyGuard` follows the inheritance list `is Ownable, ReentrancyGuard`.

## 3. KittyCreditLine

| Slot | Offset | Bytes | Type | Variable | Notes |
|---:|---:|---:|---|---|---|
| 0 | 0 | 32 | `uint256` | `_status` | `ReentrancyGuard`; the only base contract, so it takes slot 0. |
| 1 | 0 | 32 | `uint256` | `totalDeposits` | Share units, not kUSD. |
| 2 | 0 | 32 | `uint256` | `totalOutstanding` | Principal plus fees owed. |
| 3 | 0 | 32 | `mapping(address => uint256)` | `deposits` | Share units per LP: `keccak256(abi.encode(lp, 3))`. |
| 4 | 0 | 32 | `mapping(address => uint256)` | `_debt` | `keccak256(abi.encode(member, 4))`. |

`LEDGER` and `ASSET` are immutable. The pool's kUSD balance is not in this contract's storage at all; `liquidity()` reads `ASSET.balanceOf(address(this))`.

## 4. Mapping key derivations

Solidity places the value of `mapping(K => V)` declared at slot `p` at `keccak256(h(k) . p)` where `h` left-pads a value-type key to 32 bytes and `p` is the 32-byte slot number; in Solidity terms `keccak256(abi.encode(k, p))`. Nested mappings apply the rule again with the outer result as `p`. Structs and static arrays occupy consecutive slots from that base; dynamic arrays store their length there and their elements from `keccak256(base)`.

The entries a reader of the protocol most often needs:

| State | Slot of the entry |
|---|---|
| `_contributions[circleId][round][member]` | `B = keccak256(abi.encode(member, keccak256(abi.encode(uint256(round), keccak256(abi.encode(circleId, 4))))))`; `height` at `B`, `queryId` at `B+1`, `onTime` at `B+2`. `round` is widened to a full word before hashing. |
| `processedQueries[queryId]` | `keccak256(abi.encode(queryId, 13))`, where `queryId = keccak256(uint256(chainKey) || uint64(height) || uint256(txIndex))` (72-byte preimage, `_computeQueryId`; see [`PROTOCOL.md` section 10](../specs/PROTOCOL.md#10-query-id-derivation)). Anyone can check whether a specific source transaction has already been counted with one `eth_getStorageAt`, given its query id. |
| `trustedVault[chainKey][vault]` | `keccak256(abi.encode(vault, keccak256(abi.encode(uint256(chainKey), 9))))`. The chain key is the outer key, so the same vault address on two chains lives in two unrelated slots. |
| `trustedVaultChains[vault]` | `keccak256(abi.encode(vault, 10))`. |
| `usedInviteNonces[circleId][nonce]` | `keccak256(abi.encode(nonce, keccak256(abi.encode(circleId, 12))))`. |
| `accepted[circleId][member]` | `keccak256(abi.encode(member, keccak256(abi.encode(circleId, 11))))`. |
| `isMember[circleId][member]` | `keccak256(abi.encode(member, keccak256(abi.encode(circleId, 5))))`. |
| `receivedPot[circleId][member]` | `keccak256(abi.encode(member, keccak256(abi.encode(circleId, 7))))`. |
| `_records[member]` | `B = keccak256(abi.encode(member, 6))`; counters packed at `B`, `volume` at `B+1`. |
| `_circles[circleId]` | `B = keccak256(abi.encode(circleId, 2))`; fields per section 1.2; `members[i]` at `keccak256(abi.encode(B + 1)) + i`. |
| `_rounds[circleId][round]` | `B = keccak256(abi.encode(uint256(round), keccak256(abi.encode(circleId, 3))))`; fields per section 1.3. |
| `_memberCircles[member][i]` | length at `L = keccak256(abi.encode(member, 8))`; element `i` at `keccak256(abi.encode(L)) + i`. |

Two consequences for the protocol:

- `_prepareBatch` and `confirmPayout` read `processedQueries` at a slot that is a function of `(chainKey, height, txIndex)` only. A proof's identity does not depend on who submits it, on the circle, or on the encoded transaction bytes, which is what makes replay under a different entry point impossible (`test_replayOfAConfirmedPayoutIsRejected`).
- `trustedVault` is looked up with the *batch's* chain key in `_singleLog` and with the *circle's* chain key in `_initCircle`. Because the chain key is part of the slot derivation, a vault trusted for key 1 is simply absent (zero) under key 3 (`test_vaultTrustedOnAnotherChainIsNotAValidEmitter`).

The fuzz suite relies on the `_records` derivation directly: `_setRecord` in `test/KittyLedgerFuzz.t.sol` writes `keccak256(abi.encode(m, 6))` with `vm.store` and asserts that `getRecord` returns the injected counters, so a layout change would fail the suite rather than silently test the wrong slot.

## 5. Immutables and constants

Immutables are embedded in the runtime bytecode at deployment and occupy no storage slot; constants are compile-time and likewise absent from storage.

| Contract | Immutables | Constants |
|---|---|---|
| `KittyLedger` | `VERIFIER` (`0x…0FD2`), `CHAIN_INFO` (`0x…0fD3`), `SOURCE_CHAIN_KEY` | `CONTRIBUTED_SIG`, `PAIDOUT_SIG`, `MAX_BATCH = 10`, `MAX_MEMBERS = 10`, `GRACE_BLOCKS = 64` |
| `KittyVault` | `TOKEN` | |
| `KittyCreditLine` | `LEDGER`, `ASSET` | `CAP = 5_000e6`, `FEE_BPS = 500` |
| `KittyViewer` | `LEDGER` | `STATUS_PENDING = 0`, `STATUS_PROVEN = 1`, `STATUS_LATE = 2`, `STATUS_MISSED = 3` |
| `KittyBadge` | `LEDGER` | |

A consequence for testing: because `VERIFIER` and `CHAIN_INFO` are fixed addresses in code, the mocks must be etched *at those addresses* (`vm.etch`, `anvil_setCode`); there is no setter to point the ledger elsewhere.

## 6. Size and upgrade constraints

### 6.1 Runtime and initcode size

From `forge build --sizes` (bytes; the EIP-170 runtime limit is 24,576 and the EIP-3860 initcode limit is 49,152):

| Contract | Runtime | Runtime margin | Initcode | Initcode margin |
|---|---:|---:|---:|---:|
| `KittyLedger` | 22,306 | 2,270 | 22,624 | 26,528 |
| `KittyBadge` | 7,971 | 16,605 | 8,851 | 40,301 |
| `KittyViewer` | 5,479 | 19,097 | 5,631 | 43,521 |
| `KittyCreditLine` | 4,657 | 19,919 | 4,868 | 44,284 |
| `KittyVault` | 1,828 | 22,748 | 2,141 | 47,011 |
| `KittyUSD` | 1,726 | 22,850 | 2,518 | 46,634 |
| `TestUSD` | 1,726 | 22,850 | 2,661 | 46,491 |
| `FakeVault` | 192 | 24,384 | 216 | 48,936 |
| `MockChainInfo` (test) | 5,497 | 19,079 | 5,523 | 43,629 |
| `MockVerifier` (test) | 1,057 | 23,519 | 1,094 | 48,058 |
| `KittyLedgerHandler` (test) | 23,143 | 1,433 | 23,762 | 25,390 |
| `KittyLedgerAttacker` (test) | 14,575 | 10,001 | 15,237 | 33,915 |

`KittyLedger` has 2,270 bytes of headroom under the 24,576-byte limit. This is the binding constraint on the contract: [`SLITHER.md`](../SLITHER.md) records that the `uninitialized-local` findings were left as is "to keep the runtime under the 24 KB limit", and the invariant attacker was split out of the handler because the handler alone is at 23,143 bytes ("Kept separate from the handler so neither contract approaches the EIP-170 limit", `test/invariant/KittyLedgerAttacker.sol`). Any new check, error argument or event in `KittyLedger` should be measured with `forge build --sizes` before it is merged; `via_ir = true` and `optimizer_runs = 200` are already the size-favouring settings.

### 6.2 Upgradeability

None of the contracts is upgradeable: there are no proxies, no `initialize` functions, no `delegatecall`, and the immutables bind each contract to its dependencies at deployment ([`SLITHER.md`](../SLITHER.md): "no delegatecall, no unprotected initialisers"). A change to `KittyLedger` is a fresh deployment with a new address and an empty state, and [ADR 0005](../adr/0005-one-vault-per-ledger.md) requires that deployment to be paired with a fresh `KittyVault`: the vault's `paidOut[circleId][round]` and `contributor[circleId][member]` are keyed by ids the new ledger will reuse from 1, and the new ledger's `processedQueries` is empty, so old `Contributed` transactions would otherwise be provable again (`BeforeCircleStart` is the on-chain guard, the pairing is the operational one).

Consequences for anyone changing the layout:

- Because nothing is upgraded in place, slot numbers may change between deployments without a migration. What must not change silently is anything external code reads by slot: `test/KittyLedgerFuzz.t.sol` (`RECORDS_SLOT = 6`) is the only such reader in the repository, and it self-checks.
- Struct field order is part of the ABI of every `view` that returns the struct (`getCircle`, `getRound`, `getContribution`, `getRecord`, and `KittyViewer`'s composites). Reordering or inserting fields changes the ABI seen by the worker (`worker/src/`), the dashboard (`web/src/`) and the bot, even though the contracts themselves would compile.
- `Round.contributions` is `uint32`, `Circle.currentRound` is `uint32`, `Circle.maxMembers` is `uint32`, and `MemberRecord`'s four counters are `uint32`. None can overflow in practice (at most 10 members and 10 rounds per circle; a counter would need 2^32 proven installments), and the packing they enable is what keeps the per-proof write count where `GAS.md` measures it.
- `Circle.chainKey` was added after the other fields and sits alone in slot B+6. B+4 has 11 unused bytes after `sourceVault` and `status`, so declaring `chainKey` directly after `status` would pack it there and save one fresh slot per circle at creation (22,100 gas at the EVM's cold non-zero SSTORE price), at the cost of changing the field order in the `Circle` tuple that `getCircle` returns.
