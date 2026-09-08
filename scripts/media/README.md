# Media pipeline (deck, screenshots, narrated demo)

Everything here regenerates the submission media from the running app. Playwright is expected at
`~/.cache/ms-playwright` (install once with `npx playwright install chromium`); the scripts point at
a local Playwright install path — adjust the import if you move it.

| file | what it does |
|---|---|
| `narrate.py` | Chatterbox TTS (GPU) → one wav per demo segment + `durations.json`. Run with `~/chatterbox-env/bin/python scripts/media/narrate.py`. Voice prompt: `~/Downloads/kristen.mp3`. |
| `record-demo.mjs` | Drives the dashboard against the local lab world (`pnpm e2e:lab` must be running, plus `pnpm --dir web dev`), executes the on-chain actions mid-recording, and writes a webm + `timeline.json` whose segment lengths match the narration. |
| `deck.mjs` | Prints `/presentation` to `docs/Kitty-deck.pdf` (10 slides, 1600×900). |
| `../screenshots.mjs` | README screenshots into `docs/assets/`. |

Mux narration onto the recording (segment order follows `timeline.json`):

```bash
ffmpeg -y -i video/page.webm -i narration/01_problem.wav … \
  -filter_complex "[1:a]aresample=48000,apad=whole_dur=18.7,atrim=0:18.7[a0];…;[a0][a1]…concat=n=9:v=0:a=1[aout]" \
  -map 0:v -map "[aout]" -c:v libx264 -crf 22 -pix_fmt yuv420p -c:a aac -movflags +faststart kitty-demo.mp4
```
