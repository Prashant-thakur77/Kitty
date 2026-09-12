# Kitty Telegram bot. Build from the repo root:
#   docker build -f bot/Dockerfile -t kitty-bot .
#   docker run --env-file .env -e BOT_TOKEN=… -v kitty-bot-state:/app/bot/state kitty-bot
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts
COPY worker/abi ./worker/abi
COPY worker/src/config.ts ./worker/src/config.ts
COPY worker/src/agent/log.ts ./worker/src/agent/log.ts
COPY bot ./bot
ENV BOT_STATE_FILE=bot/state/state.json
VOLUME ["/app/bot/state"]
CMD ["pnpm", "bot"]
