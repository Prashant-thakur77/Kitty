import { chromium } from 'playwright'
import fs from 'node:fs'
const OUT = '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/audit2'
const routes = ['/circle/1', '/score/0xB077B088E668386Bc57af87F175d250f459f0791']
const sites = { local: 'http://127.0.0.1:5173', hosted: 'https://prashant-thakur77.github.io/Kitty' }
const vps = { desk: { width: 1440, height: 900 }, mob: { width: 390, height: 844 } }
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const log = {}
for (const [sname, base] of Object.entries(sites)) {
  for (const [vname, vp] of Object.entries(vps)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vname === 'mob', hasTouch: vname === 'mob' })
    const page = await ctx.newPage()
    const errs = []
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
    page.on('pageerror', e => errs.push(`[pageerror] ${String(e).slice(0, 300)}`))
    for (const r of routes) {
      const key = `${sname}-${vname}${r}`.replace(/\//g, '_').slice(0, 40)
      errs.length = 0
      const t0 = Date.now()
      try { await page.goto(base + r, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => { await page.goto(base + r, { waitUntil: 'load', timeout: 45000 }) }) } catch (e) { errs.push('[goto] ' + String(e).slice(0, 200)) }
      const loadMs = Date.now() - t0
      await page.waitForTimeout(6000)
      await page.screenshot({ path: `${OUT}/x-${key}.png` })
      await page.screenshot({ path: `${OUT}/x-${key}-full.png`, fullPage: true })
      const h = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, text: document.body.innerText.slice(0, 5000) }))
      log[key] = { loadMs, errs: [...errs], ...h, hscroll: h.sw > h.cw }
      console.log(key, loadMs + 'ms', 'errs=' + errs.length, 'hscroll=' + (h.sw > h.cw), 'sh=' + h.sh)
    }
    if (vname === 'mob') {
      // open the mobile menu on the home page
      await page.goto(base + '/', { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(1500)
      const btn = page.locator('button[aria-label*="enu" i], button:has(svg.lucide-menu)').first()
      try { await btn.click({ timeout: 3000 }); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/x-${sname}-mob-menu.png` }) } catch (e) { console.log('menu click failed', String(e).slice(0, 100)) }
    }
    await ctx.close()
  }
}
// bundle sizes on hosted
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const sizes = []
page.on('response', async (r) => { try { const h = r.headers(); const u = r.url(); if (/\.(js|css|json|woff2?)(\?|$)/.test(u)) sizes.push({ u: u.replace('https://prashant-thakur77.github.io/Kitty/', ''), len: Number(h['content-length'] || 0), enc: h['content-encoding'] || '' }) } catch {} })
await page.goto('https://prashant-thakur77.github.io/Kitty/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(4000)
await page.goto('https://prashant-thakur77.github.io/Kitty/architecture', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{})
await page.waitForTimeout(4000)
log.sizes = sizes
console.log(JSON.stringify(sizes, null, 1))
await browser.close()
fs.writeFileSync(`${OUT}/log-extra.json`, JSON.stringify(log, null, 2))
