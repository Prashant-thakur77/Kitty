# Kitty on Telegram

Kitty reaches members where they already talk to each other: a bot that pushes every proof and every deadline into the group chat, and the dashboard as a Telegram Mini App. Nothing in the bot is a claim; every message carries the Creditcoin transaction and, where there is one, the Attestcoin query id, and the reminder clock is the attested frontier from `0x0FD3`.

- Bot: `bot/` ([README](../bot/README.md)) — `/circle`, `/score`, `/watch`, `/steward`, event pushes, deadline reminders
- Mini App: the hosted dashboard, opened from the bot's **Open Kitty** button or menu button. `web/src/lib/telegram.ts` loads the Telegram SDK only when the page is opened from Telegram, calls `ready()`/`expand()`, mirrors the Telegram theme into `--tg-*` CSS variables, and drives the native BackButton from the router. Inside Telegram there is no injected wallet, so the wallet pill becomes *open in a wallet browser to pay*; everything else (circles, scores, proofs, the steward log) reads live.

## 1. Create the bot with @BotFather

1. Open [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Name: `Kitty Circles`. Username: `KittyCirclesBot` (or any free `…Bot` name; then set `VITE_TELEGRAM_BOT_URL` for the web pill and `BOT_URL` for the bot).
3. Copy the token into the repo root `.env`:

   ```
   BOT_TOKEN=123456789:AA…
   ```

4. Optional polish: `/setdescription`, `/setabouttext`, `/setuserpic` (use `web/public/kitty.svg` rendered to PNG). Commands are registered by the bot itself on start (`setMyCommands`), as is the **Open Kitty** menu button (`setChatMenuButton`).
5. For group chats: `/setprivacy` → **Disable**, so the bot sees `/circle 1` in a group without being addressed as `/circle@KittyCirclesBot`.

## 2. Register the Mini App

Either is enough; both work together.

- **Menu button (automatic).** The bot sets its menu button to the Mini App URL on start. Nothing to do.
- **Direct link (`/newapp`).** In @BotFather: `/newapp` → choose the bot → title `Kitty` → description → upload a 640×360 photo → skip the GIF → short name `kitty` → Web App URL `https://prashant-thakur77.github.io/Kitty/?tg=1`. The Mini App is then `https://t.me/KittyCirclesBot/kitty`, shareable into any chat.

The Mini App URL must be HTTPS. For a local build, `BOT_WEBAPP_URL` can point at any tunnel (`ngrok http 5173`), and the web pill at `VITE_TELEGRAM_BOT_URL`.

## 3. Run locally

```bash
pnpm install
pnpm bot                       # live, long-polling, with BOT_TOKEN in .env
pnpm bot:dry                   # no token: same watcher, messages printed instead of sent
```

Against the local two-chain world (`pnpm e2e:local` or `scripts/local-world.sh`):

```bash
KITTY_ENV_FILE=worker/.env.world BOT_WATCH="circle 1" pnpm bot:dry --once
KITTY_ENV_FILE=worker/.env.world BOT_SIMULATE="/circle 1; /steward" pnpm bot:dry
```

Against the live testnet (root `.env`, read-only):

```bash
BOT_SIMULATE="/circle 1; /score 0xB077B088E668386Bc57af87F175d250f459f0791" pnpm bot:dry
```

Subscriptions, the event cursor and sent reminders live in `bot/state.json` (gitignored). Delete it to rescan.

## 4. Run with Docker

```bash
docker build -f bot/Dockerfile -t kitty-bot .
docker run -d --name kitty-bot --restart unless-stopped \
  --env-file .env -e BOT_TOKEN=123456789:AA… \
  -v kitty-bot-state:/app/bot/state kitty-bot
docker logs -f kitty-bot
```

The container reads the same `.env` as the worker (RPC URLs, contract addresses). To serve `/steward` from the container, mount the worker's log: `-v $PWD/worker/steward.local.json:/app/worker/steward.local.json:ro`.

## 5. Test the Mini App integration in a browser

Append `?tg=1` to any dashboard URL (`http://localhost:5173/?tg=1`). The SDK script is injected, `<html data-telegram="1">` is set, the Telegram pill disappears from the nav, and, with no wallet extension, the wallet pill reads *open in a wallet browser to pay*. Outside Telegram the SDK is never loaded.
