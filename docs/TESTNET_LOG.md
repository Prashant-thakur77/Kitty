# Testnet transaction log

Every on-chain step of the live demo (Sepolia ↔ Creditcoin CC3 Testnet). Rows are appended with

```bash
pnpm txlog <sepolia|creditcoin> <txhash> "<action>"     # fetches the receipt, adds the explorer link + gas used
```

Explorers: Sepolia — https://sepolia.etherscan.io · Creditcoin CC3 Testnet — https://creditcoin-testnet.blockscout.com

Actions to expect, in order: `deploy TestUSD` · `deploy KittyVault` · `deploy KittyLedger` · `fund member N` ·
`createCircle` · `contribute round R member N` · `recordContributions round R (batch of N)` · `closeRound R` ·
`payout round R` · `confirmPayout round R` · attack-lab attempts (`replay`, `spoofEmitter`, `wrongChain`, `revertedTx`, `late`, `stealFromSteward`, `fireTheAgent`, `poisonReasoning`).

| date | chain | action | tx | gas used |
|---|---|---|---|---|

## Live precompile verification (no deployment needed)

2026-09-08 · Sepolia tx [`0xe3ef81c8…757b8d`](https://sepolia.etherscan.io/tx/0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d) (FakeVault deployment, block 11656295, index 44)
→ Proof Builder proof (7 Merkle siblings, 6 continuity roots) → `0x0FD2.verify` on CC3 Testnet = **true**; tampered bytes → "Merkle proof validation failed"; chainKey 3 → "Continuity proof does not match attestation or checkpoint". Command: `pnpm verify:live 0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d`.

2026-09-08 · **Batch**: the three Sepolia deployment txs (TestUSD, KittyVault @ 11656253; FakeVault @ 11656295) → one `/proof-batch-by-tx/1` call → `0x0FD2.verify(batch)` on CC3 Testnet = **true** with one shared continuity proof (48 roots). Command: `pnpm verify:live 0x9e77a48510f253f834af4538b463a127e3d41bbd23f935b3e12d379c0f5680b8 0x693dfb700f563bfbf41647ea73a3e8e50f3fe18bcf005c7185a355664f9924b3 0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d`.

## Sepolia deployments

| date | contract | address |
|---|---|---|
| 2026-09-08 | TestUSD | https://sepolia.etherscan.io/address/0xc6fe7fd411681E07a44523f87F6aB0805903c2dE |
| 2026-09-08 | KittyVault (v2, contributor-only payouts; v1 was 0x15D30C27d0E26dCFFe06E76680F55A0A358cf63E) | https://sepolia.etherscan.io/address/0x1172ABd45724069749E9EB98A0349177435B284E |
| 2026-09-08 | FakeVault | https://sepolia.etherscan.io/address/0xf6f984c6aa6806a8afcc8713a2adea7fa05cf1fb |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyLedger | [0xfd7ddecc…e88b8c](https://creditcoin-testnet.blockscout.com/tx/0xfd7ddecc5b5975add35a6ba7ff7d9dfb02e3e773f21c16de7464911734e88b8c) | 4732334 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyViewer | [0xa20a6e3c…00ed51](https://creditcoin-testnet.blockscout.com/tx/0xa20a6e3c9e1b493ee174511885fa8d9d15194768640ca4b678236b8e6800ed51) | 1214632 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyUSD | [0x0d9a3f8b…20e680](https://creditcoin-testnet.blockscout.com/tx/0x0d9a3f8b6cf8584416097eac0da8ce9376dbaad2907018ec80e718c2fb20e680) | 483545 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyCreditLine | [0xc341df41…3581bb](https://creditcoin-testnet.blockscout.com/tx/0xc341df41c06630942f94c3b363f7c88c785b6821b35e66be4b59579c443581bb) | 1083334 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyBadge | [0x91f4683a…5aabe2](https://creditcoin-testnet.blockscout.com/tx/0x91f4683a751349a345c3f91a6bbe502db72c65d7d0edc84ebb9815f0135aabe2) | 1834620 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle (Delhi Chit Circle, 3 members, 100 tUSD, 200 blocks) | [0x342f75d7…3cb89c](https://creditcoin-testnet.blockscout.com/tx/0x342f75d7bf3a5e3dadabc1a5b04a77e80ace7d232a01aafd792da4f2673cb89c) | 354101 |
| 2026-09-12 | Creditcoin CC3 Testnet | setRotation ByScore | [0x97122697…496bc3](https://creditcoin-testnet.blockscout.com/tx/0x97122697f3404ad72a82584e328f330c8885bd7548bda7aa829a15d3fe496bc3) | 317842 |
| 2026-09-12 | Sepolia | contribute round 0 member 0 | [0x2e6fb78a…ed40e8](https://sepolia.etherscan.io/tx/0x2e6fb78a58bde01ea00469ddf5e5182a82594f58cba67c38f00db2d7b4ed40e8) | 105733 |
| 2026-09-12 | Sepolia | contribute round 0 member 1 | [0x6b61e737…2248bf](https://sepolia.etherscan.io/tx/0x6b61e737ff7fd7f03efe66676afd1cf08b9b3f1b6fc758e2a92fa143ca2248bf) | 71533 |
| 2026-09-12 | Sepolia | contribute round 0 member 2 | [0xb8fb7d9e…5dba02](https://sepolia.etherscan.io/tx/0xb8fb7d9e82c42e83d9ad084df418a119a482c02d6d5dbf77acb2f6aba45dba02) | 71533 |
| 2026-09-12 | Creditcoin CC3 Testnet | recordContributions round 0 (batch of 1, verified by 0x0FD2) | [0xaf5a3477…3e3ec0](https://creditcoin-testnet.blockscout.com/tx/0xaf5a3477f4460cca81100c5ce11fa136b41dab1cc4f5dc1fce889c52ff3e3ec0) | 390516 |
| 2026-09-12 | Creditcoin CC3 Testnet | recordContributions round 0 (batch of 2, verified by 0x0FD2) | [0x05ef192d…39c0ef](https://creditcoin-testnet.blockscout.com/tx/0x05ef192da87d9e70898e4be106a44a77be0431e6bbe9a4eca7112e49f739c0ef) | 588527 |
| 2026-09-12 | Creditcoin CC3 Testnet | closeRound 0 (everyone paid) | [0xc9ca3583…4cd89c](https://creditcoin-testnet.blockscout.com/tx/0xc9ca3583bdc4143e46838a6005ffca2802b866b472285252ad513e46494cd89c) | 341740 |
| 2026-09-12 | Sepolia | payout round 0 (300 tUSD to member 0) | [0xe8b660fa…626841](https://sepolia.etherscan.io/tx/0xe8b660face84ebcd2164861a1dacd0621af892f278a442c1fb688b2641626841) | 64821 |
| 2026-09-12 | Creditcoin CC3 Testnet | confirmPayout round 0 (payout proven back through 0x0FD2) | [0x7bda53a5…3c0da9](https://creditcoin-testnet.blockscout.com/tx/0x7bda53a527732ebab36299206e616c53af38acc60d886d27081a88888f3c0da9) | 372484 |
