import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
await page.goto((process.env.DECK_BASE_URL ?? 'http://127.0.0.1:5173') + '/presentation', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: '/home/prashant/projects/kitty/docs/Kitty-deck.pdf', width: '1600px', height: '900px', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } })
console.log('deck written')
await browser.close()
