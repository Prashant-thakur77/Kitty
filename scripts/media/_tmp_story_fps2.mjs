import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(`http://127.0.0.1:5187${process.argv[2]}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3) }; requestAnimationFrame(f) }))
console.log(process.argv[2], 'fps', fps.toFixed(1))
await browser.close()
