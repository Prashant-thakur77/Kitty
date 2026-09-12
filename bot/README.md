# Kitty Telegram bot

A Telegram bot and Mini App entry point for Kitty, in the spirit of CrediKye's Telegram ROSCA, but with nothing to trust: every reply is a view call on `KittyLedger`, `KittyViewer` or `KittyCreditLine`, every push is a ledger event with its Creditcoin transaction and Attestcoin query id, and the deadline reminder is driven by the attested frontier from the ChainInfo precompile (`0x0FD3.get_latest_attestation_height_and_hash`). The bot holds no key.

| Command | What it does |
|---|---|
| `/start` | Kitty in three lines, the dashboard link, and an **Open Kitty** Mini App button |
| `/circle 1` | Live circle state: round, deadline block vs attested frontier, who is proven / pending / missed with scores, pot, next recipient, explorer links |
| `/score 0x…` | Kitty Score, tier, on-time / late / missed / received counters, proven volume, the credit limit from `KittyCreditLine.underwrite`, and the member's circles |
| `/watch 0x…` · `/watch circle 1` | Subscribe this chat to a member or a circle |
| `/unwatch [target]` · `/list` | Manage subscriptions |
| `/steward` | The last five decisions from the steward's log (`STEWARD_LOG_FILE`, the same file the worker writes) |

Pushes, one message per ledger event, to every chat watching the member or the circle: `ContributionRecorded`, `ContributionMissed`, `BatchVerified`, `RoundClosed`, `RoundOpened`, `PayoutConfirmed` (plus `CircleCreated`, `CircleCompleted`, `InviteRedeemed`). The wording is the dashboard feed's (`web/src/hooks.ts describe()`). A **deadline reminder** goes out once per round when a watched member has not paid and the attested frontier is within `BOT_REMINDER_BLOCKS` (40) of the deadline.

## Run

```bash
pnpm bot                                   # live: needs BOT_TOKEN in .env
pnpm bot:dry                               # no token: watches the ledger and prints what it would send
KITTY_ENV_FILE=worker/.env.world pnpm bot:dry --once            # one tick against the local world
BOT_SIMULATE="/circle 1; /score 0x…" pnpm bot:dry               # answer commands on stdout and exit (CI, demo)
BOT_WATCH="circle 1; 0x…" pnpm bot:dry                          # seed a dry-run subscription
pnpm test:bot                              # message formatting, no network
```

Configuration is the worker's (`.env`, overlaid by `KITTY_ENV_FILE`): `CREDITCOIN_RPC_URL`, `KITTY_LEDGER_ADDRESS`, `KITTY_VIEWER_ADDRESS`, `KITTY_CREDIT_ADDRESS`, `SOURCE_CHAIN_KEY`, `LEDGER_DEPLOY_BLOCK`, `STEWARD_LOG_FILE`, `KITTY_MODE`. Bot-specific:

| Variable | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | — | From @BotFather. Unset = dry run |
| `BOT_WEBAPP_URL` | `https://prashant-thakur77.github.io/Kitty/` | The Mini App / dashboard URL |
| `BOT_URL` | `https://t.me/KittyCirclesBot` | Shown in logs |
| `BOT_POLL_MS` | `15000` | Event poll interval |
| `BOT_LOOKBACK_BLOCKS` | `2000` (testnet) · all (local) | Blocks scanned on the first start; `all` = from `LEDGER_DEPLOY_BLOCK` |
| `BOT_REMINDER_BLOCKS` | `40` | Reminder window before the deadline, in attested Sepolia blocks |
| `BOT_STATE_FILE` | `bot/state.json` | Subscriptions, event cursor, sent reminders (gitignored) |
| `CREDITCOIN_EXPLORER` · `SEPOLIA_EXPLORER` | Blockscout · Etherscan | Link targets; a local world gets bare hashes |

Setup with @BotFather, the Mini App registration and Docker are in [`docs/TELEGRAM.md`](../docs/TELEGRAM.md).

## Layout

| File | |
|---|---|
| `src/bot.ts` | Commands, the event watcher, the reminder, grammY wiring, dry-run and simulate modes |
| `src/chain.ts` | Read-only chain access: circle state, scores, the ledger event scan, `pickRecipient` (mirrors `KittyLedger._pickRecipient`) |
| `src/format.ts` | Pure message formatting (Telegram HTML) |
| `src/state.ts` | `bot/state.json` |
| `src/config.ts` | Reuses `worker/src/config.ts` |
| `test/format.test.ts` | `pnpm test:bot` |
| `Dockerfile` | `docker build -f bot/Dockerfile -t kitty-bot .` |
