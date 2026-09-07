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
