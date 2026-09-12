# Kitty documentation

An index of everything under `docs/`, one line each. Start with the technical note, then the specification, then the threat model; the rest are reference material, records and plans.

## Technical

| Document | Description |
|---|---|
| [`TECH.md`](TECH.md) | The technical note: a payment is a record, the nineteen checks that turn a Sepolia payment into Creditcoin state, the attestation clock, rotation, the score, the steward's three layers, the batch policy, measured gas, Attestcoin coverage, limits. |
| [`specs/PROTOCOL.md`](specs/PROTOCOL.md) | The formal specification: data model, Circle and Round state machines, every external function of `KittyLedger` and `KittyVault` with access, preconditions, effects, events and errors, the event and error catalogues, query-id derivation, 21 numbered invariants with their tests. |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Assets, actors, trust assumptions, a threat table with the exact mitigating check and the test or scenario that demonstrates it, the eight attack scenarios mapped to threats, known limits. |
| [`AUDIT_CHECKLIST.md`](AUDIT_CHECKLIST.md) | A reviewer's checklist by contract and worker component, each item pointing at the function or line and the covering test, with coverage gaps and a findings log. |
| [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) | The integration write-up required by the hackathon: environment, the readability pipeline step by step, files and precompile functions used, gas, why not `ASCBase`, testing without the network. |
| [`GAS.md`](GAS.md) | Contract gas measured in Foundry per operation, kept apart from the live precompile figures. |

## Decisions

| Document | Description |
|---|---|
| [`adr/0001-attestation-as-the-only-clock.md`](adr/0001-attestation-as-the-only-clock.md) | Why deadlines are Sepolia block heights, why `is_height_attested` is the only clock, and why the grace window is a 64-block constant. |
| [`adr/0002-money-and-rules-on-different-chains.md`](adr/0002-money-and-rules-on-different-chains.md) | Why the vault is dumb and the ledger acts only on proofs; the bounded operator; what writability changes. |
| [`adr/0003-batch-proofs-and-the-roundmate-hold.md`](adr/0003-batch-proofs-and-the-roundmate-hold.md) | Why up to ten payments share one continuity proof, the batch policy's constants and priorities, and the hold rule that came from the first testnet round. |
| [`adr/0004-consent-grace-and-fallback-recipient.md`](adr/0004-consent-grace-and-fallback-recipient.md) | Who can be marked missed, how a round with missing payments closes, and where the pot goes when nobody qualifies. |
| [`adr/0005-one-vault-per-ledger.md`](adr/0005-one-vault-per-ledger.md) | Why a ledger redeploy is paired with a fresh vault and why a payment cannot predate its circle. |

## Operating and using

| Document | Description |
|---|---|
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook: prerequisites, every `.env` and worker variable, `scripts/deploy.sh` and `FORCE_REDEPLOY`, seeding, the worker's loop and state files, the lab API routes, recording the lab, `txlog`, recovery procedures, local world scripts, CI, GitHub Pages. |
| [`USER_SCENARIOS.md`](USER_SCENARIOS.md) | Every dashboard flow for visitors, members, organisers, lenders and reviewers, with preconditions, steps, the UI states rendered and the on-chain effects. |
| [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) | The recording-day script for the testnet demo, segment by segment. |
| [`TELEGRAM.md`](TELEGRAM.md) | The Telegram bot and Mini App: setup with BotFather, commands, event pushes and reminders. |

## Records

| Document | Description |
|---|---|
| [`TESTNET_LOG.md`](TESTNET_LOG.md) | Every testnet transaction with explorer link and gas, in order, plus the live precompile verifications and the Sepolia deployments. |
| [`SUBMISSION.md`](SUBMISSION.md) | The DoraHacks submission fields: description, Attestcoin usage, links, team. |
| [`audit-round-1.json`](audit-round-1.json), [`audit-round-2.json`](audit-round-2.json) | The two pre-submission audit plans and their findings. |
| [`Kitty-deck.pdf`](Kitty-deck.pdf) | The deck, printed from `/presentation`. |
| [`assets/`](assets/) | Banner, architecture diagram, screenshots and demo GIFs used by the README. |

## Plans

| Document | Description |
|---|---|
| [`STRATEGY.md`](STRATEGY.md) | The hackathon strategy: track, judging criteria, what wins. |
| [`MASTER_PLAN.md`](MASTER_PLAN.md) | The build-to-win plan with sources and licenses for every borrowed idea. |
| [`BUILD_PLAN.md`](BUILD_PLAN.md) | The original architecture and build order. |
| [`AGENT_PLAN.md`](AGENT_PLAN.md) | The v2 plan: Attestcoin depth track, the three-layer steward, the three agent-safety scenarios, and their status. |
