# Media pipeline (deck, screenshots, narrated demo)

Everything here regenerates the submission media from the running app. Playwright is expected at
`~/.cache/ms-playwright` (install once with `npx playwright install chromium`); the scripts point at
a local Playwright install path at the top of each `.mjs` — adjust it if you move it.

| file | what it does |
|---|---|
| `narrate.py` | Chatterbox TTS (GPU) → one wav per demo segment + `durations.json`. `~/chatterbox-env/bin/python scripts/media/narrate.py <outdir> [names,to,regenerate]`. Voice prompt from `VOICE_PROMPT` (a short recording of a voice you have the rights to use). Chatterbox caps a clip at 40 s, so keep each segment under ~100 words. |
| `record-demo.mjs` | Drives the dashboard in headless Chromium against the local world, executes the on-chain actions mid-recording, streams terminal commands into a styled terminal card, injects a read-only demo wallet and a visible cursor, and writes one webm per surface + `timeline.json` whose segment lengths match the narration. |
| `assemble.py` | Trims each segment to its measured length, speeds the picture up by at most 1.35× when the actions ran longer than the voice (so there is never dead air), pads narration, concatenates, mixes a quiet room-tone bed, burns captions, writes a faststart mp4. |
| `cards/title.html`, `cards/terminal.html` | The title/close card and the terminal surface, styled with Kitty's own tokens. Parameterised by query string. |
| `deck.mjs` | Prints `/presentation` to `docs/Kitty-deck.pdf`. |
| `../screenshots.mjs` | README screenshots into `docs/assets/`. |

## Make the demo

```bash
# 1. a world with round 0 proven and long rounds so nothing expires mid-recording
WORLD_ROUND1=0 WORLD_ROUND_BLOCKS=600 scripts/local-world.sh
# 2. lab API (for /lab) and the dashboard, each in its own terminal
set -a; source web/.env.local; set +a; KITTY_MODE=local PORT=8790 … pnpm lab:api     # see record-demo.mjs labEnv for the full env
pnpm --dir web dev
# 3. narration, recording, assembly
~/chatterbox-env/bin/python scripts/media/narrate.py /tmp/narration
node scripts/media/record-demo.mjs /tmp/narration /tmp/rec
python3 scripts/media/assemble.py /tmp/narration /tmp/rec docs/kitty-demo.mp4
```

Checks worth running on the result: `ffmpeg -i out.mp4 -af silencedetect=noise=-45dB:d=1.5 -f null -`
(should report nothing) and a contact sheet `-vf "fps=1/20,scale=640:-1,tile=4x4"`.
