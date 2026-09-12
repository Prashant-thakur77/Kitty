import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, Printer } from 'lucide-react'
import { cfg } from '../config'
import { EASE_OUT } from '../components/motion'
import { RotationWheel, WheelLegend } from '../components/RotationWheel'
import { Blockie, Stat, Tag } from '../components/ui'
import { useAttestation, useCircle, useCircleCount, useGlobalStats, useRoundDetail, useRounds, useVaultPayments } from '../hooks'
import { COUNTS } from '../lib/counts'
import { short } from '../lib/format'
import stewardSample from '../data/steward.sample.json'

function Slide({ eyebrow, title, children, big, dense, wide }: { eyebrow?: string; title: string; children?: ReactNode; big?: boolean; dense?: boolean; wide?: boolean }) {
  return (
    <section className="slide">
      <div className={`w-full ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}>
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className={big ? 'text-5xl md:text-7xl' : dense ? 'text-3xl md:text-4xl' : 'text-4xl md:text-5xl'}>{title}</h1>
        <div className={dense ? 'mt-4 text-base leading-relaxed' : 'mt-6 text-lg leading-relaxed'} style={{ color: 'var(--muted)' }}>{children}</div>
      </div>
    </section>
  )
}
const Li = ({ children }: { children: ReactNode }) => <li className="mb-2 max-w-[60ch]" style={{ color: 'var(--ink)' }}>{children}</li>

/* ───────────── slide 4: the first circle, read from whatever ledger cfg points at ───────────── */

/** The Delhi Chit Circle's members on CC3 Testnet (KittyLedger getCircle(1) on the final ledger 0xC2A1…F276), so the wheel never prints empty when the chain cfg points at has no circle. */
const SAMPLE_MEMBERS = ['0xB077B088E668386Bc57af87F175d250f459f0791', '0x128AC52048072BeEb5b930cC5D9F8c91EDe5BEbA', '0x8FFb6727EAe2F3C5EF9F68aC0aC2dA0CAEc2D1dA'] as const
/** Round 0 of the Delhi Chit Circle on the final ledger, from docs/TESTNET_LOG.md: one batch of three, closed, paid out and proven back. */
const SAMPLE = { name: 'Delhi Chit Circle', circles: 1, proven: 3, batches: 1, settled: 300, attested: 11687401n }

function LiveCircleSlide() {
  const count = useCircleCount()
  const { circle, round, isLoading, error } = useCircle(1n)
  const detail = useRoundDetail(1n, circle?.currentRound, circle?.members)
  const rounds = useRounds(1n, circle?.members.length ?? 0)
  const payments = useVaultPayments(1n, circle?.currentRound, circle?.startHeight)
  const stats = useGlobalStats()
  const { attested } = useAttestation()
  const circles = count.data !== undefined ? Number(count.data) : undefined
  // Degrade: no ledger, an unreachable RPC, or a chain with no circle yet → the testnet record stands in, labelled as such.
  const live = !!circle && !error && circle.members.length > 0
  const sub = live ? 'live · Creditcoin CC3 Testnet' : 'testnet record · 12 Sep 2026'
  const members = live ? circle.members : SAMPLE_MEMBERS
  const recipient = live ? (circle.rotation === 1 ? round?.recipient : circle.members[circle.currentRound]) : SAMPLE_MEMBERS[0]
  const name = live ? circle.name : SAMPLE.name
  const n = (v: number | undefined, fallback: number) => (live && v !== undefined ? v : fallback)
  return (
    <Slide eyebrow="Live loop · pay → attest → prove → verify → close → pay out → prove back" title={`The first circle, live: ${name}`} dense wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
        <div>
          <div style={{ maxWidth: 380, margin: '0 auto' }}>
            <RotationWheel members={members} currentRound={live ? circle.currentRound : 1} active={live ? circle.status === 0 : true} byScore={live ? circle.rotation === 1 : true}
              recipient={recipient && recipient !== '0x0000000000000000000000000000000000000000' ? recipient : undefined} rounds={live ? rounds : undefined} roundStatus={live ? round?.status : 0}
              contributions={live ? detail.contributions : undefined} scores={live ? detail.scores : undefined} records={live ? detail.records : undefined}
              payments={live ? payments : []} pot={live ? round?.pot : 0n} loading={live ? !round || !detail.contributions : false} />
          </div>
          <div className="mt-2"><WheelLegend /></div>
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>{live ? `${members.length} members · ${(Number(circle.contribution) / 1e6).toLocaleString()} tUSD a round · rotation ${circle.rotation === 1 ? 'by Kitty Score' : 'fixed'} · round ${circle.currentRound + 1} of ${members.length}` : isLoading ? 'reading circle #1 from Creditcoin…' : 'no circle on this ledger yet — the wheel shows the testnet circle as recorded'}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Circles" value={n(circles, SAMPLE.circles)} sub={sub} />
          <Stat label="Payments proven" value={n(stats.proven, SAMPLE.proven)} sub={live ? `${stats.onTimePct}% on time` : 'all on time'} tone="mint" />
          <Stat label="Batch proofs" value={n(stats.batches, SAMPLE.batches)} sub={live ? `${stats.batched} tx through 0x0FD2` : '3 tx through 0x0FD2 in one call'} tone="sky" />
          <Stat label="tUSD settled" value={n(stats.settled, SAMPLE.settled)} sub="payouts proven back" tone="mint" />
          <Stat label="Attested Sepolia block" value={<span className="text-xl">{String(attested ?? SAMPLE.attested)}</span>} sub={attested !== undefined ? 'latest · 0x0FD3' : 'close block · testnet record'} tone="amber" />
          <Stat label="KittyLedger" value={<a href={`${cfg.creditcoinExplorer}/address/${cfg.ledger}`} target="_blank" rel="noreferrer" className="text-xl">{short(cfg.ledger)}</a>} sub="Creditcoin CC3 Testnet · Blockscout" />
        </div>
      </div>
    </Slide>
  )
}

/* ───────────── slide 5: the depth claim, next to the code it points at ───────────── */

/** Verbatim from src/asc/KittyLedger.sol, `recordContributions` (grep verifyAndEmit / BatchVerified for the current line numbers). */
const LEDGER_QUOTE = `function recordContributions(
    uint64 chainKey,
    uint64[] calldata heights,
    bytes[] calldata encodedTxs,
    INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
    INativeQueryVerifier.ContinuityProof calldata continuity
) external {
    bytes32[] memory queryIds = _prepareBatch(chainKey, heights, encodedTxs, merkleProofs);
    uint256 n = heights.length;

    bool ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity);
    if (!ok) revert ProofRejected();

    uint64 lo = type(uint64).max;
    uint64 hi;
    for (uint256 i; i < n; ++i) {
        processedQueries[queryIds[i]] = true;
        _recordContribution(chainKey, queryIds[i], heights[i], encodedTxs[i]);
        if (heights[i] < lo) lo = heights[i];
        if (heights[i] > hi) hi = heights[i];
    }
    emit BatchVerified(chainKey, lo, hi, n);
}`

/* ───────────── slide 7: the steward's last three real decisions ───────────── */

type Decision = { at: string; kind: string; summary: string; evidence: Record<string, unknown>; txs?: { chain: 'source' | 'creditcoin'; hash: string }[] }
const KIND_TONE: Record<string, 'mint' | 'sky' | 'muted' | 'rose'> = { prove: 'mint', payout: 'mint', confirm: 'mint', close: 'sky', wait: 'muted', skip: 'rose', error: 'rose' }
const STEWARD = stewardSample as { mode: string; recordedAt: string; entries: Decision[] }
const LAST_DECISIONS = STEWARD.entries.slice(-3)
const fmtVal = (v: unknown) => { const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v); return /^0x[0-9a-fA-F]{20,}$/.test(s) ? `${s.slice(0, 10)}…${s.slice(-4)}` : s }
const fmtAt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' }

function DecisionCard({ d }: { d: Decision }) {
  const ex = (chain: 'source' | 'creditcoin') => (chain === 'source' ? cfg.sepoliaExplorer : cfg.creditcoinExplorer)
  return (
    <div className="panel-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={KIND_TONE[d.kind] ?? 'muted'}>{d.kind}</Tag>
        <span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>{fmtAt(d.at)}</span>
      </div>
      <div className="mt-1.5" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{d.summary}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(d.evidence).map(([k, v]) => (
          <span key={k} className="mono rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}><span style={{ color: 'var(--muted)' }}>{k}=</span>{fmtVal(v)}</span>
        ))}
      </div>
      {d.txs && d.txs.length > 0 && (
        <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {d.txs.map((t, j) => <a key={j} href={`${ex(t.chain)}/tx/${t.hash}`} target="_blank" rel="noreferrer">{t.chain === 'source' ? 'sepolia' : 'creditcoin'} {t.hash.slice(0, 12)}…</a>)}
        </div>
      )}
    </div>
  )
}

/* ───────────── slide 9: the final ledger's transactions, from docs/TESTNET_LOG.md ───────────── */

const CC = 'https://creditcoin-testnet.blockscout.com/tx/'
const SEP = 'https://sepolia.etherscan.io/tx/'
const TXS: { action: string; chain: 'Creditcoin' | 'Sepolia'; hash: `0x${string}`; gas: number }[] = [
  { action: 'deploy KittyLedger · the final ledger, 0xC2A1…F276', chain: 'Creditcoin', hash: '0x2199459939956219c713c4fe59c800713798e4bd922312d5a0a93a50fd7ac7f5', gas: 4901416 },
  { action: 'recordContributions round 0 · the whole round, batch of 3, one 0x0FD2 call', chain: 'Creditcoin', hash: '0xac2a637fb248dfc8b74801b8ec993be4d7c3831d083774ef261e84cdb9652fe9', gas: 888573 },
  { action: 'closeRound 0 · everyone paid, early close, rotation by score', chain: 'Creditcoin', hash: '0x53cbb51ddf2337bae79f33870d591a72aefcf8ca930e9edda5a12ac882277bbb', gas: 354326 },
  { action: 'payout round 0 · 300 tUSD to member 0', chain: 'Sepolia', hash: '0xfee3061882b31b7adc8603fd3bdec728b9c777a5760b11ec346ed0e2b87263c3', gas: 64821 },
  { action: 'confirmPayout round 0 · proven back through 0x0FD2', chain: 'Creditcoin', hash: '0x92344d886c25f2e14a573f9934407797f0379bdd100bda4e5a5101000174ba88', gas: 386582 },
  { action: 'recordContributions · 8 payments from circles 2 and 3 in ONE precompile call', chain: 'Creditcoin', hash: '0xa7310f0081f8e3254b3ba511526196e8bf34cdb5d203f481fb05636815c1f7fa', gas: 1936724 },
  { action: 'recordContributions circle 3 round 1 · proven from the browser by the member, no operator', chain: 'Creditcoin', hash: '0x7b8fdaab59af28c7df083528702b02ff5babe8260365a9ec2d0032d5cb8861b5', gas: 401366 },
  { action: 'closeRound circle 1 round 1 · attested deadline + 64, a real miss with its attestation', chain: 'Creditcoin', hash: '0xef146316d55e42f20a54a8d97935d711769d3f4571cf0fd760af4471bd9f01ca', gas: 362992 },
]

const slides: ReactNode[] = [
  <Slide key={0} eyebrow="BUIDL CTC 2026 Fall · DeFi" title="Kitty" big>Savings circles where every payment is proven, not promised.<br />Ethereum stablecoins · settled and credit-scored on Creditcoin · via the Attestcoin Protocol</Slide>,
  <Slide key={1} eyebrow="Problem" title="Hundreds of millions save in circles nobody can see.">
    <ul className="list-disc pl-5"><Li>Chit funds, susu, tandas, chamas, stokvels: ten friends, one pot a month.</Li><Li>They fail two ways: the treasurer runs, or a member stops paying and nobody outside the group ever knows.</Li><Li>Ten years of perfect payments builds zero formal credit history.</Li></ul></Slide>,
  <Slide key={2} eyebrow="Trust today" title="Who you have to trust">
    <table><thead><tr><th>Step</th><th>Informal circle</th><th>“ROSCA on-chain” apps</th><th>Kitty</th></tr></thead><tbody>
      <tr><td>Holds the money</td><td>Treasurer</td><td>One contract on one chain</td><td>Escrow vault on Ethereum</td></tr>
      <tr><td>Knows who paid</td><td>Treasurer’s notebook</td><td>Same contract</td><td>Attestcoin-proven txs on Creditcoin</td></tr>
      <tr><td>Decides the deadline</td><td>Treasurer</td><td>block.timestamp / admin</td><td>Attested source-chain block height</td></tr>
      <tr><td>Picks the recipient</td><td>Treasurer / lottery</td><td>VRF oracle</td><td>Fixed order or by proven score</td></tr>
      <tr><td>Credit history</td><td>None</td><td>None</td><td>Kitty Score, readable by any lender</td></tr></tbody></table></Slide>,
  <Slide key={3} eyebrow="Solution" title="Money on Ethereum. Rules on Creditcoin. Proofs in between.">
    <ul className="list-disc pl-5"><Li>Members pay into a minimal escrow vault on Sepolia.</Li><Li>The attestor network attests the block; one batch proof covers the whole round.</Li><Li>KittyLedger verifies through precompile 0x0FD2, decodes and binds every payment, enforces deadlines from 0x0FD3.</Li><Li>Payouts are proven back. “Paid” is never an operator’s word.</Li><Li>Any member can prove a round from the browser: the Proof Builder serves CORS, the ledger doesn’t care who submits.</Li></ul></Slide>,
  <LiveCircleSlide key={4} />,
  <Slide key={5} eyebrow="Attestcoin depth" title="What the ledger actually checks" dense wide>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
      <ul className="list-disc pl-5 text-[14.5px]"><Li>Batch <span className="mono">verifyAndEmit</span>: up to 10 txs, one continuity proof, one call for payments pooled across every open circle, preflighted free with the view verify, 24% cheaper than singles on the live 0x0FD2.</Li><Li>EvmV1Decoder: receipt status 1, exactly one Contributed log, emitter = registered vault, tx.to = vault, tx.from = member, exact amount, current round.</Li><Li>Query id = keccak(chainKey ‖ height ‖ txIndex), same as ASCBase; per-circle chain key validated with <span className="mono">get_chain_by_key</span>; vault allowlist keyed by chain.</Li><Li>Deadlines from attested height: <span className="mono">is_height_attested(chainKey, deadline + 64)</span>; a miss records the attestation that proved it.</Li><Li>The dashboard asks 0x0FD3 which attestation covers a payment: <span className="mono">find_lowest_attested_after</span>, <span className="mono">get_attestation_bounds</span>.</Li><Li>Proven against the live precompile before deploying: a real Sepolia proof → <span className="mono">0x0FD2.verify = true</span>; tampered bytes and a wrong chain key revert (<span className="mono">pnpm verify:live</span>).</Li></ul>
      <div className="panel-2 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}><span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>src/asc/KittyLedger.sol · recordContributions</span><Tag tone="sky">one precompile call</Tag></div>
        <pre className="log m-0 px-3 py-2" style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{LEDGER_QUOTE}</pre>
      </div>
    </div></Slide>,
  <Slide key={6} eyebrow="Attack lab" title="Eight ways to cheat: six decoded rejections, two accepted by design">
    <ul className="list-disc pl-5"><Li>Replay → QueryAlreadyProcessed</Li><Li>Fake vault with a perfect event → WrongEmitter</Li><Li>Same proof, chain key 3 → WrongChain</Li><Li>Included but reverted tx → SourceTxFailed</Li><Li>Paid after the deadline → accepted, flagged late, −20</Li><Li>Steal the steward’s key → NotOperator / OwnableUnauthorizedAccount / RoundStillOpenOnSource / VaultNotTrusted</Li><Li>Fire the agent → accepted: the ledger checks the proof, not the caller</Li><Li>Poison the reasoning → three invented figures stripped before display</Li></ul>
    <p className="mt-4 text-base">Reviewed adversarially before submission: only owner-trusted vaults can feed the ledger, nobody can be penalised for a circle they never consented to, a 64-block grace window protects on-time payers from a hostile early close, and pots only go to members who paid this round.</p></Slide>,
  <Slide key={7} eyebrow="Kitty Steward" title="An agent whose only power is proof" dense wide>
    <table className="[&_td]:py-2 [&_th]:py-2 [&_td]:text-[14px]"><thead><tr><th>Layer</th><th>Holds</th><th>What it does</th></tr></thead><tbody>
      <tr><td>1 · The ledger</td><td>final say</td><td>Verified proof, receipt status 1, trusted emitter, right sender and target, exact amount, current round, unseen query id. Any failure: nothing happens.</td></tr>
      <tr><td>2 · Deterministic decisions</td><td>timing only</td><td>Prove now or wait for a fuller batch? Missing the grace window costs 120 points: urgency beats thrift. Decisions logged.</td></tr>
      <tr><td>3 · Cited reasoning</td><td>none</td><td>Claude explains the log in plain language. Any sentence with an uncited or unverifiable figure is stripped before display. No API key: the deterministic sentence, identical behaviour.</td></tr></tbody></table>
    <div className="mt-4 flex items-baseline justify-between gap-3"><span className="eyebrow">The steward's last three decisions · recorded on CC3 Testnet</span><span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>web/src/data/steward.sample.json · {STEWARD.entries.length} entries</span></div>
    <div className="mt-2 grid gap-3 md:grid-cols-3">{LAST_DECISIONS.map((d, i) => <DecisionCard key={i} d={d} />)}</div></Slide>,
  <Slide key={8} eyebrow="Kitty Score → credit" title="The score is used, not just displayed">
    <ul className="list-disc pl-5"><Li>500 base · +15 on time · −20 late · −120 missed · 300–850.</Li><Li>KittyCreditLine on Creditcoin underwrites from the score alone: tier A borrows 100% of proven volume, B 50%, C 20%, D nothing.</Li><Li>A soulbound Kitty Score badge renders live from the ledger, so a lender can read it on any explorer.</Li><Li>Every input is a proven transaction or an attested deadline. This is the data Creditcoin was built to carry.</Li></ul></Slide>,
  <Slide key={9} eyebrow="Live on testnet" title="The first circle has already settled" dense wide>
    <ul className="list-disc pl-5 text-[15px] [&_li]:max-w-[110ch]"><Li>KittyLedger, KittyViewer, KittyUSD, KittyCreditLine and KittyBadge deployed to Creditcoin CC3 Testnet on 12 September 2026 (KittyLedger <span className="mono">0xC2A1…F276</span>); its paired Sepolia vault <span className="mono">0xa27e…DA84</span> is trusted on the ledger; the first circle and all eight attack scenarios ran on the first ledger and vault.</Li><Li>Delhi Chit Circle, three members, 100 tUSD a round, rotation by score: three Sepolia payments, one batch proof of three verified by the live 0x0FD2 in a single call, an early close, a 300 tUSD payout on Sepolia and its proof back to Creditcoin. Then two more circles: eight payments settled in one cross-circle call, a member proving from the browser, and a real miss closed on the attested deadline.</Li><Li>Attack scenarios rerun against the real precompile: the forged chain key is rejected by 0x0FD2 itself. Every transaction is in docs/TESTNET_LOG.md; the hosted dashboard, steward log and attack lab read the same chain.</Li></ul>
    <table className="mt-2 [&_td]:py-[3px] [&_th]:py-1 [&_td]:text-[12.5px] [&_td]:whitespace-nowrap"><thead><tr><th>Action</th><th>Chain</th><th>Transaction</th><th>Gas</th></tr></thead><tbody>
      {TXS.map((t) => (
        <tr key={t.hash}><td style={{ color: 'var(--ink)' }}>{t.action}</td><td>{t.chain}</td><td className="mono"><a href={`${t.chain === 'Sepolia' ? SEP : CC}${t.hash}`} target="_blank" rel="noreferrer">{t.hash.slice(0, 10)}…{t.hash.slice(-6)}</a></td><td className="mono">{t.gas.toLocaleString()}</td></tr>
      ))}
    </tbody></table></Slide>,
  <Slide key={10} eyebrow="Roadmap · CEIP" title="From circles to credit lines">
    <ul className="list-disc pl-5"><Li>Score-gated circle sizes and seat bidding.</Li><Li>Lender integrations on Creditcoin.</Li><Li>Attestcoin writability for payouts once audited; Ethereum mainnet chainKey on CC3 mainnet.</Li><Li>Pot cover through proven-event insurance.</Li></ul></Slide>,
  <Slide key={11} eyebrow="Team" title="Prashant · solo builder">
    <p>Foundry · TypeScript · React. Repo: {cfg.repo}. Contracts on Sepolia and Creditcoin CC3 Testnet; {COUNTS.forge} Foundry tests · {COUNTS.agent} agent tests · {COUNTS.scenarios} attack scenarios end to end in CI; verified against the live 0x0FD2.</p>
    <div className="mt-5 flex flex-wrap items-center gap-3"><Blockie address={SAMPLE_MEMBERS[0]} size={26} /><span className="mono text-sm">{short(SAMPLE_MEMBERS[0])}</span><Tag tone="mint">member 0 · first pot received</Tag><Tag tone="sky">KittyLedger {short(cfg.ledger)}</Tag></div></Slide>,
]

export function Presentation() {
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const next = useCallback(() => { setDir(1); setI((c) => Math.min(c + 1, slides.length - 1)) }, [])
  const prev = useCallback(() => { setDir(-1); setI((c) => Math.max(c - 1, 0)) }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (['ArrowRight', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next() } if (['ArrowLeft', 'Backspace'].includes(e.key)) { e.preventDefault(); prev() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [next, prev])
  const reduced = useReducedMotion()
  return (
    <div>
      <div className="noprint fixed bottom-4 right-4 z-40 flex items-center gap-2 text-xs mono" style={{ color: 'var(--muted)' }} role="group" aria-label="Slide controls">
        <button className="btn" onClick={prev} disabled={i === 0} aria-label="Previous slide"><ArrowLeft size={15} /></button>
        <span aria-live="polite" aria-atomic="true">{i + 1} / {slides.length}</span>
        <button className="btn" onClick={next} disabled={i === slides.length - 1} aria-label="Next slide"><ArrowRight size={15} /></button>
        <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={14} /> Print → PDF</button>
      </div>
      <div className="noprint" style={{ overflowX: 'hidden' }}>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={i} custom={dir}
            initial={reduced ? { opacity: 1 } : { opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, x: dir * -28, transition: { duration: 0.16, ease: EASE_OUT } }}
            transition={{ duration: reduced ? 0 : 0.28, ease: EASE_OUT }}
          >
            {slides[i]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="hidden print:block">{slides}</div>
    </div>
  )
}
