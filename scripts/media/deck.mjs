import { chromium } from '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/shots/node_modules/playwright/index.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
await page.goto('http://127.0.0.1:5173/presentation', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: '/home/prashant/projects/kitty/docs/Kitty-deck.pdf', width: '1600px', height: '900px', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } })
console.log('deck written')
await browser.close()
