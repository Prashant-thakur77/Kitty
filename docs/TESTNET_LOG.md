# Testnet transaction log

Every on-chain step of the live demo (Sepolia ↔ Creditcoin CC3 Testnet). Rows are appended with

```bash
pnpm txlog <sepolia|creditcoin> <txhash> "<action>"     # fetches the receipt, adds the explorer link + gas used
```

Explorers: Sepolia — https://sepolia.etherscan.io · Creditcoin CC3 Testnet — https://creditcoin-testnet.blockscout.com

Actions to expect, in order: `deploy TestUSD` · `deploy KittyVault` · `deploy KittyLedger` · `fund member N` ·
`createCircle` · `contribute round R member N` · `recordContributions round R (batch of N)` · `closeRound R` ·
`payout round R` · `confirmPayout round R` · attack-lab attempts (`replay`, `spoofEmitter`, `wrongChain`, `revertedTx`, `late`, `stealFromSteward`, `fireTheAgent`, `poisonReasoning`).

Two full rounds settled on 12 September 2026. On the first ledger (`0xc6fe…c2dE`): 3 Sepolia payments → 2 batch proofs (1 + 2, before the roundmate hold rule) → early close → 300 tUSD payout → proof-back; then all eight attack scenarios, including a real late payment after the attested deadline. On the final ledger (`0xC2A1…F276`, paired with vault `0xa27e…DA84`): 3 payments → **one batch proof for the whole round** → early close → 300 tUSD payout → proof-back. Rows are in chronological order.

| date | chain | action | tx | gas used |
|---|---|---|---|---|
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
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyLedger v2 (startHeight bounded by the attested frontier; misses record the attestation that proved the deadline) | [0x41753630…83ab68](https://creditcoin-testnet.blockscout.com/tx/0x4175363073918ba657b0a39f830c0ffaafb0ddafdfb78f7e901af0366c83ab68) | 4889709 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyBadge (v2 ledger) | [0x698d1b06…4318cd](https://creditcoin-testnet.blockscout.com/tx/0x698d1b0605517aed9d6b05f9f61718c91db0c3d63f419004c2556ccc874318cd) | 1834620 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle on v2 (Delhi Chit Circle, 3 members, 100 tUSD, 200 blocks) | [0xbb449c9e…e89bf7](https://creditcoin-testnet.blockscout.com/tx/0xbb449c9e9cc4bb43f0c044f3f2e8701e65a6c194de4e9b26e94d348530e89bf7) | 357960 |
| 2026-09-12 | Creditcoin CC3 Testnet | setRotation ByScore (v2 circle 1) | [0x317ad64c…d16268](https://creditcoin-testnet.blockscout.com/tx/0x317ad64c3245722be384b993a28b74bda6ec4521b79f2efc90d97353bed16268) | 328048 |
| 2026-09-12 | Sepolia | contribute round 0 member 0 (v2 circle 1) | [0xf231e011…088f7e](https://sepolia.etherscan.io/tx/0xf231e011ab2f665066ed31f86500b007c983fcf2abdfaf7e40deabc656088f7e) | 51633 |
| 2026-09-12 | Sepolia | contribute round 0 member 1 (v2 circle 1) | [0xf8446f1f…c39d34](https://sepolia.etherscan.io/tx/0xf8446f1f4806bd03def5c3c107d5a3bd448ea91a7fb5926933be579e06c39d34) | 51633 |
| 2026-09-12 | Sepolia | contribute round 0 member 2 (v2 circle 1) | [0x2402e24b…ed4c64](https://sepolia.etherscan.io/tx/0x2402e24b0df89a5db1f9d3c2216b39b69b7195e31a57f1f1b133652e8ced4c64) | 51633 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyLedger v3 (payments cannot predate the circle) | [0x3053c63b…3c411c](https://creditcoin-testnet.blockscout.com/tx/0x3053c63b37800c09345d4710cab62b82e43d91d6093556023223450d003c411c) | 4901416 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle on v3 (Delhi Chit Circle, 3 members, 100 tUSD, 200 blocks) | [0x970a2b57…a4e336](https://creditcoin-testnet.blockscout.com/tx/0x970a2b5767b9f88a0e336958997f5a4637ef50ac256d3dff01ed79b5f0a4e336) | 357960 |
| 2026-09-12 | Sepolia | contribute round 0 member 0 (v3 circle 1) | [0xe5426f5f…05b8f2](https://sepolia.etherscan.io/tx/0xe5426f5fe1fb7a39c8e7c87884a3b172f79bc3e8c1ad4460f899723ca905b8f2) | 51633 |
| 2026-09-12 | Sepolia | contribute round 0 member 1 (v3 circle 1) | [0xa81e72db…1af76b](https://sepolia.etherscan.io/tx/0xa81e72db3c13499c68dd4206a7f6fd57dbec88d86faeeed2f24444280c1af76b) | 51633 |
| 2026-09-12 | Sepolia | contribute round 0 member 2 (v3 circle 1) | [0x53d50a46…9505ae](https://sepolia.etherscan.io/tx/0x53d50a4604e9e4fd15a7e1617e617379ee212e538a50de8b110b8735239505ae) | 51633 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle on the final ledger (Delhi Chit Circle, 3 members, 100 tUSD, 200 blocks) | [0x35963b5a…fcdf9c](https://creditcoin-testnet.blockscout.com/tx/0x35963b5ac50093648923d6ffcce73c31f912c720c888dbe14daef72f63fcdf9c) | 357960 |
| 2026-09-12 | Sepolia | contribute round 0 member 0 (final vault) | [0xe896669f…987a4b](https://sepolia.etherscan.io/tx/0xe896669ff87415e221e9a47c86e00dd164b19d4052450cb560380df8e1987a4b) | 105733 |
| 2026-09-12 | Sepolia | contribute round 0 member 1 (final vault) | [0xbff79eb5…ecfa1d](https://sepolia.etherscan.io/tx/0xbff79eb5e3bebeac93a127416578e5bbdffd38a8504f211155f0542107ecfa1d) | 71533 |
| 2026-09-12 | Sepolia | contribute round 0 member 2 (final vault) | [0x02b511aa…1dd204](https://sepolia.etherscan.io/tx/0x02b511aa9ead2c612d06ac13861ad4f09a33874738a573a22df3bcc6cf1dd204) | 71533 |
| 2026-09-12 | Creditcoin CC3 Testnet | deploy KittyLedger (final) | [0x21994599…7ac7f5](https://creditcoin-testnet.blockscout.com/tx/0x2199459939956219c713c4fe59c800713798e4bd922312d5a0a93a50fd7ac7f5) | 4901416 |
| 2026-09-12 | Creditcoin CC3 Testnet | recordContributions round 0: the whole round, batch of 3, verified by 0x0FD2 in one call | [0xac2a637f…652fe9](https://creditcoin-testnet.blockscout.com/tx/0xac2a637fb248dfc8b74801b8ec993be4d7c3831d083774ef261e84cdb9652fe9) | 888573 |
| 2026-09-12 | Creditcoin CC3 Testnet | closeRound 0 (everyone paid; rotation by score) | [0x53cbb51d…277bbb](https://creditcoin-testnet.blockscout.com/tx/0x53cbb51ddf2337bae79f33870d591a72aefcf8ca930e9edda5a12ac882277bbb) | 354326 |
| 2026-09-12 | Sepolia | payout round 0 (300 tUSD to member 0) | [0xfee30618…7263c3](https://sepolia.etherscan.io/tx/0xfee3061882b31b7adc8603fd3bdec728b9c777a5760b11ec346ed0e2b87263c3) | 64821 |
| 2026-09-12 | Creditcoin CC3 Testnet | confirmPayout round 0 (payout proven back through 0x0FD2) | [0x92344d88…74ba88](https://creditcoin-testnet.blockscout.com/tx/0x92344d886c25f2e14a573f9934407797f0379bdd100bda4e5a5101000174ba88) | 386582 |
| 2026-09-12 | Sepolia | contribute round 1 member 0 (member 2 deliberately misses) | [0x54803275…479df5](https://sepolia.etherscan.io/tx/0x5480327554235a64c7fbfe2ef1d4c791ce6aa33e89c3ff597aa825b0cf479df5) | 85845 |
| 2026-09-12 | Sepolia | contribute round 1 member 1 (member 2 deliberately misses) | [0xfec5afb1…6371e6](https://sepolia.etherscan.io/tx/0xfec5afb1855d0cfb4a48402ce5808227c5ce3c5b0ce37018298e84d1c66371e6) | 51645 |
| 2026-09-12 | Creditcoin CC3 Testnet | recordContributions round 1 (batch of 2, verified by 0x0FD2) | [0xb860377b…7f8280](https://creditcoin-testnet.blockscout.com/tx/0xb860377be38597044b4722248519fb6639accbcb9d2ad5c788180f45d97f8280) | 451052 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle 2 (Lagos Susu, 5 members, 50 tUSD, 300 blocks, fixed rotation) | [0x119949b0…7f281d](https://creditcoin-testnet.blockscout.com/tx/0x119949b06b99aa60f40a3adb2e2296058430d382d8cfddf4d1c2063ba57f281d) | 433672 |
| 2026-09-12 | Creditcoin CC3 Testnet | createCircle 3 (Oaxaca Tanda, 3 members, 100 tUSD, 250 blocks, by score) | [0xf007881f…e6047a](https://creditcoin-testnet.blockscout.com/tx/0xf007881f59c4d98b78ff445336c9afb18c472a1b9e8c1ad2f02f99f27ce6047a) | 357602 |
| 2026-09-12 | Sepolia | contribute circle 2 round 0 member 0 | [0x1730eb67…0694d1](https://sepolia.etherscan.io/tx/0x1730eb67770129c645d6b79e203ca934c93670c07043043a048e5e69ff0694d1) | 88645 |
| 2026-09-12 | Sepolia | contribute circle 2 round 0 member 1 | [0xb837410f…3318cb](https://sepolia.etherscan.io/tx/0xb837410f063a400461621ac63af2b197ea6399ab67b7a05be99add108e3318cb) | 71545 |
| 2026-09-12 | Sepolia | contribute circle 2 round 0 member 2 | [0x4b510ad8…7c16bc](https://sepolia.etherscan.io/tx/0x4b510ad8c6c166141e3204bf2fcb941c7b86c0b76cbfee5ae7d0d0b7fc7c16bc) | 71545 |
| 2026-09-12 | Sepolia | contribute circle 2 round 0 member 3 | [0xa45e44be…69b3b0](https://sepolia.etherscan.io/tx/0xa45e44bea9082d85eaf5c8157c6fa72719495d56211e2d806108ea0db969b3b0) | 71545 |
| 2026-09-12 | Sepolia | contribute circle 2 round 0 member 4 | [0x4e610ac0…b716f3](https://sepolia.etherscan.io/tx/0x4e610ac0eccd579385eeba7b62294865c383e4dcffa1c222089fb61787b716f3) | 71545 |
| 2026-09-12 | Sepolia | contribute circle 3 round 0 member 0 | [0x725e9813…09f32e](https://sepolia.etherscan.io/tx/0x725e9813fe4057a36c43e7db050bd5bd672069a0c91f1b03426063b6d809f32e) | 88633 |
| 2026-09-12 | Sepolia | contribute circle 3 round 0 member 1 | [0xa66ca7cd…c8eeab](https://sepolia.etherscan.io/tx/0xa66ca7cdc46973d25e6bede4fb8f9fa3b72e2d2fa8262a2555cf6d48e9c8eeab) | 71533 |
| 2026-09-12 | Sepolia | contribute circle 3 round 0 member 2 | [0x00592a40…61395c](https://sepolia.etherscan.io/tx/0x00592a405cd75036864f18c52c8e47d958b0f9c89afe1153a99607da7d61395c) | 71533 |
| 2026-09-12 | Creditcoin CC3 Testnet | recordContributions: 8 payments from circles 2 and 3 pooled into ONE precompile call (cross-circle batch) | [0xa7310f00…c1f7fa](https://creditcoin-testnet.blockscout.com/tx/0xa7310f0081f8e3254b3ba511526196e8bf34cdb5d203f481fb05636815c1f7fa) | 1936724 |
| 2026-09-12 | Creditcoin CC3 Testnet | closeRound circle 2 round 0 (everyone paid; fixed rotation) | [0x168cbbc3…1bd31d](https://creditcoin-testnet.blockscout.com/tx/0x168cbbc381819405747d397c8c30799bcb8940c7c95b3e88168f4a2bb11bd31d) | 354326 |
| 2026-09-12 | Creditcoin CC3 Testnet | closeRound circle 3 round 0 (everyone paid; by score) | [0x02f3489f…355541](https://creditcoin-testnet.blockscout.com/tx/0x02f3489f9730d8500256fbf08f2bfe31a086a0c671a82bb4a9f3420f0b355541) | 354326 |
| 2026-09-12 | Sepolia | payout circle 3 round 0 (300 tUSD) | [0x364b223a…4d0bfb](https://sepolia.etherscan.io/tx/0x364b223a91ec1f03843b10ecddfc6e987ded8db5ecc9c5c6a60ed9f5fe4d0bfb) | 69621 |
| 2026-09-12 | Sepolia | payout circle 2 round 0 (250 tUSD) | [0x19eb4a2c…72e0e2](https://sepolia.etherscan.io/tx/0x19eb4a2c2957fb5cce5811477b5d86aa7ae2d81be3ca4337799e48b2de72e0e2) | 69633 |
| 2026-09-12 | Creditcoin CC3 Testnet | confirmPayout circle 3 round 0 (proven back through 0x0FD2) | [0x0dac06f0…f94277](https://creditcoin-testnet.blockscout.com/tx/0x0dac06f03c45057a7bbe3936bcd6ef3dd23207dff0e8baf2174100fd4af94277) | 383894 |
| 2026-09-12 | Creditcoin CC3 Testnet | confirmPayout circle 2 round 0 (proven back through 0x0FD2) | [0x156b8935…7e5205](https://creditcoin-testnet.blockscout.com/tx/0x156b8935c70f8abf2a1560f89d21b92112b38dbf7cb5199f338433e8117e5205) | 384342 |

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
