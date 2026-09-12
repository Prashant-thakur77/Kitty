# Gas

Two kinds of numbers live here and they must not be mixed up.

1. **Contract cost, measured in Foundry** (`test/KittyGas.t.sol`). The two Attestcoin precompiles are mocks, so these figures are what `KittyLedger` itself spends on decoding, checks and storage, *on top of* proof verification. `KittyVault` figures are complete (nothing is mocked on the source chain).
2. **Live precompile cost**, from `eth_estimateGas` against CC3 Testnet with real proofs (README, "Gas, measured"). This is what verification adds.

Method for (1): `setUp` prepares every scenario in its own transaction; each test then makes exactly one external call and reports the `gasleft()` delta around it. Storage is therefore cold, as in a real transaction. The delta includes the CALL itself and excludes the 21,000 intrinsic cost and calldata. Regenerate with:

```bash
forge test --match-contract KittyGasTest -vv | grep 'GAS '
forge snapshot            # per-test totals → .gas-snapshot
forge test --gas-report   # min / avg / max per function across the whole suite
```

## Key operations (Foundry, mock precompiles, cold storage)

| Operation | Gas | What dominates |
|---|---:|---|
| `createCircle`, 3 members | 331,549 | Circle struct (name, contribution, heights, vault, organiser, chain key: ~8 fresh slots ≈ 180k) plus `isMember` + `members.push` per member (2 fresh slots ≈ 44k each). |
| `createCircle`, 10 members | 654,735 | Same base; each extra member adds ≈ 46k (two fresh slots + event data). |
| `createOpenCircle` | 289,528 | Circle struct plus one member (organiser), who is also auto-consented (`accepted`, `_memberCircles.push`). |
| `redeemInvite` | 148,117 | `ecrecover` + EIP-191 digest (~5k), then five fresh slots: `usedInviteNonces`, `isMember`, `members.push`, `accepted`, `_memberCircles.push`. |
| `closeInvites` | 19,505 | One packed slot rewrite (`open`, `maxMembers`) and an event. |
| `acceptMembership` | 61,299 | `accepted` + `_memberCircles` (length + element) — up to three fresh slots. |
| `setRotation` | 21,822 | One packed slot rewrite after reading round 0. |
| `recordContributions`, batch = 1, member's first-ever proof | 309,174 | Per contribution: `processedQueries` (22.1k), `Contribution` (2 slots, 44k), `Round.contributions`/`pot` (44k on the round's first proof), `accepted` + `_memberCircles.push` (≈ 27–44k), `MemberRecord` counters + volume (2 slots: 44k when fresh, 10k with history), three events, EvmV1 receipt decoding. About 8–10 cold writes ≈ 170–220k of the total. |
| `recordContributions`, batch = 1, member with history | 257,874 | Same minus ~51k: the record's two slots are already non-zero and the member's `_memberCircles` length slot is warm. |
| `recordContributions`, batch = 3, first-ever records | 788,930 | ≈ 263k per contribution. |
| `recordContributions`, batch = 10, first-ever records | 2,496,380 | ≈ 250k per contribution. |
| `recordContributions`, batch = 10, members with history | 1,983,380 | ≈ 198k per contribution. Storage is per member, so the contract-side cost is nearly linear in batch size; the shared part (circle SLOADs, one verifier call, batch prologue) is small. The *batch saving is in verification* — see the live figures below. |
| `closeRound`, early (3 paid, Fixed) | 99,350 | `recipient` (fresh slot), `receivedPot` (fresh), `Round.status`, `received` counter, `currentRound`, two events; one `Contribution` + `receivedPot` read per member in the rotation loop. |
| `closeRound`, early (3 paid, ByScore) | 113,148 | Fixed cost plus a `creditScore` read (one `MemberRecord` SLOAD + arithmetic) per candidate. |
| `closeRound`, deadline (1 paid, 2 missed) | 173,545 | Two ChainInfo calls, `attestedCloseHeight`/`attestedCloseHash` (2 fresh slots, 44k), and per miss a `missed` counter update + `ContributionMissed` event. |
| `closeRound`, deadline (1 paid, 9 missed) | 282,976 | ≈ 13.7k per additional miss (counter SSTORE, `accepted` + `Contribution` SLOADs, event). Members here have history; a miss against a member with a *zero* record costs 22.1k instead of 5k for the counter write (402,676 measured when seven of the nine had no record yet: +17.1k each, exactly the fresh-minus-rewrite SSTORE difference). |
| `closeRound`, final round → Completed | 97,920 | As early close, writing `status = Completed` instead of `currentRound` + `RoundOpened`. |
| `confirmPayout` | 105,391 | `processedQueries` + `payoutQueryId` (2 fresh slots, 44k), `Round.status` rewrite, receipt decoding, single-query verifier call. |
| `confirmPayouts`, batch = 3 | 249,146 | ≈ 83k per payout: the same two fresh slots each, one shared verifier call. |
| `KittyVault.contribute`, first payment into a circle | 75,066 | `safeTransferFrom` (vault balance zero→non-zero), `pot` and `contributor` both fresh (44k), `nonReentrant` guard, event. |
| `KittyVault.contribute`, pot non-zero, new contributor | 57,966 | `pot` and the vault's token balance are now rewrites (5k each); `contributor` still fresh. |
| `KittyVault.contribute`, repeat contributor | 38,066 | Only rewrites: transfer balances, `pot`, guard; `contributor` unchanged. |
| `KittyVault.payout` | 62,622 | `paidOut` (fresh, 22.1k), `pot` rewrite, `safeTransfer`, guard, event. Bounded to circle contributors — one extra SLOAD. |

Runtime size of `KittyLedger`: 22,306 bytes (`forge build --sizes`), under the 24,576-byte limit.

## `forge test --gas-report` (whole suite, min / avg / max)

| Function | Min | Avg | Max | Calls |
|---|---:|---:|---:|---:|
| `KittyLedger.createCircle` | 24,233 | 464,918 | 670,152 | 435 |
| `KittyLedger.createOpenCircle` | 38,495 | 310,420 | 338,469 | 66 |
| `KittyLedger.redeemInvite` | 25,971 | 153,287 | 180,376 | 44 |
| `KittyLedger.closeInvites` | 26,537 | 31,433 | 33,501 | 9 |
| `KittyLedger.acceptMembership` | 75,295 | 86,526 | 92,395 | 271 |
| `KittyLedger.setRotation` | 26,465 | 35,452 | 35,934 | 30 |
| `KittyLedger.recordContributions` | 25,146 | 687,445 | 2,574,027 | 352 |
| `KittyLedger.closeRound` | 24,275 | 119,314 | 299,087 | 191 |
| `KittyLedger.confirmPayout` | 38,805 | 115,926 | 140,481 | 9 |
| `KittyLedger.confirmPayouts` | 25,495 | 143,357 | 309,839 | 11 |
| `KittyVault.contribute` | 26,958 | 94,627 | 105,733 | 52 |
| `KittyVault.payout` | 29,252 | 44,075 | 69,417 | 6 |

Minimums are reverting calls (the attack tests); the gas-report figures include calldata and the 21k intrinsic cost, which is why they sit above the table in the previous section for the same operation.

## Live precompile figures (README, "Gas, measured")

`eth_estimateGas` against the block-prover precompile on CC3 Testnet with real Sepolia proofs:

| Call | Continuity roots | Gas |
|---|---:|---:|
| single `verify`, tx at 11656253 #86 | 48 | 104,141 |
| single `verify`, tx at 11656253 #85 | 48 | 112,239 |
| single `verify`, tx at 11656295 #44 | 6 | 45,433 |
| three singles, total | | 261,813 |
| **one batch `verify` of the same three** | 48, shared | **199,375** |

Verification cost is driven by the continuity proof — the number of block roots between the proven block and an attested one — so it grows with the age of the block at proving time and is paid once per batch rather than once per payment. The batch is 24% cheaper for three payments, and the gap widens with older blocks and larger batches (`MAX_BATCH = 10`).

## Putting the two together

A round of three payments proven in one `recordContributions` call costs roughly:

- contract side (this document, members with history): ≈ 3 × 200k ≈ 600k
- verification (README): ≈ 200k for the shared batch proof vs ≈ 262k for three singles

So on the ledger the cost is dominated by the contract's own storage writes — each proven payment becomes about eight permanent slots of credit history — while batching pays for itself entirely inside the precompile. That is the intended trade: the storage is the product (proof-backed history a lender can read), and the verification is the part that Attestcoin lets us share.
