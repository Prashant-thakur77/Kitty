// Captures the /story chapters headless (SwiftShader WebGL) every 3 s into the scratchpad and checks the recorder API.
import { chromium } from 'playwright'
import fs from 'node:fs'
const OUT = process.argv[2]
const CH = (process.argv[3] || '1,2,3').split(',').map(Number)
const STEP = Number(process.argv[4] || 3)
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' })
const errors = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
await page.goto(`http://127.0.0.1:5187/story?chapter=${CH[0]}&hud=0`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.kittyStory && !!document.querySelector('canvas'), null, { timeout: 30000 })
await page.waitForTimeout(1500)
// fps probe: how many rAF ticks happen in 2 s while chapter 1 plays
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2) }; requestAnimationFrame(f) }))
console.log('fps ~', fps.toFixed(1))
for (const ch of CH) {
  const d = await page.evaluate((c) => window.kittyStory.duration(c), ch)
  // frame-exact: seek every STEP seconds and screenshot, so slow rendering never smears the contact sheet
  for (let t = 0; t <= d + 0.01; t += STEP) {
    await page.evaluate(([c, tt]) => window.kittyStory.seek(c, tt), [ch, t])
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))))
    await page.screenshot({ path: `${OUT}/ch${ch}-${String(Math.round(t)).padStart(2, '0')}.png` })
  }
  console.log(`chapter ${ch}: ${d}s, ${Math.floor(d / STEP) + 1} frames`)
}
if (CH.includes(2) && process.env.PLAYTEST) {
  const t0 = Date.now()
  await page.evaluate(() => window.kittyStory.play(2))
  console.log(`play(2) resolved after ${((Date.now() - t0) / 1000).toFixed(1)}s (duration ${await page.evaluate(() => window.kittyStory.duration(2))}s)`)
}
console.log('console errors/warnings:', errors.length); for (const e of errors) console.log('  ', e)
await browser.close()
