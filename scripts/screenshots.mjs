// Captures dashboard screenshots for the README with Playwright.
// usage: node scripts/screenshots.mjs [baseUrl]   (default http://localhost:5173)
import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:5173'
const shots = [
  ['landing', '/'],
  ['circle', '/circle/1'],
  ['score', '/score/' + (process.env.SHOT_MEMBER ?? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')],
  ['lab', '/lab'],
  ['steward', '/steward'],
  ['architecture', '/architecture'],
  ['presentation', '/presentation'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5, colorScheme: 'dark' })
for (const [name, path] of shots) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 2500))
  await page.screenshot({ path: `docs/assets/${name}.png`, fullPage: name !== 'presentation' })
  console.log('saved docs/assets/' + name + '.png')
}
await browser.close()
