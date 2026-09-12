# Kitty User Scenarios

Every flow a person can take through Kitty, with preconditions, steps, the UI states they will see and the on-chain effects. UI states were read from the running dashboard (`web/src/pages/*.tsx`, `web/src/components/*.tsx`) against a local world and from the live testnet build; the labels quoted below are the ones the pages render.

Roles:

| Role | Who | Where they act |
|---|---|---|
| Visitor | anyone with a browser | every page, read-only |
| Member | a wallet listed in a circle | `/circle/:id` (pay, prove, re-verify, close), `/score`, `/borrow` |
| Organiser | the wallet that created a circle | the command line and `cast`; the dashboard has no organiser forms |
| Lender | anyone reading a score | `/score/:address`, `/borrow?address=…` |
| Reviewer or judge | anyone | `/steward`, `/lab`, `/architecture`, `/presentation` |

Round numbering: the pages show rounds as `1 … n`; contracts, logs and the proof feed use the 0-based index, shown as a trailing `rN` chip.

## Contents

- [A. Common](#a-common)
- [B. Member](#b-member)
- [C. Organiser](#c-organiser)
- [D. Lender](#d-lender)
- [E. Reviewer](#e-reviewer)
- [F. Presentation](#f-presentation)
- [G. Edge cases](#g-edge-cases)

## A. Common

### A-1. First visit, no wallet

Preconditions: no injected wallet (`window.ethereum` undefined), or the wallet extension is absent.

What the visitor sees:

- Navigation `Kitty · Circles · Score · Borrow · Steward · Attack lab · Architecture · Present`, an attestation pill `Sepolia <head> → attested <height> lag <n>` (from `useAttestation`: the Sepolia block number and `get_latest_attestation_height_and_hash` on `0x0FD3`, refreshed every 8 s), and the pill `no wallet · read-only` where the Connect button would be.
- Landing: the hero `Savings circles where every payment is proven, not promised.`, the pill `Attack lab open · 8 scenarios, 0 exploits`, buttons `Open a live circle`, `Try to cheat it`, `Source`, a marquee of the latest ledger events, four counters (`Payments proven`, `On time`, `Missed`, `tUSD settled`) computed from ledger events, the four-step "How a round settles", the trust table, and the score formula card.

Every page works read-only: circles, scores, the steward log, the lab and the deck need no wallet. Actions that sign are disabled or hidden.

Failure states: if `VITE_KITTY_LEDGER_ADDRESS` is empty, an amber banner reads `KittyLedger is not configured yet` under the nav and pages show `Ledger not deployed yet`.

### A-2. Connect a wallet

Preconditions: an injected EVM wallet (MetaMask or similar).

1. Click `Connect` (top right on desktop; in the sheet opened by the menu button on phones).
2. Approve in the wallet.

Result: the button becomes the short address (`0x7099…79C8`) and acts as disconnect; member-only controls appear on circle pages where the address is listed. If the wallet rejects, an amber error with the wallet's short message appears next to the button.

### A-3. Wrong network

Kitty uses two chains. Every action switches for you before signing:

- Paying and minting demo tUSD call `switchChainAsync({ chainId: sepolia.id })` (11155111).
- Proving, closing a round, claiming a badge, borrowing and repaying switch to Creditcoin CC3 Testnet (102031).

If the chain is missing from the wallet, the wallet prompts to add it (`wagmi` `defineChain` with `rpcUrls` and `blockExplorers` for Creditcoin). If the switch is rejected the action stops and the page shows the wallet's first error line in amber.

### A-4. Transaction feedback

Sepolia payment: a modal (`Confirm payment`, then `Payment sent` with `Broadcast` turning into `Mined` and an Etherscan link). Creditcoin actions on the circle page print a one-line status in amber (`closeRound sent on Creditcoin · 0x…`) and refetch after 5 s. Proving uses a stepper and a toast (B-3). Borrow and repay use toasts (`Borrowing`, `Borrowed`, `Transaction failed`).

## B. Member

### B-1. Find and view a circle

1. `/circles` lists every circle from `circleCount` and `getCircle`, newest last, as cards: name, `active` or `completed`, members, installment, `round k / n`, `settles from Ethereum Sepolia` (`chainName(chainKey)`), and a live strip with `pot`, `deadline block` and a chip: `<n> blocks to go` (deadline minus attested height), `deadline attested`, or `completed`. Skeletons while loading; `No circles yet` with a pointer to `pnpm demo create` when the ledger is empty.
2. Click a card to open `/circle/:id`.

The circle page (`CirclePage`):

- Header: `#id · name`, tags `active`/`completed`, `round k of n`, the chain name, and `open for invites · m/max` while invites are open.
- The urgency band: `ROUND k OF n · CONTRIBUTION`, a headline chosen from the member's own state, and a sub line. Observed headlines: `0 OF 3 PROVEN` with `1170 Sepolia blocks until the deadline is attested` for a visitor; `PAY 100 tUSD` for a listed member who has not paid; `PAID · PROOF PENDING` after a Sepolia payment; `PROVEN · BLOCK <h>` after the proof; `EVERYONE PAID`; `DEADLINE ATTESTED` with `The deadline plus the 64-block grace window is attested on Creditcoin. Anyone can close the round; missing members are recorded.`; `CIRCLE COMPLETE`. Between the deadline and the close height the sub line reads `Deadline passed; payments now count as late. <n> blocks of grace before the round can close.`
- The block bar: 48 ticks (24 on phones) from `opens · block <start>` to `deadline · block <deadline>`, coloured attested, mined-not-attested, head, deadline.
- Stats: `Installment`, `Pot this round`, `Proven x / n`, `Deadline · Sepolia block` with a sub line from `get_attestation_bounds`: `deadline attested · covering block <h>` or `latest attested <h> · waiting for <deadline>`.
- Rotation wheel: `Rotation · by Kitty Score` (`best record first`) or `Rotation · fixed order`, with the pot and the arrow to the leading or scheduled recipient, and a legend (`proven on time`, `proven late`, `paid · proof pending`, `missed`, `receives this round`, `already received`).
- Members: one row per member with a blockie, a link to `/score/<address>`, `leading this round` or `receives this round`, `you`, a five-cell spark of on-time/late/missed history, a `re-verify` button once proven, a status tag (`pending`, `pending · past deadline`, `proven · on time @ <h>`, `proven · late @ <h>`, `missed`) and the score `515 (C)`.
- Round history: a timeline of `n` rounds with `show as list` (`round k rN → recipient`, pot, `Paid`/`Closed`/`Open`/`upcoming`), and the sentence explaining early close, attested close and proof-back.
- The Prove panel (B-3) while the round is open, then the proof feed: every ledger event for the circle, newest first, each with the Creditcoin block, transaction and, for contributions, the query id.

Failure states: `Circle #999 not found.` for an unknown id; `Loading circle #1 from Creditcoin…` while reading.

### B-2. Pay an installment

Preconditions: connected wallet is listed in the circle; the circle is `active` with invites closed; tUSD balance at least the installment (a `Get demo tUSD` button mints 1,000 tUSD from `TestUSD.mint` when the balance is short).

1. Click `Contribute 100 tUSD` in the band. The modal `Confirm payment` shows `Round k of n installment`, the amount, `Pays into KittyVault · Sepolia`, `Proven on Creditcoin via 0x0FD2`, `Deadline block <h>`, `Your balance`, and the note that the worker proves it after attestation (about 8 minutes).
2. Click `Pay 100 tUSD`. The page switches the wallet to Sepolia; if the vault's allowance is below the installment it first sends `approve(vault, MaxUint256)` (`Approving tUSD… (waiting for it to mine)`), then `KittyVault.contribute(circleId, currentRound, contribution)`.
3. The modal becomes `Payment sent`: `Broadcast`, then `Mined`, with the Etherscan link, `Proof pending · attested head <h>` and the block the attestor must reach.

On-chain effects: `TestUSD.Approval` (once), `TestUSD.Transfer` to the vault, `KittyVault.Contributed(circleId, round, member, amount)`; `pot[circleId]` and `contributor[circleId][member]` on the vault. Nothing on Creditcoin yet.

UI after: the band reads `PAID · PROOF PENDING`; the member row in the wheel shows `paid · proof pending`; the Prove panel lists the payment with `paid · block <h>` and `not attested yet · latest <h>` until `find_lowest_attested_after` says an attestation covers it, then `covered by attestation #<h>`.

Failure states: `This wallet is not a member.` for an unlisted address; the wallet's error line in amber on rejection; a wrong-amount payment made outside the dashboard is escrowed but never credited (the ledger's `WrongAmount`; the steward quarantines it and logs `ignoring wrong-amount payment`).

### B-3. Prove the round from the browser

Preconditions: at least one payment of exactly the installment for the current round is mined on Sepolia and covered by an attestation; any connected wallet with a little tCTC (it need not be a member: `Connect any wallet with a little tCTC.`).

The panel `Prove it yourself · no operator needed` with the tag `Proof Builder → 0x0FD2` lists every unproven member with `paid · block <h>` plus the attestation tag, or `no payment on Sepolia yet`. The stepper has four steps: `Attested`, `Proof fetched`, `Preflight ok`, `Verified on Creditcoin`. Step 1 is already complete when an attestation covers at least one payment; while payments are mined but uncovered it shows `Attesting…` in amber and the button reads `Waiting for attestation of Sepolia block <h> (attested <a>, lag <n>)` with the note that the attestor network attests roughly every 8 minutes. With nothing pending the button reads `Nothing to prove yet`.

1. Click `Prove <k> payment(s) in one call` (at most 10).
2. The log panel prints, in order: `checking Proof Builder attested height…`, `attested height <a>; highest payment block <h>`, `requesting ONE batch proof for <k> payment(s)…`, `proof received · continuity roots <r> · heights …` (step 2 done), `preflight: asking 0x0FD2 whether this batch verifies…`, `✓ 0x0FD2 preflight passed`, `simulating KittyLedger.recordContributions…`, `✓ ledger simulation passed` (step 3 done), `submitting recordContributions from 0x… on Creditcoin…`, `sent · <hash> · waiting for the receipt…`, `✓ mined · status success · block <b> · <explorer link>` (step 4 done). The toast follows the same stages and ends with `Verified on Creditcoin`.
3. The page refetches; proven members turn `proven · on time @ <h>`; the proof feed gains `0x0FD2 verified <k> tx in ONE call · Sepolia blocks a–b` and one `Proven: …` row per payment with its query id.

On-chain effects: `KittyLedger.recordContributions` from the member's wallet; `BatchVerified`, `ContributionRecorded` per payment, `MembershipAccepted` for a first-time payer; `Round.contributions`, `Round.pot`, the member's `Contribution` and `MemberRecord` (`onTime` or `late`, `volume`).

Failure states, each stopping before any gas is spent: `✗ 0x0FD2 says this batch would not verify — nothing submitted, no gas spent` (step 2 marked failed, toast `Preflight failed`); `✗ 0x0FD2 preflight failed: <precompile reason>`; `✗ ledger would reject: <Error(args)> — nothing submitted` (toast `Ledger would reject`), for example `NotCurrentRound(1, 0)` or `QueryAlreadyProcessed(0x…)`; `Could not fetch the proof` when the Proof Builder errors; `Reverted on chain` with the explorer link if the transaction mines with status 0.

### B-4. Re-verify a proven payment

Preconditions: the member row shows `proven` and a Sepolia payment exists for that member.

1. Click `re-verify` on the row. The dialog `Re-verify this payment now` names the member and links the Sepolia transaction.
2. Click `Ask 0x0FD2`. Lines: `fetching proof for 0x… from the Attestcoin Proof Builder`, `proof: Sepolia block <h> · <s> Merkle siblings · <r> continuity roots`, `0x0FD2.calculateTxIndex = <i>`, `0x0FD2.verify(chainKey 1, height <h>) = true`, and `tampered bytes → rejected: <reason>` after flipping the last byte of the prover bytes.

On-chain effects: none; `verify` and `calculateTxIndex` are views. A `true` answer turns the panel border mint. On a local world the mocked verifier accepts everything, so the tampered line reads `tampered bytes: accepted (!)`; on testnet it reads `Merkle proof validation failed`.

### B-5. Close a round from the browser

Preconditions: the round is `Open` and either everyone is proven or the sub line says the deadline plus grace is attested; a connected wallet with tCTC.

1. Click `Close round on Creditcoin` in the band. The wallet switches to Creditcoin and signs `closeRound(circleId)`.
2. The band prints `closeRound sent on Creditcoin · 0x…`; after 5 s the page refetches: the round history shows `Closed` (or `Paid` later), the wheel's `receives this round` becomes `already received`, and the proof feed gains `Round k closed → 0x… receives <pot> tUSD (<m> missed)`, one `Missed: …` line per consented non-payer with `proven by attestation @ <h> 0x…`, and `Round k+1 open · pay by Sepolia block <h>` or `Circle completed`.

On-chain effects: `RoundClosed`, `ContributionMissed` per miss, `RoundOpened` or `CircleCompleted`, possibly `PotCarriedOver` or `FallbackRecipient`; `currentRound` advances; `receivedPot` and `MemberRecord.received`/`missed`.

Failure: `RoundStillOpenOnSource(<closeHeight>)` if the attested frontier is short (the button does not appear in that state, but a stale page can hit it).

### B-6. See the payout land

Preconditions: the round is `Closed` with a recipient and the steward is running with the operator key.

The steward calls `KittyVault.payout` on Sepolia and then `confirmPayout` on Creditcoin. The round history moves from `Closed` (amber) to `Paid` (mint) and the proof feed gains `Payout proven: 0x… received <pot> tUSD on Ethereum`. On `/score/<recipient>` the history shows `received pot` and `payout proven`. Nothing shows `Paid` before `PayoutConfirmed` exists.

## C. Organiser

The dashboard has no organiser forms; circle creation, rotation and invites are driven from the repository with `pnpm demo` and `cast`, and observed on the dashboard.

### C-1. Create a circle with a member list

Preconditions: `.env` with `PRIVATE_KEY` (the organiser), the ledger and vault addresses; the deployer holds tCTC; the vault is trusted on the ledger for the chain key.

```bash
pnpm demo create --name "Delhi Chit Circle" --members 3 --amount 100 --round-blocks 200 [--rotation score]
```

`demo.ts` calls `createCircle(name, members, amount * 1e6, roundBlocks, sourceHead + 1, vault)`, prints the members and `round 0 deadline: Sepolia block <h>`, and with `--rotation score` follows with `setRotation(id, 1)`. Members are the generated demo wallets (`worker/demo-members.local.json`), funded with `pnpm demo fund`.

On-chain effects: `CircleCreated`, `CircleChainSet`, `RoundOpened(id, 0, deadline)`, and `RotationSet` if chosen. Listed members are not yet consented.

Dashboard: the circle appears on `/circles` and `/circle/<id>` with `round 1 of n`, every member `pending`, and the wheel labelled `Rotation · fixed order` or `Rotation · by Kitty Score`.

Failure states (from `_initCircle` and `_createCircle`): `InvalidCircle("2..10 members")`, `InvalidCircle("duplicate/zero member")`, `InvalidCircle("contribution")`, `InvalidCircle("roundBlocks")`, `UnsupportedSourceChain`, `VaultNotTrusted`, `InvalidCircle("height range")`, `InvalidCircle("round 0 already attested")` when `startHeight + roundBlocks` is not beyond the attested frontier.

### C-2. Create an open circle and invite members

Preconditions: as C-1. The organiser's wallet becomes the first member with consent.

1. `cast send $KITTY_LEDGER_ADDRESS "createOpenCircle(string,uint256,uint64,uint64,address,uint32)" "<name>" <amount> <roundBlocks> <startHeight> $KITTY_VAULT_ADDRESS <maxMembers> --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY`.
2. For each invitee, compute `inviteDigest(circleId, invitee, nonce)` (`cast call … "inviteDigest(uint256,address,uint256)(bytes32)"`), sign that 32-byte digest without re-hashing (`cast wallet sign --no-hash <digest> --private-key <organiser key>`; the digest already carries the EIP-191 prefix, exactly as `vm.sign(pk, ledger.inviteDigest(…))` in `test/KittyInvites.t.sol`), and hand the signature and nonce to the invitee.
3. The invitee sends `redeemInvite(circleId, nonce, sig)` from their own wallet. Effects: `InviteRedeemed`, `MembershipAccepted`.
4. When the list is complete, the organiser sends `closeInvites(circleId)`; until then no contribution can be recorded (`CircleStillOpen`), and the steward leaves the circle's payments pending with `skip <id>:<round>: ledger is on round 0 (invites still open)`.

Dashboard: the header tag `open for invites · m/max` while open; the members list grows as invites are redeemed; after `closeInvites` the tag disappears and paying works.

Failure states: `CircleNotOpen`, `InviteAlreadyUsed`, `AlreadyMember`, `CircleFull`, `CircleStillOpen` (round 0 already has a proof), `InvalidInviteSigner(got, want)`, `NotOrganiser`, `InvitesAlreadyClosed`, `InvalidCircle("2..10 members")` on closing with one member.

### C-3. Choose the rotation

`setRotation(circleId, 0 | 1)` from the organiser, only while round 0 is open with no proof; afterwards `RotationLocked`. The demo driver's `--rotation score` does this at creation. The wheel title and the `best record first` tag reflect the mode; in a by-score circle the members list marks `leading this round` on the current best-scoring payer who has not received, and the round history says `by score at close` for future rounds.

### C-4. Consent for listed members

A member listed by `createCircle` may call `acceptMembership(circleId)` to opt in before paying; otherwise the first proven payment is the consent. Until one of these, a deadline close never marks them missed and the circle does not appear in their `getMemberCircles`.

## D. Lender

### D-1. Look up a score

1. Open `/score`, paste an address in `0x… member address`, click `Look up` (`Not an address` in amber for malformed input), or open `/score/<address>` directly, or connect a wallet to see your own.
2. The page renders: the ring with the score and tier (`515 tier C`, `300 – 850`, D/C/B/A bands at 500/600/700), `500 base · +15 on time · −20 late · −120 missed · clamped 300–850`; `Score breakdown · getRecord(address)` with `On time`, `Late`, `Missed`, `Pots received` and `Proven volume <v> tUSD across <n> proven payments`; `Score over time · replayed from ledger events` as a sparkline ending at the live `creditScore` (or `No proven payments or attested misses yet, so the score sits at the 500 base.`); `Lender view · readable by any Creditcoin contract` with the JSON `{member, score, tier, onTime, late, missed, received, volume_tUSD, source}`; the badge card (D-2); and `History · every entry is a proof or an attested deadline` as a table of `on time`/`late`/`missed`/`received pot`/`payout proven` rows with circle and round, the Sepolia block (or `deadline <h>` plus an `attested @ <h>` pill whose title carries the attestation hash for a miss) and the Creditcoin transaction link.

An address with no history reads `500`, `tier C`, zeros, and `No proven activity for this address yet.`

On-chain: reads only (`creditScore`, `getRecord`, ledger events from `VITE_LEDGER_DEPLOY_BLOCK`).

### D-2. Claim and view the badge

Preconditions: the connected wallet is the address being viewed and has at least one proven installment or miss.

1. In `Kitty Score badge · soulbound, live-rendered from the ledger` (`ERC-5192`), click `Claim badge`. The wallet switches to Creditcoin and signs `KittyBadge.claim()`.
2. `Claimed · 0x…` appears; after 5 s the card refetches `tokenURI(uint160(address))` and shows the SVG (`KITTY SCORE`, the number, `TIER X`, the counters, the address).

On-chain effects: `Transfer(0, member, tokenId)`, `Locked(tokenId)`. Failure: `NoProvenHistory(member)` without history, `AlreadyClaimed(member)` on a second claim. Viewing someone else's claimed badge shows the image with no button; an unclaimed badge on another address shows `No badge yet…` with no button. The card is hidden when `VITE_KITTY_BADGE_ADDRESS` is empty.

### D-3. Underwrite and borrow

1. Open `/borrow`. With no wallet and no address the page underwrites a member of the latest circle as a demonstration: the scheduled recipient for a fixed-rotation circle, the first member for a by-score circle (`read-only lookup · latest circle's recipient`). Paste any address and click `Underwrite` to read `underwrite(address)` for it (`read-only lookup`), or connect a wallet (`your wallet`).
2. `Underwriting · read live from KittyLedger` shows the tag `tier C · limit 20 kUSD`, stats `Score 515 (C)`, `Credit limit`, `Outstanding`, `Available`, and the reason string from the contract: `tier C: 20% of 100 tUSD proven volume`, `tier D: no credit (1 missed, 0 late)`, `no proven history yet: contribute to a circle on Ethereum and let the proof land`, or `…, capped at 5000 kUSD`.
3. `Pool` shows `<n> kUSD deposited` (share units) and `your kUSD balance`, `flat 5% fee added to what you owe`. Enter an amount and click `Borrow` (enabled only for the connected wallet, an amount above 0 and at most `Available`). The wallet switches to Creditcoin and signs `borrow(amount)`; the toast goes `Borrowing` to `Borrowed · <amount> · 0x…`; stats refetch after 5 s with `Outstanding` = amount plus 5%.

On-chain effects: `Borrowed(member, amount, fee, outstanding)`, `KittyUSD.Transfer` to the member. Failures surface as `Transaction failed` with the first error line: `ExceedsCreditLimit(requested, available)`, `InsufficientLiquidity`, `ZeroAmount`.

### D-4. Repay

Preconditions: `Outstanding` above 0; kUSD balance.

1. Enter an amount, click `Repay`. If the allowance is short the toast shows `Approving kUSD` and signs `approve(credit, MaxUint256)` first, then `repay(amount)` (over-repayment is clamped by the contract).
2. Toast `Repaid · <amount> · 0x…`; `Outstanding` falls, `Available` rises.

On-chain: `Repaid(member, amount, outstanding)`. Failure: `NothingToRepay` when nothing is owed (the button is disabled in that case).

### D-5. Export and re-check a proof bundle

1. On `/score/<address>` click `Proof bundle` (enabled once a score has been read). The browser downloads `kitty-receipts-<address prefix>.json` containing `member`, `issuedAt`, `score`, `tier`, `record`, the ledger address, chain id and RPC, the source chain key, vault and RPC, both precompile addresses, a `howToVerify` list, and one entry per history row with `event`, `text`, `circleId`, `round`, `queryId`, `creditcoinTx`, `creditcoinBlock`.
2. From the repository, `pnpm receipts <address> receipts.json` produces the same bundle with the source transaction attached to every `ContributionRecorded` row.
3. Re-check any row with `pnpm verify:live <sourceTx>`: the proof is fetched again and the live `0x0FD2` answers `verify = true`, and the tampered-bytes and wrong-chain negatives revert. Or click `re-verify` on the circle page (B-4).

## E. Reviewer

### E-1. Read the steward's decision log

`/steward`. With a lab API reachable (`VITE_LAB_API`, dev default `http://localhost:8790`) the header pill reads `live · localhost:8790 · mode local` and `Decisions · newest first` lists the last 20 entries from `GET /steward/log`. Without one (the hosted build) the pill reads `recorded on CC3 Testnet` and the list is the committed `web/src/data/steward.sample.json`, with explorer links on every hash.

Each entry: a kind tag (`prove`, `wait`, `close`, `payout`, `confirm` in mint or sky; `skip`, `error` in rose), the time, the summary sentence from `explainBatch` or the worker (`proving 3 payment(s) from 1 circle(s) on chain key 1 in one call: 1 round(s) complete, so proving now lets them close`, `waiting: 3 payment(s) not yet attested (frontier at source block 11687110)`, `closed circle 1 round 0 — every member proven`, `paid circle 1 round 0: 300 tUSD to 0x…`, `payout for circle 1 round 0 proven back to Creditcoin`), the evidence chips (`chainKey=1 queries=3 circles=1 attestedHeight=59 sourceHead=60 blocksOfSlack=633 roundsCompleted=1 blockSpan=16 leftBehind=0 waitedSeconds=0 stillWaitingForAttestation=0 preflight=passed queriesInCall=3 fromHeight=39 toHeight=55 continuityRoots=1`), and the transactions the decision produced (`creditcoin 0x…`, `source 0x…`).

Empty state: `No decisions logged yet` with a pointer to `pnpm worker` or `scripts/local-world.sh`.

### E-2. Ask the steward

Preconditions: a live lab API. Hosted builds show the recorded question `why did you prove one payment alone?` and the recorded answer instead of a form.

1. In `Ask the steward · Layer 3`, type a question (default `Why did you prove one payment alone?`) and click `Ask`. `POST /steward/explain` runs `explain()` over the last 12 decisions.
2. The answer card shows either `claude · cited` with the text, `verified citations` pills and, if anything was removed, `stripped before display` with each struck-through sentence and its reason (`unverifiable citation: 500000`, `uncited figure: 850`), or `deterministic · Layer 2` with the note `no ANTHROPIC_API_KEY on the API, or nothing survived the check` and the latest decision's summary verbatim.

On-chain: nothing. Failure: `lab api unreachable at … — start it with pnpm lab:api`.

### E-3. Run the attack lab live

Preconditions: a local world and `KITTY_ENV_FILE=worker/.env.world pnpm lab:api` (the API holds the operator key and is local-only).

`/lab` shows `mode local · source head <n> · attested <a>` and eight cards, each with a title, the explanation of the check, `expects <error or outcome>` and a `Run` button (`Run live (needs pnpm lab:api)` and disabled when offline; all buttons disabled while one runs; a second request returns `another scenario is still running`).

1. Click `Run` on a card. The log panel streams the scenario's lines over SSE, for example for `Replay a proven contribution`: `── Replay a proven contribution · expecting QueryAlreadyProcessed`, `replaying already-recorded contribution 0x…`, `proof: height <h> · 1 continuity root(s) — identical query id`, `✓ KittyLedger reverted: QueryAlreadyProcessed(0x…)` (the `staticCall` in `submitRecordContributions` surfaces the error before any transaction is sent), `PASS replay · expected QueryAlreadyProcessed · got QueryAlreadyProcessed(0x…)`.
2. The card border turns mint with `as expected · got <result>`, rose with `UNEXPECTED`, or amber with `not run yet · <reason>` when a scenario reports `skipped` (`late` before the deadline on testnet; `spoofEmitter` without `FAKE_VAULT_ADDRESS`; `fireTheAgent` when the round is already fully proven).

On-chain effects per scenario: `replay`, `wrongChain` none (reverts); `spoofEmitter` a `FakeVault.emitContributed` transaction on the source chain; `revertedTx` a funded fresh wallet and a status-0 `contribute`; `late` a real late `contribute` and its `ContributionRecorded onTime=false`; `stealFromSteward` gas sent to a fresh key on both chains and four reverted calls; `fireTheAgent` a member's `contribute`, gas to a stranger and the stranger's successful `recordContributions`; `poisonReasoning` none.

### E-4. Read the recorded lab

Without a lab API the page loads `lab-testnet.json` (preferred) or `lab-recorded.json` and shows the pill `recorded on Sepolia + CC3 Testnet · <date> · <commit>` or `recorded run · …`; every card carries the recorded lines and verdict, and on a testnet recording every `tx 0x…` in the lines is a link to Etherscan or Blockscout.

### E-5. Architecture page

`/architecture` shows the proof-flow scene (or its text fallback `Ethereum · KittyVault → 0x0FD2 · block prover → Creditcoin · KittyLedger ← 0x0FD3 · ChainInfo`), seven nodes (`Pay`, `Attest`, `Prove (batch)`, `Verify`, `Decode + bind`, `Clock`, `Score + payout proof`) each linking to the source file on GitHub, the `Why not inherit ASCBase?` note, and three cards listing the precompile functions and Proof Builder endpoints used.

## F. Presentation

`/presentation` is the deck: 12 slides (`1 / 12` in the corner) navigated with the on-screen arrows, `ArrowRight`, `Space`, `Enter`, `ArrowLeft` and `Backspace`; `Print → PDF` prints every slide (the committed `docs/Kitty-deck.pdf` was produced this way).

Slide 5, `The first circle, live`, reads circle 1 from whatever ledger the build points at: the rotation wheel, `Circles`, `Payments proven` with the on-time percentage, `Batch proofs` with the transaction count, `tUSD settled`, `Attested Sepolia block` from `0x0FD3`, and the ledger address linked to Blockscout. When the ledger is unreachable or empty it falls back to the testnet record and says so (`testnet record · 12 Sep 2026`). Slide 8 renders the steward's last three recorded decisions; slide 10 lists the first circle's transactions with gas and explorer links.

## G. Edge cases

| Situation | What the person sees | What to do |
|---|---|---|
| Payment made with the wrong amount outside the dashboard | Escrowed on Sepolia; the Prove panel does not list it (`payFor` only matches the exact installment); the steward logs `ignoring wrong-amount payment` | Pay again with the exact installment; the wrong payment stays in the vault (not refundable in this build) |
| Payment tagged with a future round | Pending on Sepolia; the steward logs `skip …: ledger is on round r` and keeps it for later | It is picked up once that round opens, if it is still the exact installment |
| Two payments by one member in a round | The second is a duplicate: `AlreadyContributed` on the ledger; the steward quarantines it | Nothing; only one counts |
| Payment mined after the deadline but before the close height | Proven as `proven · late @ <h>`, score minus 20 | Nothing; it counts toward the pot |
| Payment mined after the round closed | Never recorded: `NotCurrentRound` or `RoundNotOpen`; escrow stays | Not refundable in this build (`THREAT_MODEL.md`, limit 2) |
| Proof Builder unavailable | Prove panel: `Could not fetch the proof`; steward: `batch proof unavailable (…) — falling back to N single proof(s)` | Retry later; the steward retries every tick |
| RPC caps `eth_getLogs` | The proof feed retries a 2,000-block window; `useVaultPayments` walks back in 2,000-block windows; the worker scans 50 blocks at a time | Nothing |
| Stranger closes the round first | The steward logs `closeRound(id) failed: RoundNotOpen(…)` and moves on | Nothing; the outcome is identical |
| Steward key stolen | Every privileged call reverts (scenario `stealFromSteward`); the operator key is the one that matters (`THREAT_MODEL.md`) | Rotate the operator with `KittyVault.setOperator` (owner) |
| Wallet on the wrong chain | The action switches chains first | Approve the switch |
| Reduced-motion preference or no WebGL | Static wheel instead of the 3D hero; the flow scene shows its text fallback | Nothing |
