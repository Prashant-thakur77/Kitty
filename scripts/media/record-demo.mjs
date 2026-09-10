// Records the Kitty demo against the local world, one webm per surface, with on-chain actions driven live.
// Prereqs: WORLD_ROUND1=0 scripts/local-world.sh (round 0 done, round 1 open) · pnpm lab:api · pnpm --dir web dev
//          narration clips + durations.json from scripts/media/narrate.py
// Usage:   node scripts/media/record-demo.mjs <narrationDir> <outDir>
import { chromium } from '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/shots/node_modules/playwright/index.mjs'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [NARR, OUT] = process.argv.slice(2)
const REPO = '/home/prashant/projects/kitty'
const CARDS = `file://${REPO}/scripts/media/cards`
const base = 'http://127.0.0.1:5173'
const { durations: dur } = JSON.parse(fs.readFileSync(`${NARR}/durations.json`, 'utf8'))
const env = Object.fromEntries(fs.readFileSync(`${REPO}/web/.env.local`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split('=')))
const M0 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', M2 = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const labEnv = {
  ...process.env, KITTY_MODE: 'local', SEPOLIA_RPC_URL: 'http://127.0.0.1:8545', CREDITCOIN_RPC_URL: 'http://127.0.0.1:8546',
  PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', SOURCE_CHAIN_KEY: '1',
  WORKER_STATE_FILE: 'state.world.json', STEWARD_LOG_FILE: 'steward.world.json', WORKER_BATCH_WAIT_MS: '0',
  TEST_USD_ADDRESS: env.VITE_TEST_USD_ADDRESS, KITTY_VAULT_ADDRESS: env.VITE_KITTY_VAULT_ADDRESS, KITTY_LEDGER_ADDRESS: env.VITE_KITTY_LEDGER_ADDRESS,
  FAKE_VAULT_ADDRESS: env.VITE_FAKE_VAULT_ADDRESS, KITTY_VIEWER_ADDRESS: env.VITE_KITTY_VIEWER_ADDRESS, FORCE_COLOR: '0',
}
const sh = (cmd) => execSync(cmd, { cwd: REPO, env: labEnv, stdio: 'pipe' }).toString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const attestNow = () => sh(`cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" 1 $(cast block-number --rpc-url $SEPOLIA_RPC_URL) >/dev/null`)
const attestTo = (h) => sh(`cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" 1 ${h} >/dev/null`)

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } })
// a read-only EIP-1193 wallet for member 0: reads go to the local RPCs, writes are refused. Lets the
// dashboard show "you" and live underwriting without MetaMask in a headless browser.
await ctx.addInitScript(({ account, rpcs }) => {
  let chain = '0x18e6f' // 102031, Creditcoin
  const listeners = {}
  const rpc = async (method, params) => {
    const url = rpcs[chain]
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code }); return j.result
  }
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; (listeners.chainChanged || []).forEach((f) => f(chain)); return null }
      if (method === 'wallet_addEthereumChain') return null
      if (method === 'eth_sendTransaction' || method === 'personal_sign' || method.startsWith('eth_signTypedData')) throw Object.assign(new Error('demo wallet is read-only'), { code: 4001 })
      return rpc(method, params)
    },
    on: (ev, f) => { (listeners[ev] ||= []).push(f) }, removeListener: (ev, f) => { listeners[ev] = (listeners[ev] || []).filter((g) => g !== f) },
  }
}, { account: M0, rpcs: { '0xaa36a7': 'http://127.0.0.1:8545', '0x18e6f': 'http://127.0.0.1:8546' } })
// a visible cursor: Playwright's recorder draws none, so we draw one that follows the real pointer events
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

const timeline = []
let page = null
let segStart = 0
async function open(url) {
  if (page) await page.close()
  page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await sleep(600)
  return page
}
async function segment(name, action) {
  segStart = Date.now()
  await action()
  const want = (dur[name] + 0.5) * 1000
  const spent = Date.now() - segStart
  if (spent < want) await sleep(want - spent)
  const seconds = (Date.now() - segStart) / 1000
  timeline.push({ name, file: await page.video().path(), seconds })
  console.log(name.padEnd(12), seconds.toFixed(1) + 's', spent > want ? '(actions ran long by ' + ((spent - want) / 1000).toFixed(1) + 's)' : '')
}
const scrollTo = async (y, ms = 1100) => { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y); await sleep(ms) }
const glide = async (x, y, steps = 24) => { await page.mouse.move(x, y, { steps }) }
async function pace(fromMs, toMs, fn) { const t = Date.now() - segStart; if (t < fromMs) await sleep(fromMs - t); await fn(); }

// terminal surface: stream a command's stdout into the terminal card line by line
async function terminal(title, cmdShown, cmd, { maxLines = 60, lineDelay = 90 } = {}) {
  await open(`${CARDS}/terminal.html?title=${encodeURIComponent(title)}`)
  await page.evaluate((c) => window.setCmd(c), cmdShown)
  await sleep(500)
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', cmd], { cwd: REPO, env: labEnv })
    let buf = ''; let n = 0
    const queue = []; let pumping = false
    const pump = async () => { if (pumping) return; pumping = true; while (queue.length) { const l = queue.shift(); try { await page.evaluate((s) => window.pushLine(s), l) } catch {} await sleep(lineDelay) } pumping = false }
    const onData = (d) => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { if (n++ < maxLines && !/injected env|dotenvx|tip:/.test(l)) queue.push(l.replace(/\x1b\[[0-9;]*m/g, '')) } pump() }
    p.stdout.on('data', onData); p.stderr.on('data', onData)
    p.on('exit', async () => { await sleep(300); await pump(); try { await page.evaluate(() => window.done()) } catch {} resolve() })
  })
}

// ── 1 · hook card ──
await segment('01_hook', async () => {
  await open(`${CARDS}/title.html?eyebrow=${encodeURIComponent('A demo for BUIDL CTC 2026 Fall')}&title=${encodeURIComponent('What if a savings circle could <em>prove</em> every payment it ever received?')}&sub=${encodeURIComponent('Kitty · money on Ethereum, rules on Creditcoin, proofs in between')}&on=9`)
})

// ── 2–3 · landing ──
await segment('02_problem', async () => {
  await open(base + '/')
  await glide(900, 500)
  await pace(9000, 0, async () => { await scrollTo(1650, 1400) })   // trust table
  await pace(15000, 0, async () => { await glide(1100, 640, 40) })
})
await segment('03_solution', async () => {
  await scrollTo(1000, 1200)                                            // statement
  await pace(7000, 0, async () => { await scrollTo(1250, 1200); await glide(480, 640, 40); await sleep(1500); await glide(1400, 640, 60) }) // step cards spotlight
})

// ── 4 · circle ──
await segment('04_circle', async () => {
  await open(base + '/circle/1')
  await glide(760, 330, 30)
  await pace(9000, 0, async () => { await glide(300, 470, 20); await glide(1500, 470, 90) })   // run the cursor along the tick scale
})

// ── 5 · pay (terminal) ──
await segment('05_pay', async () => {
  await terminal('kitty — members pay on Sepolia', 'pnpm demo contribute --skip 2', 'pnpm -s demo contribute --skip 2', { lineDelay: 160 })
})

// ── 6 · prove (terminal) ──
await segment('06_prove', async () => {
  attestNow()
  await terminal('kitty — steward · prove the round', 'pnpm worker --once', 'pnpm -s worker --once', { lineDelay: 170 })
})

// ── 7 · close + payout + proof-back (circle page, actions in the background) ──
await segment('07_close_a', async () => {
  await open(base + '/circle/1')
  const p = spawn('bash', ['-c', 'pnpm -s demo contribute --skip 0,1 && cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" 1 $(cast block-number --rpc-url $SEPOLIA_RPC_URL) >/dev/null && pnpm -s worker --once'], { cwd: REPO, env: labEnv, stdio: 'ignore' })
  await glide(760, 330, 30)
  await pace(12000, 0, async () => { await scrollTo(560, 1000); await glide(1150, 640, 30) })   // rotation panel while the steward works
  await new Promise((r) => p.on('exit', r))
})
await segment('07_close_b', async () => {
  await sleep(5000)                                                      // page polls and repaints: Paid
  await glide(1220, 610, 30)
  await pace(8000, 0, async () => { await scrollTo(1500, 1200) })       // proof feed: PayoutConfirmed on top
})

// ── 8 · miss (circle page, then score page of the member who missed) ──
await segment('08_miss', async () => {
  sh('pnpm -s demo contribute --skip 2')
  const closeAt = sh(`cast call --rpc-url $CREDITCOIN_RPC_URL ${env.VITE_KITTY_LEDGER_ADDRESS} "closeHeight(uint256,uint32)(uint64)" 1 2`).trim().split(' ')[0]
  await scrollTo(0, 800); await glide(700, 330, 20)
  await pace(7000, 0, async () => { attestTo(closeAt); sh('pnpm -s worker --once') })
  await sleep(6000)                                                      // page repaints: missed tag, band
  await pace(19000, 0, async () => { await open(base + `/score/${M2}`); await glide(420, 520, 30) })
})

// ── 9 · steward (terminal: decision log + cited explanation) ──
await segment('09_steward', async () => {
  const dump = `node -e 'const l=JSON.parse(require("fs").readFileSync("worker/steward.world.json","utf8")).slice(-6);for(const e of l){console.log(e.at.slice(11,19)+"  "+e.kind.padEnd(7)+" "+e.summary);const ev=Object.entries(e.evidence).slice(0,5).map(([k,v])=>k+"="+v).join("  ");console.log("          "+ev);for(const t of (e.txs||[]).slice(0,1))console.log("          "+t.chain+" tx "+t.hash)}' && echo && pnpm -s explain "what did you do this round, and why?"`
  await terminal('kitty — steward · decision log', 'pnpm explain "what did you do this round, and why?"', dump, { lineDelay: 140, maxLines: 40 })
})

// ── 10 · attack lab (live runs) ──
const runScenario = async (i, wait) => {
  const run = page.getByRole('button', { name: /^Run$/ })
  const b = run.nth(i); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox()
  if (bb) await glide(bb.x + bb.width / 2, bb.y + bb.height / 2, 20)
  await b.click({ timeout: 60000 })   // buttons disable while a scenario runs, so this naturally waits its turn
  await sleep(wait)
}
await segment('10_attack_a', async () => {
  await open(base + '/lab')
  await runScenario(0, 3000)    // replay
  await runScenario(1, 5000)    // spoofEmitter
})
await segment('10_attack_b', async () => {
  await runScenario(5, 4000)    // stealFromSteward
  await runScenario(6, 5000)    // fireTheAgent
})

// ── 11 · credit ──
await segment('11_credit', async () => {
  await open(base + `/score/${M0}`)
  const connect = page.getByRole('button', { name: /Connect/ })
  if (await connect.count()) { const bb = await connect.first().boundingBox(); if (bb) await glide(bb.x + bb.width / 2, bb.y + bb.height / 2, 20); await connect.first().click(); await sleep(1500) }
  await glide(420, 520, 30)
  await pace(9000, 0, async () => { await scrollTo(600, 1100) })
  await pace(15000, 0, async () => { await open(base + '/borrow'); await glide(520, 520, 30) })
})

// ── 12 · depth ──
await segment('12_depth', async () => {
  await open(base + '/architecture')
  await glide(700, 420, 30)
  await pace(8000, 0, async () => { await scrollTo(700, 1500) })
  await pace(18000, 0, async () => { await scrollTo(1400, 1500) })
})

// ── 13 · close card ──
await segment('13_close', async () => {
  await open(`${CARDS}/title.html?eyebrow=${encodeURIComponent('BUIDL CTC 2026 Fall · DeFi track')}&title=${encodeURIComponent('Savings circles where every payment is <em>proven</em>, not promised.')}&sub=${encodeURIComponent('Run by an agent whose only power is proof.')}&footr=${encodeURIComponent('100 contract tests · 20 agent tests · 8 attack scenarios · live-precompile verified')}&on=24`)
})

if (page) await page.close()
await ctx.close(); await browser.close()
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1))
console.log('recorded', timeline.length, 'segments, total', timeline.reduce((a, t) => a + t.seconds, 0).toFixed(1) + 's')
