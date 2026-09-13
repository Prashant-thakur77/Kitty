# Kitty Architecture

The top-level view of the system: which components exist, where each one runs and what it holds, and how the main flows move across the two chains. Every diagram is followed by a short walkthrough with links to the code that implements it. The deeper references are [`TECH.md`](TECH.md) (the checks), [`specs/PROTOCOL.md`](specs/PROTOCOL.md) (the interface), [`THREAT_MODEL.md`](THREAT_MODEL.md), [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md), [`OPERATIONS.md`](OPERATIONS.md), and under [`reference/`](reference/): [`CONTRACTS.md`](reference/CONTRACTS.md), [`STORAGE_LAYOUT.md`](reference/STORAGE_LAYOUT.md), [`STEWARD.md`](reference/STEWARD.md), [`DATA_FORMATS.md`](reference/DATA_FORMATS.md), [`LAB_API.md`](reference/LAB_API.md), [`BOT.md`](reference/BOT.md) and [`WEB.md`](reference/WEB.md). Terms are defined in [`GLOSSARY.md`](GLOSSARY.md).

## Contents

- [Components and the trust boundary](#components-and-the-trust-boundary)
- [Deployment](#deployment)
- [Sequence: pay and prove, by the steward](#sequence-pay-and-prove-by-the-steward)
- [Sequence: prove from the browser, by a member](#sequence-prove-from-the-browser-by-a-member)
- [Sequence: a round closes on the attested deadline with a miss](#sequence-a-round-closes-on-the-attested-deadline-with-a-miss)
- [Sequence: payout and proof-back, single and batch](#sequence-payout-and-proof-back-single-and-batch)
- [Sequence: circle creation with invites and consent](#sequence-circle-creation-with-invites-and-consent)
- [Sequence: the attack lab replays a proof](#sequence-the-attack-lab-replays-a-proof)
- [Sequence: a Telegram push](#sequence-a-telegram-push)

## Components and the trust boundary

```mermaid
flowchart LR
  member["Member wallet"]
  organiser["Organiser wallet"]

  subgraph eth["Ethereum Sepolia, the source chain"]
    usd["TestUSD"]
    vault["KittyVault<br/>escrow, emits Contributed and PaidOut<br/>payout is operator-only and bounded"]
    fake["FakeVault<br/>attack-lab spoof emitter"]
  end

  subgraph att["Attestcoin Protocol"]
    attestors["Attestor network<br/>attests Sepolia blocks on Creditcoin"]
    pb["Proof Builder<br/>Merkle and continuity proofs"]
  end

  subgraph cc["Creditcoin CC3 Testnet"]
    subgraph tb["Trust boundary: verified by Creditcoin consensus"]
      fd2["0x0FD2 block prover<br/>verify, verifyAndEmit, calculateTxIndex"]
      fd3["0x0FD3 ChainInfo<br/>is_height_attested, bounds, registry"]
      ledger["KittyLedger, an ASC<br/>circles, rounds, records, Kitty Score"]
      credit["KittyCreditLine and KittyUSD"]
      badge["KittyBadge, ERC-5192"]
      viewer["KittyViewer"]
    end
  end

  subgraph off["Off-chain processes: no authority over the ledger"]
    steward["Steward, worker/<br/>holds the vault operator key"]
    labapi["Lab API, worker/src/api.ts<br/>local only"]
    bot["Telegram bot, bot/<br/>holds no chain key"]
    web["Dashboard, web/<br/>signs with the visitor's own wallet"]
    pages["GitHub Pages<br/>static host for web/dist"]
  end

  member -- "approve, contribute" --> vault
  vault -- "safeTransferFrom" --> usd
  attestors -- "attestations" --> fd3
  pb -- "reads blocks and receipts" --> eth

  steward -- "Contributed logs" --> vault
  steward -- "proof-batch-by-tx" --> pb
  steward -- "verify (view preflight)" --> fd2
  steward -- "recordContributions, closeRound, confirmPayout(s)" --> ledger
  steward -- "payout (operator)" --> vault

  ledger -- "verifyAndEmit, calculateTxIndex" --> fd2
  ledger -- "is_height_attested, find_lowest_attested_after,<br/>get_latest_attestation_height_and_hash, get_chain_by_key" --> fd3
  credit -- "creditScore, getRecord" --> ledger
  badge -- "creditScore, getRecord" --> ledger
  viewer -- "views" --> ledger

  web -- "reads and writes" --> ledger
  web -- "get_latest_attestation_height_and_hash,<br/>find_lowest_attested_after, get_attestation_bounds, get_supported_chains" --> fd3
  web -- "verify, calculateTxIndex (views)" --> fd2
  web -- "proof-batch-by-tx, proof-by-tx" --> pb
  web -- "contribute" --> vault
  organiser -- "createCircle, invites, closeInvites" --> web
  member -- "prove, accept, pay" --> web
  web -. "dev only" .-> labapi
  labapi -- "scenarios, decision log" --> steward
  bot -- "views and events" --> ledger
  bot -- "get_latest_attestation_height_and_hash" --> fd3
  pages -- "serves" --> web
```

The trust boundary is Creditcoin consensus. Inside it, `KittyLedger` ([`src/asc/KittyLedger.sol`](../src/asc/KittyLedger.sol)) changes money-related state only when the block-prover precompile at `0x0FD2` has verified a Sepolia transaction and the ChainInfo precompile at `0x0fD3` has confirmed an attested height; `KittyCreditLine`, `KittyBadge` and `KittyViewer` only read the ledger. Everything outside the boundary is either a source of proofs (the vault's events, the Proof Builder, the attestor network) or a caller whose identity the ledger never checks: `recordContributions`, `closeRound`, `confirmPayout` and `confirmPayouts` are callable by anyone, and the steward's Creditcoin key has no role on the ledger (the `fireTheAgent` and `stealFromSteward` scenarios in [`worker/src/scenarios.ts`](../worker/src/scenarios.ts) demonstrate both). The only privileged action in the system is on Sepolia: `KittyVault.payout` is `operator`-only, and [`src/source/KittyVault.sol`](../src/source/KittyVault.sol) bounds it to one payout per `(circleId, round)`, to the circle's own escrow, and to an address that has paid into that circle; the ledger then requires a proof of the resulting `PaidOut` before a round shows `Paid`. The ledger's `Ownable` owner curates only the per-chain vault allowlist (`setTrustedVault`). `FakeVault` ([`src/source/FakeVault.sol`](../src/source/FakeVault.sol)) exists to show that a byte-identical event from an untrusted emitter is rejected as `WrongEmitter`. The dashboard, the bot and GitHub Pages hold no key: the dashboard signs with whatever wallet the visitor connects, the bot only reads (see [`bot/src/config.ts`](../bot/src/config.ts)), and the lab API, which does hold the operator key, is reached by the dashboard only in development ([`web/src/config.ts`](../web/src/config.ts), `labApi`).

## Deployment

```mermaid
flowchart TB
  subgraph gh["GitHub"]
    actions["Actions: pages.yml<br/>pnpm build with VITE_BASE=/Kitty/, index.html copied to 404.html"]
    pages["GitHub Pages<br/>prashant-thakur77.github.io/Kitty/<br/>reads web/.env.production"]
    actions --> pages
  end

  subgraph client["Visitor's browser, or the Telegram Mini App"]
    web["web/ bundle<br/>keys: none, an injected wallet signs<br/>storage: localStorage for invites and the tour"]
  end

  subgraph host["Operator host, one machine"]
    steward["pnpm worker<br/>PRIVATE_KEY: vault operator on Sepolia, plain caller on Creditcoin<br/>state: worker/state.local.json, worker/steward.local.json"]
    labapi["pnpm lab:api, port 8790<br/>same PRIVATE_KEY, ANTHROPIC_API_KEY optional<br/>CORS *, no auth, never exposed"]
    bot["pnpm bot<br/>BOT_TOKEN only, no chain key<br/>state: bot/state.json"]
  end

  subgraph endpoints["Network endpoints"]
    sep["Sepolia RPC<br/>ethereum-sepolia-rpc.publicnode.com"]
    ccr["Creditcoin RPC<br/>rpc.cc3-testnet.creditcoin.network"]
    pb["Proof Builder<br/>prover.cc3-testnet.creditcoin.network"]
    tg["Telegram Bot API"]
  end

  pages -- "static files" --> web
  web -- "eth_call, eth_getLogs, eth_sendRawTransaction" --> sep
  web -- "eth_call, eth_getLogs, eth_sendRawTransaction" --> ccr
  web -- "GET attested-height, POST proof-batch-by-tx" --> pb
  web -. "dev only, VITE_LAB_API" .-> labapi
  steward -- "Contributed logs, payout" --> sep
  steward -- "reads, recordContributions, closeRound, confirmPayout(s)" --> ccr
  steward -- "usc-sdk ProofBuilder" --> pb
  labapi -- "scenarios" --> sep
  labapi -- "scenarios, status" --> ccr
  labapi -- "proofs" --> pb
  bot -- "views, getLogs, 0x0FD3" --> ccr
  bot -- "long polling, sendMessage" --> tg
```

The steward and the bot share one configuration module, [`worker/src/config.ts`](../worker/src/config.ts), which loads the root `.env` (and a `KITTY_ENV_FILE` overlay) and builds one `ethers.Wallet` from `PRIVATE_KEY` for both chains; the same key is the vault's `operator` on Sepolia (set at deploy time by [`scripts/deploy.sh`](../scripts/deploy.sh), `OPERATOR_ADDRESS` defaulting to the deployer) and an unprivileged caller on Creditcoin. The bot's [`config.ts`](../bot/src/config.ts) reuses that module for RPC URLs and the ChainInfo binding but takes only `BOT_TOKEN`; it never signs. The lab API ([`worker/src/api.ts`](../worker/src/api.ts)) is the same process family as the steward and holds the operator key because the attack scenarios send real transactions, which is why [`OPERATIONS.md`](OPERATIONS.md#the-lab-api-pnpm-labapi) says never to expose its port. The dashboard's RPC URLs, chain ids and contract addresses come from `VITE_*` variables ([`reference/WEB.md`](reference/WEB.md#configuration)); the hosted build is produced by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). Deployed addresses are in [`deployments.json`](../deployments.json); the local two-anvil world that replaces every endpoint above is described in [`OPERATIONS.md`](OPERATIONS.md#local-world-scripts).

## Sequence: pay and prove, by the steward

```mermaid
sequenceDiagram
  autonumber
  actor M as Member
  participant V as KittyVault (Sepolia)
  participant A as Attestor network
  participant S as Steward (worker.ts)
  participant P as Proof Builder
  participant FD3 as 0x0FD3 ChainInfo
  participant FD2 as 0x0FD2 block prover
  participant L as KittyLedger (Creditcoin)

  M->>V: approve, then contribute(circleId, round, amount)
  V-->>V: emit Contributed(circleId, round, member, amount)
  A->>FD3: attest the Sepolia block
  loop every WORKER_POLL_MS (10 s)
    S->>V: queryFilter Contributed, 50-block windows
    S->>L: getCircle, deadlineHeight, closeHeight, getContribution
    S->>FD3: get_latest_attestation_height_and_hash(chainKey)
    S-->>S: decideBatch(candidates, frontier): act or wait
  end
  S->>P: waitUntilHeightAttested, then getBatchProof(txHashes)
  P-->>S: txBytes[], merkleProofs[], one continuityProof
  S->>FD2: verify(batch) as a view (preflight)
  FD2-->>S: true
  S->>L: recordContributions(...) staticCall, then send
  L->>FD2: calculateTxIndex per proof (query ids), verifyAndEmit(batch)
  FD2-->>L: true
  L-->>L: per tx: decode receipt, bind emitter, to, from, amount, round, height
  L-->>L: emit ContributionRecorded x n, BatchVerified
  S-->>S: record decision {kind: prove, evidence, txs}
```

The member's side is an ordinary ERC-20 deposit: `KittyVault.contribute` ([`src/source/KittyVault.sol`](../src/source/KittyVault.sol)) pulls the tokens and emits `Contributed`; the vault performs no membership check on purpose. The steward's loop in [`worker/src/worker.ts`](../worker/src/worker.ts) runs `scanSource`, `flushBatches`, `closeRounds` and `payouts` every `WORKER_POLL_MS` (default 10,000 ms). `flushBatches` validates each pending payment against the ledger (unknown circle, wrong round, non-member, wrong amount, duplicate, already proven) before handing the survivors to `decideBatch` in [`worker/src/agent/policy.ts`](../worker/src/agent/policy.ts), which decides between acting and waiting from the attested frontier and each payment's slack before its grace window; the batch policy and the roundmate hold are described in [`TECH.md`](TECH.md#batch-policy) and [`adr/0003`](adr/0003-batch-proofs-and-the-roundmate-hold.md). Proof acquisition is [`worker/src/proofs.ts`](../worker/src/proofs.ts) through `@gluwa/usc-sdk`'s `ProofBuilder`; the free preflight is the precompile's `verify` view in [`worker/src/verifier.ts`](../worker/src/verifier.ts); submission in [`worker/src/chain.ts`](../worker/src/chain.ts) does a `staticCall` first so a custom error surfaces before gas is spent. On the ledger, `recordContributions` ([`KittyLedger.sol`](../src/asc/KittyLedger.sol), `_prepareBatch`, `_recordContribution`, `_singleLog`) derives the query ids, rejects replays and in-batch duplicates, calls `verifyAndEmit` once for the whole batch, then decodes each transaction with `EvmV1Decoder` and applies the checks listed step by step in [`TECH.md`](TECH.md#how-a-sepolia-payment-becomes-creditcoin-state). Every decision is appended to the decision log ([`worker/src/agent/log.ts`](../worker/src/agent/log.ts)) with the chain state it saw.

## Sequence: prove from the browser, by a member

```mermaid
sequenceDiagram
  autonumber
  actor M as Member (any wallet with tCTC)
  participant W as ProvePanel (web)
  participant FD3 as 0x0FD3 ChainInfo
  participant P as Proof Builder
  participant FD2 as 0x0FD2 block prover
  participant L as KittyLedger

  W->>FD3: find_lowest_attested_after(chainKey, paymentBlock) per pending payment
  FD3-->>W: {height, exists}, a payment is ready when exists
  M->>W: click "Prove N payments in one call"
  W->>P: GET /api/v1/attested-height/{chainKey}
  W->>P: POST /api/v1/proof-batch-by-tx/{chainKey} [txHashes]
  P-->>W: BatchArgs (heights, txBytes, merkleProofs, continuity)
  W->>FD2: readContract verify(...) (single or batch overload)
  alt precompile says no
    FD2-->>W: false or revert
    W-->>M: step "Preflight ok" fails, nothing submitted
  else precompile says yes
    W->>L: simulateContract recordContributions(...)
    alt ledger would revert
      L-->>W: ErrorName(args)
      W-->>M: "Ledger would reject", nothing submitted
    else simulation passes
      W->>L: estimateContractGas x 1.3 (floor 4,000,000), switchChain, writeContract
      L->>FD2: verifyAndEmit(batch)
      L-->>L: ContributionRecorded x n, BatchVerified
      W-->>M: receipt, step "Verified on Creditcoin", toast
    end
  end
```

The browser flow is the steward's flow without the steward. [`web/src/components/ProvePanel.tsx`](../web/src/components/ProvePanel.tsx) asks the ChainInfo precompile which attestation covers each payment (`useCoveringAttestations` in [`web/src/hooks.ts`](../web/src/hooks.ts)), fetches one batch proof for up to ten payments through [`web/src/lib/prover.ts`](../web/src/lib/prover.ts) (the Proof Builder serves CORS `*`), runs the same `verify` preflight against [`web/src/lib/verifier.ts`](../web/src/lib/verifier.ts)'s ABI, simulates the ledger call so a custom error is shown before the wallet is asked, and submits `recordContributions` from the member's own wallet. The ledger applies exactly the checks it applies to the steward; the submitter is irrelevant. Step-by-step detail, the stepper states and the toasts are in [`reference/WEB.md`](reference/WEB.md#the-proving-flow); the user-facing flow is [`USER_SCENARIOS.md`](USER_SCENARIOS.md#b-3-prove-the-round-from-the-browser).

## Sequence: a round closes on the attested deadline with a miss

```mermaid
sequenceDiagram
  autonumber
  participant A as Attestor network
  participant FD3 as 0x0FD3 ChainInfo
  participant S as Steward (or anyone)
  participant L as KittyLedger

  Note over L: deadline = startHeight + (round + 1) * roundBlocks<br/>closeAt = deadline + GRACE_BLOCKS (64)
  A->>FD3: attestations advance past closeAt
  S->>L: closeHeight(circleId, round)
  S->>FD3: is_height_attested(chainKey, closeAt)
  FD3-->>S: true
  S->>L: closeRound(circleId)
  L->>FD3: is_height_attested(chainKey, closeAt)
  FD3-->>L: true
  L->>FD3: find_lowest_attested_after(chainKey, closeAt)
  FD3-->>L: {height, hash} of the attestation that proved the deadline
  L-->>L: store attestedCloseHeight, attestedCloseHash on the Round
  loop each member without a proof
    alt accepted[circleId][member]
      L-->>L: records[member].missed += 1
      L-->>L: emit ContributionMissed(circleId, round, member, deadline, attestedHeight, attestedHash)
    else never consented
      L-->>L: no penalty
    end
  end
  L-->>L: _pickRecipient: a member who paid this round and has not received
  alt recipient found
    L-->>L: receivedPot = true, records.received += 1
  else nobody eligible, not the final round
    L-->>L: pot += to next round, emit PotCarriedOver
  else final round
    L-->>L: fallback to any member who paid, emit FallbackRecipient
  end
  L-->>L: emit RoundClosed(..., missedCount, attestedHeight), then RoundOpened or CircleCompleted
```

`closeRound` in [`KittyLedger.sol`](../src/asc/KittyLedger.sol) has two admissible situations: every member is proven, in which case it closes at once and `attestedCloseHeight` stays zero, or the close height `deadline + 64` is attested according to `0x0fD3`, otherwise it reverts `RoundStillOpenOnSource`. Wall-clock time and `block.timestamp` are never consulted; the reasoning is in [`adr/0001`](adr/0001-attestation-as-the-only-clock.md) and [`TECH.md`](TECH.md#the-attestation-clock). On the deadline path the ledger records which attestation proved the deadline and stamps it on every `ContributionMissed`, so a lender can re-check the miss against the precompile. Only consenting members are penalised (`accepted`, granted by organising, redeeming an invite, `acceptMembership`, or paying once), and the pot goes only to someone who paid this round; the carry-over and the final-round fallback are [`adr/0004`](adr/0004-consent-grace-and-fallback-recipient.md). The steward's `closeRounds` in [`worker/src/worker.ts`](../worker/src/worker.ts) reads `closeHeight` and `is_height_attested` before calling, and the circle page offers the same `closeRound` button to any wallet once the deadline plus grace is attested ([`web/src/pages/Circle.tsx`](../web/src/pages/Circle.tsx)).

## Sequence: payout and proof-back, single and batch

```mermaid
sequenceDiagram
  autonumber
  participant S as Steward (operator key)
  participant L as KittyLedger
  participant V as KittyVault (Sepolia)
  participant P as Proof Builder
  participant FD2 as 0x0FD2 block prover

  S->>L: getRound(id, r) for every circle: status Closed, recipient set
  S->>V: paidOut(id, r)? if not, payout(id, r, recipient, pot)
  V-->>V: checks: operator, not paid, amount > 0, pot covers it, recipient is a contributor
  V-->>V: transfer, emit PaidOut(circleId, round, recipient, amount)
  S-->>S: state.paid[id:r] = txHash (persisted before the proof-back)
  alt one payout waiting
    S->>P: getProof(payoutTx)
    S->>FD2: verify(single) preflight
    S->>L: confirmPayout(chainKey, height, txBytes, merkleProof, continuity)
    L->>FD2: calculateTxIndex, verifyAndEmit(single)
  else several payouts waiting (up to 10, possibly different circles)
    S->>P: getBatchProof(payoutTxs)
    S->>FD2: verify(batch) preflight
    S->>L: confirmPayouts(chainKey, heights, txBytes, merkleProofs, continuity)
    L->>FD2: calculateTxIndex per proof, verifyAndEmit(batch)
    L-->>L: emit BatchVerified
  end
  L-->>L: per PaidOut: emitter is the vault, round is Closed, recipient and amount match
  L-->>L: Round.status = Paid, payoutQueryId, emit PayoutConfirmed
```

The payout is the one action still delegated to an operator, and the proof-back is what keeps that operator honest: `_confirmPayout` in [`KittyLedger.sol`](../src/asc/KittyLedger.sol) decodes the `PaidOut` log, requires the emitter to be the circle's vault, the round to be `Closed`, and the recipient and amount to equal what `closeRound` decided (`PayoutMismatch` otherwise), then marks the round `Paid`. `confirmPayout` is the single-query overload, `confirmPayouts` the batch overload with the same `_prepareBatch` prologue as contributions. In [`worker/src/worker.ts`](../worker/src/worker.ts), `payouts()` sends `KittyVault.payout` and persists the hash in the state file before attempting the proof-back (so a crash between the two is recoverable, see [`OPERATIONS.md`](OPERATIONS.md#a-payout-was-sent-but-the-worker-lost-the-hash)); when more than one payout is waiting in the same tick it tries `confirmPayouts` under one continuity proof and falls back to singles if the Proof Builder cannot span them or the preflight rejects the batch. What Attestcoin writability would change here is in [`TECH.md`](TECH.md#what-writability-changes) and [`adr/0002`](adr/0002-money-and-rules-on-different-chains.md).

## Sequence: circle creation with invites and consent

```mermaid
sequenceDiagram
  autonumber
  actor O as Organiser wallet
  participant C as Create page / InvitePanel (web)
  participant FD3 as 0x0FD3 ChainInfo
  participant L as KittyLedger
  actor I as Invitee wallet
  participant J as Join page (web)

  C->>FD3: get_supported_chains()
  C->>L: trustedVault(chainKey, vault) per chain
  C->>FD3: get_latest_attestation_height_and_hash(chainKey)
  C-->>C: startHeight defaults to attested + 20, first deadline must exceed the frontier
  C->>L: simulateContract createOpenCircle(name, contribution, roundBlocks, startHeight, vault, maxMembers, chainKey)
  O->>L: createOpenCircle(...)
  L->>FD3: get_chain_by_key(chainKey), get_latest_attestation_height_and_hash(chainKey)
  L-->>L: organiser joins with consent, emit CircleCreated, CircleChainSet, RoundOpened(0)
  opt rotation by score
    O->>L: setRotation(circleId, ByScore) while round 0 has no proof
  end
  C-->>C: nonce = 32 random bytes, raw = keccak256(ledger, chainId, circleId, invitee, nonce)
  C->>L: inviteDigest(circleId, invitee, nonce) must equal hashMessage(raw)
  O->>C: personal_sign(raw), signer recovered must be the organiser
  C-->>I: link /join/{circleId}?invitee&nonce&sig (kept in localStorage only)
  I->>J: open the link
  J-->>J: recoverMessageAddress(raw, sig) == organiser
  J->>L: usedInviteNonces(circleId, nonce)
  J->>L: simulateContract redeemInvite(circleId, nonce, sig)
  I->>L: redeemInvite(circleId, nonce, sig)
  L-->>L: ECDSA.recover(inviteDigest) == organiser, nonce used, join with consent, emit InviteRedeemed
  O->>L: closeInvites(circleId) once at least two members are in
  Note over L: For a listed circle (createCircle) each member consents<br/>with acceptMembership or by paying once
```

Creation is one Creditcoin transaction; money never touches the ledger. `_initCircle` in [`KittyLedger.sol`](../src/asc/KittyLedger.sol) validates the chain key against the ChainInfo registry, requires the vault to be trusted for that chain, and refuses a circle whose round 0 would already be over on the attested frontier; the Create page ([`web/src/pages/Create.tsx`](../web/src/pages/Create.tsx)) mirrors these checks and simulates the call before the wallet is asked. Invites follow the pattern credited in the contract: the organiser signs, off chain, the EIP-191 digest of `keccak256(abi.encodePacked(ledger, chainid, circleId, invitee, nonce))`; the dashboard signs the inner 32-byte hash with `personal_sign` so the wallet's prefix produces exactly `inviteDigest` ([`web/src/lib/tx.ts`](../web/src/lib/tx.ts), [`web/src/components/InvitePanel.tsx`](../web/src/components/InvitePanel.tsx)), and `redeemInvite` recovers the signer with OpenZeppelin `ECDSA`, marks the `(circleId, nonce)` pair used and admits the caller as a consenting member. `closeInvites` fixes the member list before any contribution can be recorded (`CircleStillOpen` otherwise). Consent is what makes a miss recordable: [`adr/0004`](adr/0004-consent-grace-and-fallback-recipient.md); the flows from the user's side are [`USER_SCENARIOS.md`](USER_SCENARIOS.md#c-organiser).

## Sequence: the attack lab replays a proof

```mermaid
sequenceDiagram
  autonumber
  actor R as Reviewer
  participant W as Lab page (web)
  participant API as Lab API (api.ts)
  participant SC as scenarios.ts
  participant P as Proof Builder
  participant L as KittyLedger
  participant FD2 as 0x0FD2 block prover

  R->>W: click Run on "Replay a proven contribution"
  W->>API: POST /run/replay
  API-->>W: text/event-stream (event: start)
  API->>SC: runScenario("replay")
  SC-->>SC: firstRecordedTx() from the worker state
  SC->>P: buildBatchProof([tx])
  P-->>SC: the same proof the ledger already counted
  SC->>L: recordContributions(...) via submitRecordContributions
  L->>FD2: calculateTxIndex(merkleProof)
  FD2-->>L: txIndex
  L-->>L: queryId = keccak256(chainKey, height, txIndex), processedQueries[queryId] is true
  L-->>SC: revert QueryAlreadyProcessed(queryId), before verifyAndEmit is reached
  SC-->>API: {ok: true, expected: "QueryAlreadyProcessed", got: "QueryAlreadyProcessed(0x...)"}
  API-->>W: data: {"line": ...} per log line, then event: done
  W-->>R: card turns mint: "as expected"
```

The replay scenario in [`worker/src/scenarios.ts`](../worker/src/scenarios.ts) re-submits the batch proof of a contribution the ledger already counted. `_prepareBatch` in [`KittyLedger.sol`](../src/asc/KittyLedger.sol) computes each query id as `keccak256(chainKey ‖ height ‖ txIndex)` with `txIndex` from the precompile's `calculateTxIndex` (the same derivation as `ASCBase`, [`specs/PROTOCOL.md`](specs/PROTOCOL.md#10-query-id-derivation)), and reverts `QueryAlreadyProcessed` when the id is in `processedQueries` or appears twice in the batch; this happens before any gas reaches `verifyAndEmit`. `expectRevert` in the scenario file decodes the custom error and compares it with the expected name. The lab API ([`worker/src/api.ts`](../worker/src/api.ts)) streams the worker's log lines to the page as server-sent events; the page ([`web/src/pages/Lab.tsx`](../web/src/pages/Lab.tsx)) shows the recorded run from `web/public/lab-testnet.json` when no API is configured. The other seven scenarios and the threats they map to are in [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Sequence: a Telegram push

```mermaid
sequenceDiagram
  autonumber
  actor U as Chat member
  participant TG as Telegram Bot API
  participant B as Kitty bot (bot.ts)
  participant L as KittyLedger
  participant FD3 as 0x0FD3 ChainInfo

  U->>TG: /watch circle 1
  TG->>B: message (long polling)
  B-->>B: state.chats[chatId].circles += "1", save bot/state.json
  B->>TG: reply: watching circle 1, reminder at 40 attested blocks
  loop every BOT_POLL_MS (15 s)
    B->>L: eth_getLogs on the ledger from state.lastBlock + 1, 2,000-block windows
    L-->>B: ContributionRecorded, ContributionMissed, BatchVerified, RoundClosed, RoundOpened, PayoutConfirmed, CircleCreated, CircleCompleted, InviteRedeemed
    B-->>B: watchersOf(circleId, member), BatchVerified goes to every watching chat
    B->>L: getCircle(circleId) for the circle name
    B->>TG: sendMessage(chat, formatEvent(...), HTML) with the Creditcoin tx link
    B->>FD3: get_latest_attestation_height_and_hash(chainKey)
    B->>L: getMemberCircles(member), then the circle, round and contribution, per watched member
    opt member still pending and deadline - frontier <= BOT_REMINDER_BLOCKS, not yet reminded
      B->>TG: sendMessage(chat, formatReminder(...))
      B-->>B: state.reminded[circle:round:member] = true
    end
  end
```

The bot in [`bot/src/bot.ts`](../bot/src/bot.ts) is a reader. `/watch` records a member address or a circle id for the chat in `bot/state.json` ([`bot/src/state.ts`](../bot/src/state.ts)); every `BOT_POLL_MS` (default 15,000 ms) `tick` scans ledger logs from the last seen block ([`bot/src/chain.ts`](../bot/src/chain.ts), `scanEvents`), keeps the nine event names in `WATCHED_EVENTS` ([`bot/src/format.ts`](../bot/src/format.ts)), routes each to the chats watching that circle or member (`BatchVerified` carries no circle id and goes to every chat that watches anything), and sends the formatted line with its explorer link through grammy's `sendMessage`. `remind` then reads the attested frontier from `0x0fD3` and, for every watched member address (`/watch 0x…`, not circle subscriptions), walks `getMemberCircles` for open rounds where that member is still pending and sends one reminder per `(circle, round, member)` when the deadline is within `BOT_REMINDER_BLOCKS` (default 40) attested blocks. `/circle` and `/score` are view calls on `KittyLedger`, `KittyViewer` and `KittyCreditLine`; `/steward` reads the same decision log the dashboard shows. The Mini App button opens the hosted dashboard with `?tg=1`, which is what makes [`web/src/lib/telegram.ts`](../web/src/lib/telegram.ts) load the Telegram SDK. Setup is in [`TELEGRAM.md`](TELEGRAM.md); commands and formats in [`reference/BOT.md`](reference/BOT.md).
