// Records a narrated backup demo of the dashboard against the local lab world.
// Segment timing follows the TTS clip durations; on-chain actions are driven from here.
import { chromium } from '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/shots/node_modules/playwright/index.mjs'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
const S = '/tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad'
const REPO = '/home/prashant/projects/kitty'
const dur = JSON.parse(fs.readFileSync(`${S}/narration/durations.json`, 'utf8'))
const env = Object.fromEntries(fs.readFileSync(`${REPO}/web/.env.local`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split('=')))
const base = 'http://127.0.0.1:5173'
const M0 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', M2 = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const labEnv = { ...process.env, KITTY_MODE: 'local', SEPOLIA_RPC_URL: 'http://127.0.0.1:8545', CREDITCOIN_RPC_URL: 'http://127.0.0.1:8546', PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', SOURCE_CHAIN_KEY: '1', WORKER_STATE_FILE: 'state.lab.json',
  TEST_USD_ADDRESS: env.VITE_TEST_USD_ADDRESS, KITTY_VAULT_ADDRESS: env.VITE_KITTY_VAULT_ADDRESS, KITTY_LEDGER_ADDRESS: env.VITE_KITTY_LEDGER_ADDRESS, FAKE_VAULT_ADDRESS: env.VITE_FAKE_VAULT_ADDRESS }
const sh = (cmd) => execSync(cmd, { cwd: REPO, env: labEnv, stdio: 'pipe' }).toString()
const bg = (cmd) => new Promise((res) => { const p = spawn('bash', ['-c', cmd], { cwd: REPO, env: labEnv, stdio: 'ignore' }); p.on('exit', res) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const timeline = [] // {name, seconds}
const t0 = Date.now()
let segStart = t0
async function segment(name, action) {
  segStart = Date.now()
  const want = (dur[name] + 0.6) * 1000
  await action()
  const spent = Date.now() - segStart
  if (spent < want) await sleep(want - spent)
  timeline.push({ name, seconds: (Date.now() - segStart) / 1000 })
  console.log(name, timeline.at(-1).seconds.toFixed(1) + 's')
}
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark', recordVideo: { dir: `${S}/video`, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
const go = async (path) => { await page.goto(base + path, { waitUntil: 'networkidle' }); await sleep(800) }
const scrollTo = async (y, ms = 900) => { await page.evaluate(([y, ms]) => window.scrollTo({ top: y, behavior: 'smooth' }), [y, ms]); await sleep(ms) }

await segment('01_problem', async () => { await go('/') })
await segment('02_idea', async () => { await scrollTo(520, 1200) })
await segment('03_circle', async () => { await go('/circle/1') })
await segment('04_pay', async () => {
  await scrollTo(560, 1000)
  // members 1 and 2 pay round 1 on the source chain (member 0 already paid, late, via the lab)
  sh('pnpm -s demo contribute --skip 0')
})
await segment('05_prove', async () => {
  await scrollTo(1300, 900)
  await bg('pnpm -s worker --once') // batch proof → recordContributions → closeRound → payout → proof-back
  await sleep(2000)
})
await segment('06_close', async () => { await scrollTo(430, 1000); await sleep(500); await scrollTo(1250, 1200) })
await segment('07_miss', async () => {
  // round 2: member 2 misses; attest deadline + grace on the mock ChainInfo; worker closes the round
  sh('pnpm -s demo contribute --skip 2')
  const closeAt = sh(`cast call --rpc-url $CREDITCOIN_RPC_URL ${env.VITE_KITTY_LEDGER_ADDRESS} "closeHeight(uint256,uint32)(uint64)" 1 2`).trim().split(' ')[0]
  sh(`cast send --rpc-url $CREDITCOIN_RPC_URL --private-key $PRIVATE_KEY 0x0000000000000000000000000000000000000fD3 "setAttestedHeight(uint64,uint64)" 1 ${closeAt} >/dev/null`)
  await bg('pnpm -s worker --once')
  await go(`/score/${M2}`)
})
await segment('08_attack', async () => {
  await go('/lab')
  const run = page.getByRole('button', { name: /^Run$/ })
  await run.nth(0).click(); await sleep(6000)
  await run.nth(1).click(); await sleep(7000)
})
await segment('09_score', async () => { await go(`/score/${M0}`); await sleep(2500); await go('/borrow') })
await ctx.close(); await browser.close()
fs.writeFileSync(`${S}/video/timeline.json`, JSON.stringify(timeline, null, 1))
const files = fs.readdirSync(`${S}/video`).filter((f) => f.endsWith('.webm'))
console.log('video', files, 'total', ((Date.now() - t0) / 1000).toFixed(1) + 's')
