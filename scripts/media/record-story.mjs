// Captures the three /story chapters frame-exact (SwiftShader cannot play them at speed) and encodes one clip
// per chapter plus story-timeline.json, which record-demo.mjs merges into the demo timeline.
// Usage: node scripts/media/record-story.mjs <outDir> [fps=15] [width=1600]
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const [OUT, FPS = '15', W = '1600'] = process.argv.slice(2)
const base = process.env.DEMO_BASE ?? 'http://127.0.0.1:5190'
const fps = Number(FPS), width = Number(W), height = Math.round(width * 9 / 16)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark' })
const timeline = []
for (const [name, chapter] of [['02_problem', 1], ['03_split', 2], ['04_enable', 3]]) {
  const p = await ctx.newPage()
  await p.goto(`${base}/story?chapter=${chapter}&autoplay=0&hud=0`, { waitUntil: 'load', timeout: 90000 })
  await p.waitForFunction(() => window.kittyStory && typeof window.kittyStory.seek === 'function', null, { timeout: 60000 })
  await sleep(1500)
  const duration = await p.evaluate((c) => window.kittyStory.duration(c), chapter)
  const dir = path.join(OUT, `story-${chapter}`); fs.mkdirSync(dir, { recursive: true })
  const hold = 3
  const total = Math.ceil((duration + hold) * fps)
  const t0 = Date.now()
  for (let i = 0; i < total; i++) {
    const t = Math.min(duration, i / fps)
    await p.evaluate((a) => { window.kittyStory.seek(a.c, a.t); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) }, { c: chapter, t })
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.png`), type: 'png' })
    if (i % (fps * 10) === 0) console.log(`   ${name}: ${i}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
  await p.close()
  const clip = path.join(OUT, `story-${chapter}.mp4`)
  execSync(`ffmpeg -y -v error -framerate ${fps} -i ${dir}/f%05d.png -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p ${clip}`)
  fs.rmSync(dir, { recursive: true, force: true })
  timeline.push({ name, file: clip, seconds: duration + hold })
  console.log(name.padEnd(14), (duration + hold).toFixed(1) + 's', `(${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  fs.writeFileSync(path.join(OUT, 'story-timeline.json'), JSON.stringify(timeline, null, 1))
}
await ctx.close(); await browser.close()
console.log('story clips done')
