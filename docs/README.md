# Kitty documentation

An index of everything under `docs/`, one line each. Start with the architecture overview and the glossary, then the technical note, the specification and the threat model; the rest are reference material, records and plans.

## Technical

| Document | Description |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The top-level architecture: component diagram with the trust boundary, deployment diagram with the keys each process holds, and sequence diagrams with walkthroughs for proving (steward and browser), a deadline close with a miss, payout and proof-back, circle creation with invites and consent, the replay rejection, and a Telegram push. |
| [`GLOSSARY.md`](GLOSSARY.md) | Every term a reviewer meets, from circle and round to query id, preflight, proof-back, writability and local world, with one or two precise sentences and a link to where it lives. |
| [`PILLARS.md`](PILLARS.md) | The five evaluation pillars answered with evidence. |
| [`TECH.md`](TECH.md) | The technical note: a payment is a record, the nineteen checks that turn a Sepolia payment into Creditcoin state, the attestation clock, rotation, the score, the steward's three layers, the batch policy, measured gas, Attestcoin coverage, limits. |
| [`specs/PROTOCOL.md`](specs/PROTOCOL.md) | The formal specification: data model, Circle and Round state machines, every external function of `KittyLedger` and `KittyVault` with access, preconditions, effects, events and errors, the event and error catalogues, query-id derivation, 21 numbered invariants with their tests. |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Assets, actors, trust assumptions, a threat table with the exact mitigating check and the test or scenario that demonstrates it, the eight attack scenarios mapped to threats, known limits. |
| [`AUDIT_CHECKLIST.md`](AUDIT_CHECKLIST.md) | A reviewer's checklist by contract and worker component, each item pointing at the function or line and the covering test, with coverage gaps and a findings log. |
| [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) | The integration write-up required by the hackathon: environment, the readability pipeline step by step, files and precompile functions used, gas, why not `ASCBase`, testing without the network. |
| [`SLITHER.md`](SLITHER.md) | Static analysis run and the triage of every finding. |
| [`GAS.md`](GAS.md) | Contract gas measured in Foundry per operation, kept apart from the live precompile figures. |

## Reference

| Document | Description |
|---|---|
| [`reference/CONTRACTS.md`](reference/CONTRACTS.md) | Contract reference: every contract's purpose, inheritance, constructor and immutables, constants, storage with its writers, each external function with access, preconditions, exact reverts, effects, events and measured gas, the internal helper algorithms step by step, `IChainInfo` struct layouts, and what the two mocks emulate. |
| [`reference/STORAGE_LAYOUT.md`](reference/STORAGE_LAYOUT.md) | Storage layout from `forge inspect` for `KittyLedger`, `KittyVault` and `KittyCreditLine` as slot tables, struct packing, the mapping key derivations that matter to the protocol, and the runtime-size and upgrade constraints. |
| [`TESTING.md`](TESTING.md) | Test architecture: precompile mocks etched at `0x0FD2`/`0x0FD3`, `TxFixtures` encoding, the real-prover-bytes fixture, every suite with its test count, the invariant handler, attacker and ghost state with each invariant stated, fuzz bounds, gas methodology, worker and bot tests, scenario scripts, CI, and recipes for adding tests. |
| [`reference/STEWARD.md`](reference/STEWARD.md) | The worker in depth: process model and the tick loop, `scanSource`, every quarantine rule with its log line, the batch policy with constants, reason ladder, roundmate hold and worked examples, proof building and the single-proof fallback, preflight and the gas floor, every submission path including batch `confirmPayouts` and its transient-failure rule, the decision log per kind, the citation validator, the explain contract, recovery mechanisms, every environment variable. |
| [`reference/DATA_FORMATS.md`](reference/DATA_FORMATS.md) | Schemas as tables, with a committed example each: worker state, the steward decision log and the dashboard samples, the lab recordings, the two proof bundles, `deployments.json`, the web `VITE_*` keys, demo member keys, bot state, and the Proof Builder responses behind `BatchProof`. |
| [`reference/LAB_API.md`](reference/LAB_API.md) | Every route of the lab API with request, response and the SSE wire format, the error table, the eight scenarios step by step with the ledger check that rejects each, `pnpm scenario` and `pnpm lab:record` (`LAB_RECORD_OUT`, `LAB_ONLY`, testnet mode), and how the Lab and Steward pages consume the API and the recordings. |
| [`reference/BOT.md`](reference/BOT.md) | The Telegram bot: modules, live, dry-run, simulate and once modes, every command and its exact reply, the event watcher and its cursor, chunked `getLogs`, the reminder rule, state persistence, the Mini App button, every environment variable, and each message format with real output. |
| [`reference/WEB.md`](reference/WEB.md) | The dashboard in depth: stack, chunking and build sizes, every `VITE_*` variable and the env-file selection, routes and pages with their hooks, the hooks reference with contracts, functions and intervals, the browser proving flow step by step, create, invite and join, the components catalogue, the 3D system and its budgets, the story timeline API, the guided tour, the Telegram Mini App, accessibility and reduced motion, GitHub Pages deployment. |

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
| [`TELEGRAM.md`](TELEGRAM.md) | The Telegram bot and Mini App: setup with BotFather, commands, event pushes and reminders. |

## Records

| Document | Description |
|---|---|
| [`TESTNET_LOG.md`](TESTNET_LOG.md) | Every testnet transaction with explorer link and gas, in order, plus the live precompile verifications and the Sepolia deployments. |
| [`SUBMISSION.md`](SUBMISSION.md) | The DoraHacks submission fields: description, Attestcoin usage, links, team. |
| [`Kitty-deck.pdf`](Kitty-deck.pdf) | The deck, printed from `/presentation`. |
| [`assets/`](assets/) | Banner, architecture diagram, screenshots and demo GIFs used by the README. |

## Plans

| Document | Description |
|---|---|
