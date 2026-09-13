// Records the Kitty demo, one webm per surface, against the REAL testnets (Sepolia + Creditcoin CC3 Testnet).
// Chapters 2-4 are the /story 3D explainer; the rest drives the production-mode dashboard with an injected
// wallet that signs as a real circle member, so the on-camera payment and browser-side proof are real
// transactions. The recorder pauses between "pay" and "prove" until the attestor network covers the payment.
//
// Prereqs:  cd web && pnpm exec vite --mode production --port 5190 --strictPort   (reads web/.env.production)
//           narration clips + durations.json from scripts/media/narrate.py
//           the member wallet (worker/demo-members.local.json[DEMO_MEMBER]) holds tUSD, Sepolia ETH and a little tCTC
//           the steward is STOPPED (so the browser, not the worker, proves the on-camera payment)
// Usage:    node scripts/media/record-demo.mjs <narrationDir> <outDir>
import { chromium } from 'playwright'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ethers } from 'ethers'

const [NARR, OUT] = process.argv.slice(2)
const REPO = '/home/prashant/projects/kitty'
const CARDS = `file://${REPO}/scripts/media/cards`
const base = process.env.DEMO_BASE ?? 'http://127.0.0.1:5190'
const { durations: dur } = JSON.parse(fs.readFileSync(`${NARR}/durations.json`, 'utf8'))
const env = Object.fromEntries(fs.readFileSync(`${REPO}/.env`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const DEMO_CIRCLE = process.env.DEMO_CIRCLE ?? '3'
const DEMO_MEMBER = Number(process.env.DEMO_MEMBER ?? '2')
const keys = JSON.parse(fs.readFileSync(`${REPO}/worker/demo-members.local.json`, 'utf8'))
const rpcs = { '0xaa36a7': env.SEPOLIA_RPC_URL, '0x18e8f': env.CREDITCOIN_RPC_URL }
const providers = Object.fromEntries(Object.entries(rpcs).map(([k, v]) => [k, new ethers.JsonRpcProvider(v)]))
const member = new ethers.Wallet(keys[DEMO_MEMBER])
const sh = (cmd) => execSync(cmd, { cwd: REPO, env: { ...process.env, FORCE_COLOR: '0' }, stdio: 'pipe' }).toString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } })

// Node side of the injected wallet: signs and broadcasts with the member's key on the chain the page asked for.
await ctx.exposeFunction('__kittySign', async (chainHex, tx) => {
  const w = member.connect(providers[chainHex])
  const req = { to: tx.to, data: tx.data ?? '0x', value: tx.value ? BigInt(tx.value) : 0n }
  if (tx.gas) req.gasLimit = BigInt(tx.gas)
  if (chainHex === '0x18e8f' && (!req.gasLimit || req.gasLimit < 1_500_000n)) req.gasLimit = 1_500_000n   // proof verification floor
  const sent = await w.sendTransaction(req)
  console.log(`   signed ${chainHex === '0x18e8f' ? 'creditcoin' : 'sepolia'} tx ${sent.hash}`)
  return sent.hash
})
// Browser side: an EIP-1193 provider for the member. Reads go straight to the RPCs, writes go to __kittySign.
await ctx.addInitScript(({ account, rpcs }) => {
  let chain = '0xaa36a7'
  const listeners = {}
  const rpc = async (method, params) => {
    const r = await fetch(rpcs[chain], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data }); return j.result
  }
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; (listeners.chainChanged || []).forEach((f) => f(chain)); return null }
      if (method === 'wallet_addEthereumChain') return null
      if (method === 'eth_sendTransaction') return window.__kittySign(chain, params[0])
      if (method === 'personal_sign' || method.startsWith('eth_signTypedData')) throw Object.assign(new Error('demo wallet signs transactions only'), { code: 4001 })
      return rpc(method, params)
    },
    on: (ev, f) => { (listeners[ev] ||= []).push(f) }, removeListener: (ev, f) => { listeners[ev] = (listeners[ev] || []).filter((g) => g !== f) },
  }
}, { account: member.address, rpcs })
// a visible cursor (Playwright's recorder draws none)
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div')
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:99px;pointer-events:none;left:-40px;top:-40px;background:rgba(79,209,163,.35);border:2px solid #4FD1A3;box-shadow:0 0 0 6px rgba(79,209,163,.12);transition:transform .12s ease-out;transform:translate(-50%,-50%)'
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)' }, true)
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)' }, true)
  })
})

const timeline = process.env.RESUME_TIMELINE ? JSON.parse(fs.readFileSync(process.env.RESUME_TIMELINE, 'utf8')) : []
const done = new Set(timeline.map((t) => t.name))
let page = null
let segStart = 0
async function open(url, wait = 'networkidle') {
  if (page) await page.close()
  page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('   pageerror', e.message.slice(0, 120)))
  await page.goto(url, { waitUntil: wait, timeout: 90000 })
  await sleep(700)
  return page
}
async function segment(name, action) {
  if (done.has(name)) { console.log(name.padEnd(14), 'reused from', process.env.RESUME_TIMELINE); return }
  segStart = Date.now()
  const pageBefore = page
  await action()
  if (pageBefore && page !== pageBefore && pageBefore.video()) console.log(`   note: ${name} switched pages mid-segment; only the last page's video is kept`)
  const want = (dur[name] + 0.5) * 1000
  const spent = Date.now() - segStart
  if (spent < want) await sleep(want - spent)
  const seconds = (Date.now() - segStart) / 1000
  timeline.push({ name, file: await page.video().path(), seconds })
  console.log(name.padEnd(14), seconds.toFixed(1) + 's', spent > want ? '(actions ran long by ' + ((spent - want) / 1000).toFixed(1) + 's)' : '')
}
const scrollTo = async (y, ms = 1100) => { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y); await sleep(ms) }
const glide = async (x, y, steps = 24) => { await page.mouse.move(x, y, { steps }) }
async function pace(fromMs, toMs, fn) { const t = Date.now() - segStart; if (t < fromMs) await sleep(fromMs - t); await fn() }
async function clickText(role, name, wait = 800) { const b = page.getByRole(role, { name }).first(); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox(); if (bb) await glide(bb.x + bb.width / 2, bb.y + bb.height / 2, 20); await b.click({ timeout: 60000 }); await sleep(wait) }

// terminal surface: stream a command's stdout into the terminal card line by line
async function terminal(title, cmdShown, cmd, { maxLines = 60, lineDelay = 90, extraEnv = {}, plain = false } = {}) {
  const strip = (l) => plain ? l.replace(/<a href="[^"]*">/g, '').replace(/<\/?(a|b|i|code|pre)>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : l
  await open(`${CARDS}/terminal.html?title=${encodeURIComponent(title)}`, 'load')
  await page.evaluate((c) => window.setCmd(c), cmdShown)
  await sleep(500)
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', cmd], { cwd: REPO, env: { ...process.env, FORCE_COLOR: '0', ...extraEnv } })
    let buf = ''; let n = 0
    const queue = []; let pumping = false
    const pump = async () => { if (pumping) return; pumping = true; while (queue.length) { const l = queue.shift(); try { await page.evaluate((s) => window.pushLine(s), l) } catch {} await sleep(lineDelay) } pumping = false }
    const onData = (d) => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { if (n++ < maxLines && !/injected env|dotenvx|tip:/.test(l)) queue.push(strip(l.replace(/\x1b\[[0-9;]*m/g, ''))) } pump() }
    p.stdout.on('data', onData); p.stderr.on('data', onData)
    p.on('exit', async () => { await sleep(300); await pump(); try { await page.evaluate(() => window.done()) } catch {} resolve() })
  })
}
// story chapters are captured frame-exact by scripts/media/record-story.mjs (run it in parallel); its
// story-timeline.json is merged here in chapter order
const storyTimeline = fs.existsSync(path.join(OUT, 'story-timeline.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'story-timeline.json'), 'utf8')) : null

// ── 1 · hook card ──
await segment('01_hook', async () => {
  await open(`${CARDS}/title.html?eyebrow=${encodeURIComponent('A demo for BUIDL CTC 2026 Fall · live on Creditcoin CC3 Testnet')}&title=${encodeURIComponent('What if a savings circle could <em>prove</em> every payment it ever received?')}&sub=${encodeURIComponent('Kitty · money on Ethereum, rules on Creditcoin, proofs in between')}&on=9`, 'load')
})

// ── 2–4 · the 3D story (frame-exact clips from record-story.mjs, merged at the end) ──

// ── 5 · live landing + connect ──
await segment('05_live', async () => {
  await open(base + '/')
  await glide(1000, 480, 30)
  await pace(4000, 0, async () => { await scrollTo(700, 1100) })
  await pace(7000, 0, async () => { await scrollTo(0, 800); await clickText('button', /^Connect$/, 1500) })
})

// ── 5b · create a circle from the browser (real Creditcoin tx from the member wallet) ──
let CIRCLE = process.env.DEMO_CIRCLE ?? ''
const MEMBERS = keys.slice(0, 3).map((k) => new ethers.Wallet(k).address)
await segment('05b_create', async () => {
  await open(base + '/create')
  const connect = page.getByRole('button', { name: /^Connect/ })
  if (await connect.count()) await clickText('button', /^Connect/, 1200)
  const type = async (loc, text) => { const bb = await loc.boundingBox(); if (bb) await glide(bb.x + 30, bb.y + bb.height / 2, 16); await loc.click(); await loc.fill(''); await page.keyboard.type(text, { delay: 28 }) }
  await type(page.getByPlaceholder('Delhi Chit Circle'), 'Kolkata Chit Circle')
  await type(page.locator('textarea').first(), MEMBERS.join('\n'))
  await type(page.locator('label:has-text("Installment") input'), '100')
  await type(page.locator('label:has-text("Round length") input'), '200')
  await clickText('radio', /By proven score/, 500)
  await pace(19000, 0, async () => {})
  await clickText('button', /^Create circle/, 500)
  await page.waitForURL(/\/circle\/\d+/, { timeout: 180000 }).catch(() => {})
  CIRCLE = (page.url().match(/\/circle\/(\d+)/) || [])[1] ?? CIRCLE
  console.log('   created circle', CIRCLE)
  await sleep(2500)
})
const DEMO_CIRCLE_ID = () => CIRCLE

// ── 6 · circle page (the member's circle) ──
await segment('06_circle', async () => {
  await open(`${base}/circle/${DEMO_CIRCLE_ID()}`)
  if (await page.getByRole('button', { name: /^Connect$/ }).count()) await clickText('button', /^Connect$/, 1200)   // fresh session
  await glide(700, 330, 30)
  await pace(4000, 0, async () => { await glide(300, 470, 20); await glide(1500, 470, 90) })   // run the cursor along the tick scale
  await pace(9000, 0, async () => { await scrollTo(620, 1200); await glide(520, 700, 40) })    // wheel + history
})

// ── 7 · pay from the browser (real Sepolia tx) ──
await segment('07_pay', async () => {
  await scrollTo(0, 800)
  await clickText('button', /^Contribute/, 900)
  await clickText('button', /^Pay /, 400)
  // the injected wallet signs approve (if needed) + contribute; the page shows the sent modal
  await page.waitForSelector('text=/Contributed|sent|mined|Sepolia tx/i', { timeout: 180000 }).catch(() => {})
  await sleep(2500)
  const close = page.getByRole('button', { name: /Close|Done|OK/ }).first(); if (await close.count()) await close.click().catch(() => {})
  await sleep(1500)
})
// the other members pay off camera so the round can complete once the steward is back on
if (!process.env.SKIP_OTHERS) try { sh(`pnpm -s demo contribute --circle ${DEMO_CIRCLE_ID()} --skip ${DEMO_MEMBER}`) ; console.log('   other members paid') } catch (e) { console.log('   background contribute failed:', String(e).slice(0, 120)) }

// ── wait for the attestor network to cover the payment ──
if (!done.has('08_prove')) {
  const t0 = Date.now()
  console.log('waiting for attestation of the on-camera payment…')
  if (page) { await page.close(); page = null }
  for (;;) {
    const ready = await (async () => {
      const p = await ctx.newPage(); await p.goto(`${base}/circle/${DEMO_CIRCLE_ID()}`, { waitUntil: 'load', timeout: 90000 }); await sleep(6000)
      const label = await p.getByRole('button', { name: /^Prove \d+ payment/ }).first().innerText().catch(() => '')
      const panelText = await p.locator('section', { hasText: 'Prove it yourself' }).first().innerText().catch(() => '')
      const maxPay = Math.max(0, ...[...panelText.matchAll(/block ([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ''))))
      await p.close()
      const n = Number((label.match(/Prove (\d+) payment/) || [])[1] ?? 0)
      if (n < Number(process.env.WANT_PAYMENTS ?? 1)) return false
      // the Proof Builder's own frontier can lag the on-chain one by a few blocks; wait for it too
      const ah = await fetch(`${env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network'}/api/v1/attested-height/1`).then((r) => r.json()).catch(() => ({ attestedHeight: 0 }))
      console.log(`   button: ${label} · proof builder attested ${ah.attestedHeight} · highest payment block ${maxPay}`)
      return maxPay > 0 && Number(ah.attestedHeight) >= maxPay
    })()
    if (ready) break
    if (Date.now() - t0 > 30 * 60 * 1000) { console.log('gave up waiting for attestation'); break }
    await sleep(30000)
  }
  console.log('attested after', ((Date.now() - t0) / 60000).toFixed(1), 'min')
}

// ── 8 · prove it yourself (real Creditcoin tx from the member wallet) ──
await segment('08_prove', async () => {
  await open(`${base}/circle/${DEMO_CIRCLE_ID()}`)
  const connect = page.getByRole('button', { name: /^Connect$/ })
  if (await connect.count()) { await clickText('button', /^Connect$/, 1500) }   // a fresh session: connect the member first
  const panel = page.getByText('Prove it yourself').first(); await panel.scrollIntoViewIfNeeded(); await sleep(600)
  const y = await page.evaluate(() => window.scrollY); await scrollTo(Math.max(0, y - 120), 900)
  await pace(6000, 0, async () => { await clickText('button', /^Prove \d+ payment/, 500) })
  await page.waitForSelector('text=/Verified on Creditcoin|verified/i', { timeout: 240000 }).catch(() => {})
  await sleep(2500)
})

// ── 9 · steward ──
await segment('09_steward', async () => {
  await open(base + '/steward')
  await glide(520, 420, 30)
  await pace(5000, 0, async () => { await scrollTo(380, 1200); await glide(520, 620, 40) })
  await pace(13000, 0, async () => { await scrollTo(900, 1200) })
})

// ── 10 · attack lab (recorded against the live precompile) ──
await segment('10_attack', async () => {
  await open(base + '/lab')
  await glide(700, 400, 30)
  await pace(5000, 0, async () => { await scrollTo(520, 1200) })
  await pace(12000, 0, async () => { await scrollTo(1100, 1200) })
  await pace(20000, 0, async () => { await scrollTo(1700, 1200) })
})

// ── 11 · credit ──
await segment('11_credit', async () => {
  await open(`${base}/score/${member.address}`)
  await glide(420, 520, 30)
  await pace(7000, 0, async () => { await scrollTo(600, 1100) })
  await pace(12000, 0, async () => { await page.goto(base + '/borrow', { waitUntil: 'load', timeout: 90000 }); await sleep(600); await glide(520, 520, 30) })   // same page: one video file per segment
})

// ── 12 · telegram (the bot answering from the chain) ──
await segment('12_telegram', async () => {
  await terminal('kitty — telegram bot · dry run against CC3 Testnet', `BOT_SIMULATE="/circle ${DEMO_CIRCLE_ID()}; /score ${member.address}" pnpm bot:dry`, `BOT_SIMULATE="/circle ${DEMO_CIRCLE_ID()}; /score ${member.address}" pnpm -s bot:dry`, { lineDelay: 110, maxLines: 40, plain: true })
})

// ── 13 · depth (architecture flow scene) ──
await segment('13_depth', async () => {
  await open(base + '/architecture')
  await glide(700, 420, 30)
  await pace(9000, 0, async () => { await scrollTo(700, 1500) })
  await pace(16000, 0, async () => { await scrollTo(1400, 1500) })
})

// ── 14 · close card ──
await segment('14_close', async () => {
  await open(`${CARDS}/title.html?eyebrow=${encodeURIComponent('BUIDL CTC 2026 Fall · DeFi track · live on CC3 Testnet')}&title=${encodeURIComponent('Savings circles where every payment is <em>proven</em>, not promised.')}&sub=${encodeURIComponent('Run by an agent whose only power is proof.')}&footr=${encodeURIComponent('162 contract tests · 29 agent tests · 8 attack scenarios on the live precompile')}&on=24`, 'load')
})

if (page) await page.close()
await ctx.close(); await browser.close()
const merged = storyTimeline ? [timeline[0], ...storyTimeline, ...timeline.slice(1)] : timeline
const order = ['01_hook','02_problem','03_split','04_enable','05_live','05b_create','06_circle','07_pay','08_prove','09_steward','10_attack','11_credit','12_telegram','13_depth','14_close']
merged.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(merged, null, 1))
console.log('recorded', timeline.length, 'segments, total', timeline.reduce((a, t) => a + t.seconds, 0).toFixed(1) + 's')
