# Demo runbook (testnet, recording day)

Total wall time ≈ 25 minutes because of two attestation waits (~8 min each). Record in segments.

## T−30 min · prepare
```bash
cd ~/projects/kitty
cast balance --ether $DEPLOYER_ADDRESS --rpc-url $SEPOLIA_RPC_URL      # ≥ 0.03 ETH
cast balance --ether $DEPLOYER_ADDRESS --rpc-url $CREDITCOIN_RPC_URL   # ≥ 0.01 tCTC
scripts/deploy.sh                                                      # only if KittyLedger not yet in .env
pnpm demo fund --members 3                                             # 0.004 ETH + 1,000 tUSD each
pnpm demo create --name "Lagos Susu" --members 3 --amount 100 --round-blocks 60
```
Open three terminals: A `pnpm worker`, B `pnpm lab:api`, C for demo commands. Browser: `pnpm web:dev` → http://localhost:5173 with MetaMask holding demo member 0's key (`worker/demo-members.local.json`) on Sepolia + Creditcoin Testnet.

## Segment 1 · problem + circle (0:00–0:35)
Dashboard `/circle/1`. Point at: round 1 of 3, installment, deadline as a Sepolia block, the "Sepolia → attested" lag in the header.

## Segment 2 · pay (0:35–0:50)
In the browser as member 0: **Contribute 100 tUSD** → MetaMask (Sepolia) → success modal shows the tx and "proof pending". In terminal C: `pnpm demo contribute --skip 0` so members 1 and 2 pay too.

## Segment 3 · prove (cut the wait) (0:50–1:20)
Terminal A shows: three Contributed events, "waiting for Sepolia block N to be attested…", then "requesting batch proof for 3 tx(s)", then `✓ verified by 0x0FD2 in one call`. Dashboard proof feed: `BatchVerified` row + three green rows. Alternative for the video: click **Prove 3 payments in one call** in the Prove panel from a wallet with tCTC — it does the same from the browser.

## Segment 4 · close + payout + proof-back (1:20–1:35)
Worker: `closeRound — everyone paid`, `KittyVault.payout … on Sepolia`, `✓ payout proven`. Rotation panel: round 0 → Paid.

## Segment 5 · a missed payment (1:35–2:00)
```bash
pnpm demo contribute --skip 2
```
Show pending member 2 and "N blocks until the deadline is attested". Cut. When attested, worker: `closeRound — deadline block attested`, feed: `Missed: 0x… did not pay round 1`. `/score/<member2>`: 395, tier D, red row.

## Segment 6 · attack lab (2:00–2:15)
`/lab`: Run **Replay** → `QueryAlreadyProcessed`. Run **Fake vault** → `WrongEmitter`. (Others optional.)

## Segment 7 · the score is used (2:15–2:30)
`/borrow` as member 0: tier C after two on-time rounds → limit 20% of 200 tUSD = 40 kUSD; Borrow 40. `/score/<member0>`: claim the badge, show the SVG. Close on the tagline.

## Log every tx
```bash
pnpm txlog sepolia <hash> "member 0 contribute r0"
pnpm txlog creditcoin <hash> "recordContributions batch of 3"
```
