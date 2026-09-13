# Telegram bot reference

The bot in `bot/` answers commands with view calls on `KittyLedger`, `KittyViewer` and `KittyCreditLine`, pushes every ledger event to the chats that watch the member or the circle it touches, and sends one deadline reminder per member and round driven by the attested frontier from the ChainInfo precompile. It holds no key. This document describes the code in `bot/src/{bot,chain,format,config,state}.ts` and the tests in `bot/test/format.test.ts`.

Setup with BotFather, the Mini App registration and Docker are in [`../TELEGRAM.md`](../TELEGRAM.md); the shorter overview is `bot/README.md`; the state file format is in [`DATA_FORMATS.md`](DATA_FORMATS.md#bot-state-botstatejson); the decision log the `/steward` command reads is described in [`STEWARD.md`](STEWARD.md#the-decision-log).

## Contents

- [Architecture](#architecture)
- [Modes: live, dry run, simulate, once](#modes-live-dry-run-simulate-once)
- [Commands](#commands)
- [The event watcher](#the-event-watcher)
- [The reminder rule](#the-reminder-rule)
- [State persistence](#state-persistence)
- [The Mini App button and menu](#the-mini-app-button-and-menu)
- [Environment variables](#environment-variables)
- [Message formats](#message-formats)

## Architecture

| File | Role |
|---|---|
| `bot/src/config.ts` | Imports `cfg`, `ccProvider`, `chainInfo` and `ROOT` from `worker/src/config.ts`, so the bot reads the same `.env` and `KITTY_ENV_FILE` overlay as the steward. Builds `botCfg`, three read-only `ethers.Contract`s (`ledger`, and `viewer` and `credit` when their addresses are set) and `ledgerInterface` for log parsing. `requireLedger()` throws `Set KITTY_LEDGER_ADDRESS (root .env, or KITTY_ENV_FILE=worker/.env.world for the local world)` when the address is empty. |
| `bot/src/state.ts` | `BotState` (`lastBlock`, `chats`, `reminded`), `loadState`, `saveState`, `subs(state, chatId)` (creates the chat's entry on demand), `watchersOf(state, circleId, members)`. |
| `bot/src/chain.ts` | `attestedFrontier()`, `readCircle(id)`, `pickRecipient(rows, round, rotation)`, `readScore(address)`, `scanEvents(from, to)`, `head()`, `circleName(id)` (cached), `memberPending(member)`. |
| `bot/src/format.ts` | Pure Telegram-HTML formatters and the `describe()` wording shared with the dashboard feed. Everything user-controlled passes through `esc()`. |
| `bot/src/bot.ts` | `handle()` (commands), `tick()` (watcher), `remind()`, the grammY transport, dry-run and simulate transports, `main()`. |

Message flow: an incoming text that starts with `/` is passed to `handle(state, chatId, chatType, text)`, which returns `{ text, openKitty? }`; the reply is sent with `parse_mode: 'HTML'`, link previews disabled, and an inline keyboard when `openKitty` is set. Pushes go through a `Send` function per transport.

## Modes: live, dry run, simulate, once

| Mode | Trigger | Behaviour |
|---|---|---|
| live | `BOT_TOKEN` set and `BOT_DRY_RUN` not `1` (`pnpm bot`) | `new Bot(BOT_TOKEN)` from grammY, long polling. Registers the command list and the menu button, runs one `tick`, then `setInterval(tick, BOT_POLL_MS)` and `bot.start()`. Startup line ends with `long-polling Telegram as <BOT_URL> · watching <ledger> every <s>s`. |
| dry run | no `BOT_TOKEN`, or `BOT_DRY_RUN=1` (`pnpm bot:dry`) | No Telegram. `send` logs `→ <chat>: (sent)` (plus ` + Open Kitty button` when applicable) and the watcher logs every event and reminder it would deliver with the full message text. Before the first tick, each `;`-separated target in `BOT_WATCH` is subscribed for the chat `"dry"` by running `/watch <target>` through `handle`, so the dry run has someone to deliver to. Then one tick, and unless `--once`, `setInterval(tick, BOT_POLL_MS)` with the line `watching <ledger> every <s>s · ctrl-c to stop`. |
| simulate | `BOT_SIMULATE="/cmd; /cmd"` | Runs each `;`-separated command through `handle` as chat `"sim"` with chat type `"sim"`, prints `> <command>` and the reply (and `[button: Open Kitty → <url>]` when the reply carries the button), then exits, unless `--once` is also given, in which case the dry-run or live path continues for one tick. |
| once | `--once` | One watcher tick, then exit (in live mode after registering commands and the menu button). |

The startup line in every mode: `kitty bot · DRY RUN (no BOT_TOKEN)|live · <mode> · ledger <address|unset> · <CREDITCOIN_RPC_URL>`.

Send failures in live mode are logged `send to <chat> failed: <message>`; if the message matches `/blocked|chat not found|kicked/i` the chat's subscriptions are deleted and the state saved. Errors thrown by grammY are logged `bot error: <message>`; an error inside `handle` is answered with `Something went wrong: <message>`. `errorText()` shortens ledger errors that contain `UnknownCircle` to that word and otherwise keeps the first line, cut to 120 characters.

## Commands

Parsing: the message is split on whitespace; the first token is lowercased and a trailing `@botname` is removed, so `/circle@KittyCirclesBot 1` works in groups; the rest is joined back into `argv`. A target for `/watch` and `/unwatch` is parsed by `parseTarget`: `circle N` (case-insensitive) or `#N` or a bare `N` names a circle; anything `ethers.isAddress` accepts names a member (stored checksummed); anything else is the error `Give a member address (0x…) or <code>circle N</code>.`

| Command | Reply |
|---|---|
| `/start`, `/help` | `formatStart(links)`; `openKitty` is true in private chats and in simulate mode, so the reply carries the Mini App button. |
| `/watch <target>` | No argument: `Usage: <code>/watch 0x…</code> or <code>/watch circle 1</code>`. Otherwise the target is added to the chat's `members` or `circles` (no duplicates; members compared case-insensitively), the state is saved, and the reply is `👀 Watching member <code>0x1234…abcd</code>.` or `👀 Watching circle N.` followed by ` Every proof, missed payment, close and payout lands here, plus a reminder when a deadline is <BOT_REMINDER_BLOCKS> attested blocks away.` |
| `/unwatch [target]` | No argument: clears both lists, `Stopped watching everything.` With a target: removes it, `Stopped watching <code>0x1234…abcd</code>.` or `Stopped watching circle N.` |
| `/list` | `Not watching anything. Try <code>/watch circle 1</code>.` or a list headed `👀 Watching` with one `• circle N · <name>` line per circle (the name from `getCircle`, escaped, omitted if the read fails) and one `• member <code>0x…</code>` line per member. |
| `/circle <id>` | `requireLedger()`. The argument with a leading `#` removed must be all digits, else `Usage: <code>/circle 1</code>`. Otherwise `formatCircle(readCircle(id))`; a read failure (an unknown circle reverts `UnknownCircle`) becomes `Circle <id> is not on this ledger (UnknownCircle).` |
| `/score <address>` | `requireLedger()`. A non-address argument: `Usage: <code>/score 0x…</code>`. Otherwise `formatScore(readScore(address))`. |
| `/steward` | `formatSteward(read(5))`: the last five entries of the worker's decision log, read directly from `worker/<STEWARD_LOG_FILE>` through `worker/src/agent/log.ts`. No ledger address is needed. |
| anything else starting with `/` | `Unknown command. ` followed by the `/start` text. |

Messages that do not start with `/` are ignored.

### What `/circle` reads (`readCircle`)

`getCircle(id)`, then in parallel `getRound(id, currentRound)`, `deadlineHeight`, `closeHeight`, the attested frontier, and per member `getContribution`, `creditScore` and `receivedPot`. A member's status is `proven` (query id set, `onTime`), `late` (query id set, not on time), `pending` (no query id, round `Open`) or `missed` (no query id, round not `Open`). `recipient` is set only once the round is closed. `nextRecipient` and `nextRecipientTentative` come from `pickRecipient`, which mirrors `KittyLedger._pickRecipient`: fixed rotation walks `members[(round + k) % n]` skipping members who received a pot and taking the first proven payer, falling back to the first pending member who has not received (tentative); by-score rotation takes the best `creditScore` among proven payers who have not received, with no tentative pick. `pnpm test:bot` asserts these cases.

### What `/score` reads (`readScore`)

`creditScore(address)` and `getRecord(address)` in parallel. If `KITTY_CREDIT_ADDRESS` is set, `KittyCreditLine.underwrite(address)` gives `credit.limit` and `credit.reason` (a failure leaves `credit` unset). Circles come from `KittyViewer.getMemberDashboard(address)` when `KITTY_VIEWER_ADDRESS` is set (status codes `0..3` mapped to `pending, proven, late, missed`), otherwise from `getMemberCircles(address)` and one `readCircle` per circle.

## The event watcher

`tick(state, send)` runs on start and every `BOT_POLL_MS`:

1. `to = ccProvider.getBlockNumber()`.
2. Cursor initialisation when `state.lastBlock` is 0: `deploy = min(LEDGER_DEPLOY_BLOCK, to)` (the deploy block is 0 in local mode); `lastBlock = max(deploy, to - BOT_LOOKBACK_BLOCKS)` when the lookback is finite, else `deploy`.
3. If `to > lastBlock`: `scanEvents(lastBlock + 1, to)`, deliver each event, set `lastBlock = to`, save.
4. `remind(state, send)`.

`scanEvents(from, to)` (`bot/src/chain.ts`) calls `ccProvider.getLogs({ address: ledger, fromBlock, toBlock })` in chunks of `MAX_RANGE = 2_000` blocks, because public RPCs cap `eth_getLogs` ranges, parses each log with `ledgerInterface.parseLog`, keeps the names in `WATCHED_EVENTS`, and returns `{ name, args, tx, block }` oldest first. `args` is keyed by the event's input names.

`WATCHED_EVENTS` is the key set of the icon table in `format.ts`: `ContributionRecorded`, `ContributionMissed`, `BatchVerified`, `RoundClosed`, `RoundOpened`, `PayoutConfirmed`, `CircleCreated`, `CircleCompleted`, `InviteRedeemed`.

Delivery: for each event, `who` is `[args.member, args.recipient, ...args.members]` filtered to strings and `circleId` is `String(args.circleId)` when present. `BatchVerified` carries no circle, so it goes to every chat that watches anything; every other event goes to `watchersOf(state, circleId, who)`: the chats whose `circles` include the circle id or whose `members` include (case-insensitively) any address in `who`. The text is `formatEvent(event, links, circleName)`. In dry run each event is logged `event <name> @ <block> → <chat ids|no watchers>` followed by the message.

A tick failure is logged `tick failed: <message>` and the next interval retries; the cursor is only advanced after a successful scan, so no block is skipped.

## The reminder rule

`remind(state, send)`, after every scan:

1. `frontier = attestedFrontier()`: `get_latest_attestation_height_and_hash(chainKey)` on `0x…0fD3`; if the call fails or `exists` is false, no reminders this tick.
2. Collect every watched member across all chats, keyed by lowercased address, with the list of chats watching them.
3. For each member, `memberPending(member)`: the member's circles (`getMemberCircles`) that are `Active` with an `Open` current round in which the member's status is `pending`. A read failure skips the member.
4. For each such circle, the key is `` `${circle.id}:${circle.currentRound}:${member}` ``. Skip if `state.reminded[key]` or if `circle.deadline - frontier.height > BOT_REMINDER_BLOCKS` (default 40). Otherwise send `formatReminder(...)` to each watching chat, set `reminded[key] = true` and save.

So a reminder fires at most once per member and round, only for members watched by address (watching a circle does not produce reminders), and only when the attested frontier, not the source head, is within 40 blocks of the deadline. Once the deadline is attested the same message says `deadline reached, 64-block grace running`.

## State persistence

`bot/state.json` (or `BOT_STATE_FILE`) is written on every subscription change, after every delivered scan, and after every reminder. Its fields are `lastBlock`, `chats` and `reminded`; deleting the file resets the cursor (the next start applies the lookback rule) and forgets subscriptions and sent reminders. Format in [`DATA_FORMATS.md`](DATA_FORMATS.md#bot-state-botstatejson).

## The Mini App button and menu

- Inline keyboard (`keyboard(chatType)`): one button `🐱 Open Kitty`. In a private chat it is a `web_app` button (`{ web_app: { url: BOT_WEBAPP_URL } }`), which opens the dashboard as a Telegram Mini App; in any other chat type it is a plain `url` button, because Telegram only allows `web_app` buttons in private chats. It is attached to replies that set `openKitty` (`/start`, `/help`); the `Send` type allows it on pushes too, but the watcher never sets it.
- Menu button: on start the live bot calls `setChatMenuButton({ menu_button: { type: 'web_app', text: 'Open Kitty', web_app: { url: BOT_WEBAPP_URL } } })`.
- Command list: `setMyCommands` registers `start`, `circle`, `score`, `watch`, `unwatch`, `list`, `steward` with one-line descriptions. Failures of either call are logged (`setMyCommands failed:`, `menu button failed:`) and ignored.

## Environment variables

Read in `bot/src/config.ts` and `bot/src/bot.ts`, in addition to the worker's `.env` (`CREDITCOIN_RPC_URL`, `KITTY_LEDGER_ADDRESS`, `SOURCE_CHAIN_KEY`, `KITTY_MODE`, `KITTY_ENV_FILE`, `STEWARD_LOG_FILE`; see [`STEWARD.md`](STEWARD.md#environment-variables)).

| Variable | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | empty | The BotFather token. Empty means dry run. |
| `BOT_DRY_RUN` | unset | `1` forces dry run even with a token (`pnpm bot:dry` sets it). |
| `BOT_SIMULATE` | unset | `;`-separated commands to answer on stdout, then exit. |
| `BOT_WATCH` | unset | `;`-separated `/watch` targets subscribed for chat `"dry"` before the first dry-run tick. |
| `BOT_WEBAPP_URL` | `https://prashant-thakur77.github.io/Kitty/?tg=1` | Mini App URL and the base of every dashboard link. |
| `BOT_URL` | `https://t.me/KittyCirclesBot` | Shown in the live startup line only. |
| `BOT_POLL_MS` | `15000` | Watcher interval. |
| `BOT_LOOKBACK_BLOCKS` | `2000` on testnet; `all` in local mode | Blocks scanned on the first start when the state has no cursor. `all` means from `LEDGER_DEPLOY_BLOCK` (0 locally). |
| `BOT_REMINDER_BLOCKS` | `40` | Reminder window before the deadline, in attested source blocks. |
| `BOT_STATE_FILE` | `bot/state.json` | Resolved against the repository root. |
| `LEDGER_DEPLOY_BLOCK` | `0` | Lower bound of the first scan on testnet; ignored in local mode. |
| `KITTY_VIEWER_ADDRESS` | empty | Enables `KittyViewer.getMemberDashboard` for `/score`. |
| `KITTY_CREDIT_ADDRESS` | empty | Enables `KittyCreditLine.underwrite` for `/score`. |
| `CREDITCOIN_EXPLORER` | `https://creditcoin-testnet.blockscout.com`; empty in local mode | Link base for Creditcoin transactions and addresses. Empty means bare `<code>` hashes. |
| `SEPOLIA_EXPLORER` | `https://sepolia.etherscan.io`; empty in local mode | Link base for source transactions and blocks. |

## Message formats

All output is Telegram HTML (`parse_mode: 'HTML'`). Helpers in `format.ts`:

| Helper | Output |
|---|---|
| `esc(v)` | `&`, `<`, `>` escaped. Applied to every circle name, tier, reason and error message. |
| `short(v)` | A 42-character `0x` address as `0x1234…abcd` (first 6, last 4); anything else unchanged. |
| `usd6(v)` | A 6-decimal amount as `Number(v) / 1e6` with `en-US` grouping (`100`, `1,000`). |
| `num(v)` | A number with `en-US` grouping (`1,229`). |
| `ccTx`, `srcTx` | `<a href="<explorer>/tx/<hash>">0x768a20ca…</a>` (first 10 characters), or `<code>0x768a20ca…</code>` when the explorer base is empty. |
| `ccAddr` | `<a href="<explorer>/address/<addr>">0x1234…abcd</a>` or `<code>…</code>`. |
| `srcBlock` | `<a href="<explorer>/block/<n>">1,229</a>` or `<code>1,229</code>`. |
| `circleUrl`, `scoreUrl` | `<webAppUrl>circle/<id>`, `<webAppUrl>score/<addr>`. |

Round labels are 1-indexed for people, with the on-chain index appended as `(rN)` in event lines, matching the dashboard feed (`web/src/hooks.ts describe()`).

The examples below are the formatters' actual output for the fixtures in `bot/test/format.test.ts` (testnet explorer links, `webAppUrl` `https://prashant-thakur77.github.io/Kitty/`).

### `describe(name, args)`: the one-line event wording

| Event | Line |
|---|---|
| `ContributionRecorded` | `Proven: 0x7099…79C8 paid 100 tUSD for round 1 at Sepolia block 39 (on time) (r0)`; with `onTime: false` the parenthesis reads `(LATE)` |
| `BatchVerified` | `0x0FD2 verified 3 tx in ONE call · Sepolia blocks 39–55` |
| `ContributionMissed` | `Missed: 0x3C44…93BC did not pay round 2 by attested block 1229 · proven by attestation @ 1293 0xabcdef01… (r1)`; without `attestedHeight` the attestation clause is omitted |
| `RoundClosed` | `Round 1 closed → 0x7099…79C8 receives 300 tUSD (1 missed) · attested @ 693 (r0)`; the `attested @` clause appears only when `attestedHeight > 0` |
| `RoundOpened` | `Round 2 open · pay by Sepolia block 1229 (r1)` |
| `PayoutConfirmed` | `Payout proven: 0x7099…79C8 received 300 tUSD on Ethereum` |
| `CircleCreated` | `Circle "Lagos Susu #1" created · 3 members · 100 tUSD/round` |
| `CircleCompleted` | `Circle completed — every member has received a pot` |
| `InviteRedeemed` | `0x7099…79C8 joined by invite` |
| other | the event name |

### `formatEvent`: a push

Line 1: `<icon> <b><describe()></b>` with the icon per event (`✅` recorded, `❌` missed, `🔏` batch, `🔒` closed, `🔔` opened, `💸` payout, `🐱` created, `🏁` completed, `🤝` invite). Line 2, when the event has a `circleId`: `Circle <id> · <name> · <a href="<circleUrl>">open</a>`. Line 3: proof links joined by ` · `: `Creditcoin tx <link>`, then `query id <code>0x1fbdce98…</code>` when a non-zero `queryId` is present, `Sepolia block <link>` when `sourceHeight` is present, `blocks <a>–<a>` for `BatchVerified`, `deadline <a>` for `RoundOpened`.

```
✅ <b>Proven: 0x7099…79C8 paid 100 tUSD for round 1 at Sepolia block 39 (on time) (r0)</b>
Circle 1 · Lagos Susu #1 · <a href="https://prashant-thakur77.github.io/Kitty/circle/1">open</a>
Creditcoin tx <a href="https://creditcoin-testnet.blockscout.com/tx/0x768a20ca…bbbad">0x768a20ca…</a> · query id <code>0x1fbdce98…</code> · Sepolia block <a href="https://sepolia.etherscan.io/block/39">39</a>
```

```
🔏 <b>0x0FD2 verified 3 tx in ONE call · Sepolia blocks 39–55</b>
Creditcoin tx <a href="https://creditcoin-testnet.blockscout.com/tx/0x768a20ca…bbbad">0x768a20ca…</a> · blocks <a href="https://sepolia.etherscan.io/block/39">39</a>–<a href="https://sepolia.etherscan.io/block/55">55</a>
```

In a local world (empty explorers) the same message reads `Creditcoin tx <code>0x768a20ca…</code> · blocks <code>39</code>–<code>55</code>`.

### `formatCircle`: the `/circle` reply

Structure: header `🐱 <b>Circle <id> · <name></b>` (plus ` · completed` when `status === 1`); the round line `Round <r+1> of <n> · Open|Closed|Paid · <paid>/<n> proven · pot <pot> tUSD · <contribution> tUSD each`; the clock line `Deadline Sepolia block <link> · ` followed by `attested frontier <n> · <k> blocks to go`, or `attested frontier <n> · deadline attested; closes once block <closeHeight> is attested`, or `attested frontier unknown`; a blank line; one line per member `<icon> <addr link> · proven @ <h> (on time)|proven @ <h> (late)|pending|missed · score <s> <tier>[ · received]` with icons `✅ 🕒 ⏳ ❌`; a blank line; the recipient line; the `Open in Kitty` link.

The recipient line is `Recipient: <addr> · payout proven back` (round `Paid`) or `· payout pending` (round `Closed`), else `Next recipient: <addr> · fixed order|by proven score`, `Next recipient (if they pay): <addr> · …` when tentative, or `Next recipient: decided at close · …` when nobody qualifies yet.

```
🐱 <b>Circle 1 · Lagos Susu #1</b>
Round 2 of 3 · Open · 1/3 proven · pot 100 tUSD · 100 tUSD each
Deadline Sepolia block <a href="https://sepolia.etherscan.io/block/1229">1,229</a> · attested frontier 1,200 · 29 blocks to go

⏳ <a href="https://creditcoin-testnet.blockscout.com/address/0x7099…79C8">0x7099…79C8</a> · pending · score 515 C · received
✅ <a href="https://creditcoin-testnet.blockscout.com/address/0x3C44…93BC">0x3C44…93BC</a> · proven @ 1,100 (on time) · score 530 C
⏳ <a href="https://creditcoin-testnet.blockscout.com/address/0x90F7…b906">0x90F7…b906</a> · pending · score 515 C

Next recipient: <a href="https://creditcoin-testnet.blockscout.com/address/0x3C44…93BC">0x3C44…93BC</a> · fixed order
<a href="https://prashant-thakur77.github.io/Kitty/circle/1">Open in Kitty</a>
```

### `formatScore`: the `/score` reply

```
🏅 <b>Kitty Score 530 · tier C</b> · <a href="https://creditcoin-testnet.blockscout.com/address/0x7099…79C8">0x7099…79C8</a>
2 on time · 0 late · 0 missed · 1 pots received · 200 tUSD proven volume
Credit limit 40 kUSD · tier C: 20% of 200 tUSD proven volume

✅ Circle 1 · Delhi Chit Circle · round 2 · proven
Every number above is derived only from proven transactions and attested deadlines.
<a href="https://prashant-thakur77.github.io/Kitty/score/0x7099797a5c8f7e7b3f2f2f2f2f2f2f2f2f2f79C8">Open in Kitty</a>
```

The `Credit limit` line appears only when `credit` was read; with no circles the list is replaced by `No circles yet.`

### `formatSteward`: the `/steward` reply

Header `🤖 <b>Kitty Steward · last decisions</b>`, then one line per decision, newest first as `read(5)` returns them: `<icon> <code>YYYY-MM-DD HH:MM:SS</code> <summary>` followed by ` · <tx link>` for the entry's Creditcoin transaction, or its source transaction when there is no Creditcoin one, or nothing. Icons: `🔏` prove, `⏸` wait, `🔒` close, `💸` payout, `✅` confirm, `↷` skip, `⚠️` error. Last line: `<a href="<webAppUrl>steward">Full log and cited explanation</a>`. With an empty log the whole reply is `🤖 No steward decisions logged yet.`

```
🤖 <b>Kitty Steward · last decisions</b>
🔒 <code>2026-09-12 05:48:14</code> closed circle 1 round 0 — every member proven · <a href="https://creditcoin-testnet.blockscout.com/tx/0x768a20ca…bbbad">0x768a20ca…</a>
⏸ <code>2026-09-12 05:48:00</code> waiting for a fuller batch
<a href="https://prashant-thakur77.github.io/Kitty/steward">Full log and cited explanation</a>
```

### `formatReminder`: the deadline reminder

```
⏰ <b>Reminder: 0x3C44…93BC has not paid round 2 of Lagos Susu #1</b>
100 tUSD due by Sepolia block <a href="https://sepolia.etherscan.io/block/1229">1,229</a> · attested frontier 1,200 · 29 blocks left
A missed round costs 120 Kitty Score points and is recorded on Creditcoin against the attestation that proved the deadline.
<a href="https://prashant-thakur77.github.io/Kitty/circle/1">Pay in Kitty</a>
```

When `attested >= deadline` the second line ends with `deadline reached, 64-block grace running` instead of the block count. The `120` and `64` are literals in `format.ts`; they match `KittyLedger`'s score penalty and `GRACE_BLOCKS` as documented in [`../TECH.md`](../TECH.md#the-kitty-score).

### `formatStart`: `/start` and `/help`

Three lines of pitch, a blank line, and the command list:

```
🐱 <b>Kitty</b> — savings circles where every payment is proven, not promised.
Members pay stablecoins into a vault on Ethereum; the Attestcoin Protocol proves each payment to Creditcoin, where the rules, the rotation and your Kitty Score live.
No treasurer, no oracle, no bridge. Dashboard: https://prashant-thakur77.github.io/Kitty/

/circle 1 — live state of a circle
/score 0x… — Kitty Score, counters, credit limit
/watch 0x… or /watch circle 1 — get every proof and a deadline reminder here
/unwatch, /list, /steward
```

### `/watch` and `/list`

These two replies are assembled in `handle()` rather than in `format.ts`; the examples follow its template strings for `/watch circle 1` (with the default `BOT_REMINDER_BLOCKS`) and for a chat watching circle 1 and one member.

```
👀 Watching circle 1. Every proof, missed payment, close and payout lands here, plus a reminder when a deadline is 40 attested blocks away.
```

```
👀 Watching
• circle 1 · Lagos Susu #1
• member <code>0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC</code>
```

Tests: `pnpm test:bot` runs `bot/test/format.test.ts` (11 tests: `describe()` wording, `formatEvent` links, escaping and the local fallback, `formatCircle` in open, closed, paid and tentative states, `pickRecipient`, `formatScore`, `formatSteward`, `formatReminder`, `formatStart`) with no network.
