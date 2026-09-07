# Testnet transaction log

Every on-chain step of the live demo (Sepolia ↔ Creditcoin CC3 Testnet). Rows are appended with

```bash
pnpm txlog <sepolia|creditcoin> <txhash> "<action>"     # fetches the receipt, adds the explorer link + gas used
```

Explorers: Sepolia — https://sepolia.etherscan.io · Creditcoin CC3 Testnet — https://creditcoin-testnet.blockscout.com

Actions to expect, in order: `deploy TestUSD` · `deploy KittyVault` · `deploy KittyLedger` · `fund member N` ·
`createCircle` · `contribute round R member N` · `recordContributions round R (batch of N)` · `closeRound R` ·
`payout round R` · `confirmPayout round R` · attack-lab attempts (`replay`, `spoofEmitter`, `wrongChain`, `revertedTx`, `late`).

| date | chain | action | tx | gas used |
|---|---|---|---|---|

## Live precompile verification (no deployment needed)

2026-09-08 · Sepolia tx [`0xe3ef81c8…757b8d`](https://sepolia.etherscan.io/tx/0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d) (FakeVault deployment, block 11656295, index 44)
→ Proof Builder proof (7 Merkle siblings, 6 continuity roots) → `0x0FD2.verify` on CC3 Testnet = **true**; tampered bytes → "Merkle proof validation failed"; chainKey 3 → "Continuity proof does not match attestation or checkpoint". Command: `pnpm verify:live 0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d`.

## Sepolia deployments

| date | contract | address |
|---|---|---|
| 2026-09-08 | TestUSD | https://sepolia.etherscan.io/address/0xc6fe7fd411681E07a44523f87F6aB0805903c2dE |
| 2026-09-08 | KittyVault | https://sepolia.etherscan.io/address/0x15D30C27d0E26dCFFe06E76680F55A0A358cf63E |
| 2026-09-08 | FakeVault | https://sepolia.etherscan.io/address/0xf6f984c6aa6806a8afcc8713a2adea7fa05cf1fb |
