import { chromium } from 'playwright'
import fs from 'node:fs'
const OUT = '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/audit2'
const routes = ['/', '/circles', '/circle/0', '/score', '/borrow', '/steward', '/lab', '/architecture', '/presentation']
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
    page.on('requestfailed', r => errs.push(`[reqfail] ${r.url().slice(0, 200)} ${r.failure()?.errorText}`))
    for (const r of routes) {
      const url = base + r
      const key = `${sname}-${vname}${r === '/' ? '/home' : r}`.replace(/\//g, '_')
      errs.length = 0
      const t0 = Date.now()
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => { await page.goto(url, { waitUntil: 'load', timeout: 45000 }) })
      } catch (e) { errs.push('[goto] ' + String(e).slice(0, 200)) }
      const loadMs = Date.now() - t0
      await page.waitForTimeout(3000)
      await page.screenshot({ path: `${OUT}/${key}.png`, fullPage: false })
      await page.screenshot({ path: `${OUT}/${key}-full.png`, fullPage: true })
      const h = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, title: document.title, text: document.body.innerText.slice(0, 4000) }))
      log[key] = { url, loadMs, errs: [...errs], sh: h.sh, sw: h.sw, cw: h.cw, hscroll: h.sw > h.cw, title: h.title, text: h.text }
      console.log(key, loadMs + 'ms', 'errs=' + errs.length, 'hscroll=' + (h.sw > h.cw), 'sh=' + h.sh)
    }
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 2))
