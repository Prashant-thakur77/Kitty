import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useCircle, useCircleCount, useGlobalStats, useLedgerEvents } from '../hooks'
import { CountUp, Reveal, Spotlight } from '../components/motion'
import { Canvas3D, useCan3D } from '../three/Canvas3D'
import { cfg } from '../config'

// three.js lives in its own chunk: Canvas3D fetches it only when the hero decides to render
const heroScene = () => import('../three/HeroScene')
const HERO_CAMERA = { position: [0, 4.1, 8.0] as [number, number, number], fov: 33 }

const TRUST = [
  ['Holds the money', 'Treasurer', 'One contract, one chain', 'Escrow vault on Ethereum'],
  ['Knows who paid', "Treasurer's notebook", 'Same contract', 'Attestcoin-proven txs on Creditcoin'],
  ['Decides the deadline', 'Treasurer', 'block.timestamp / admin', 'Attested source-chain block height'],
  ['Picks who gets the pot', 'Treasurer / lottery', 'VRF oracle', 'Deterministic, or by proven score'],
  ['Credit history', 'None', 'None', 'Kitty Score, readable by any lender'],
] as const

const STEPS = [
  { n: '01', t: 'Pay on Ethereum', d: 'Members pay the installment into a tiny escrow vault. It holds money and emits an event. It knows nothing about circles.', k: 'KittyVault · Sepolia' },
  { n: '02', t: 'Attest', d: 'The attestor network attests the Sepolia block on Creditcoin. Nothing moves until it does. That attestation is the only clock Kitty uses.', k: '0x0FD3 · ChainInfo' },
  { n: '03', t: 'Prove the whole round', d: 'One batch proof for up to ten payments, verified in a single call by the block-prover precompile, then decoded and bound to the vault, the member and the round.', k: '0x0FD2 · block prover' },
  { n: '04', t: 'Settle, score, pay out', d: 'The round closes when everyone has paid or the deadline block is attested. Misses become permanent history. The payout is proven back before it shows as paid.', k: 'KittyLedger · Creditcoin' },
]

export function Landing() {
  const { data: count } = useCircleCount()
  const st = useGlobalStats()
  const { items } = useLedgerEvents()
  const latest = count && (count as bigint) > 0n ? String(count) : undefined
  const { circle } = useCircle(latest ? BigInt(latest) : undefined)
  const can3D = useCan3D()
  const heroRef = useRef<HTMLElement>(null)
  const feed = items.filter((i) => ['ContributionRecorded', 'BatchVerified', 'RoundClosed', 'PayoutConfirmed', 'ContributionMissed'].includes(i.kind)).slice(0, 14)
  const marquee = feed.length ? [...feed, ...feed] : []

  return (
    <main>
      {/* ── hero ── */}
      <section ref={heroRef} className={`hero${can3D ? ' hero-3d' : ''}`}>
        {!can3D && <div className="streak" aria-hidden />}
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 md:pt-24 lg:grid lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-8">
          <div>
            <Reveal i={0}>
              <Link to="/lab" className="pill mint live no-underline" style={{ fontSize: 13, padding: '.3rem .8rem .3rem .7rem' }}>
                Attack lab open · 8 scenarios, 0 exploits <ArrowRight size={13} />
              </Link>
            </Reveal>
            <Reveal i={1}>
              <h1 className="hero-title mt-7 max-w-[16ch]">Savings circles where every payment is <em>proven</em>, not promised.</h1>
            </Reveal>
            <Reveal i={2}>
              <p className="lede mt-7">
                Chit funds, susu, tandas and chamas run on trust in a treasurer. Kitty keeps the money in stablecoins on Ethereum and puts the rules on Creditcoin, fed only by transactions the Attestcoin Protocol has cryptographically verified. No treasurer. No oracle operator. No bridge.
              </p>
            </Reveal>
            <Reveal i={3} className="mt-9 flex flex-wrap items-center gap-3">
              <Link to={latest ? `/circle/${latest}` : '/circles'} className="btn btn-mint no-underline">Open a live circle <ArrowRight size={16} className="arrow" /></Link>
              <Link to="/lab" className="btn no-underline">Try to cheat it</Link>
              <a href={cfg.repo} target="_blank" rel="noreferrer" className="btn btn-ghost no-underline">Source <ArrowUpRight size={15} /></a>
            </Reveal>
          </div>
          {can3D && (
            <div className="hero-scene" aria-hidden>
              <Canvas3D scene={heroScene} sceneProps={{ members: circle?.members, items }} camera={HERO_CAMERA} pointerFrom={heroRef} />
            </div>
          )}
        </div>
        <div className="rule" />
      </section>

      {/* ── live proof marquee ── */}
      {marquee.length > 0 && (
        <div className="marquee border-b py-3" style={{ borderColor: 'var(--line)' }} aria-label="Live proof feed">
          <div className="track">
            {marquee.map((it, i) => (
              <span key={i} className="pill" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
                <i className="dot" style={{ background: it.kind === 'ContributionMissed' ? 'var(--rose)' : it.kind === 'BatchVerified' ? 'var(--sky)' : 'var(--mint)' }} />
                {it.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── numbers ── */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Payments proven', v: st.proven, tone: 'var(--mint)', sub: 'each one verified by 0x0FD2' },
            { label: 'On time', v: st.onTimePct, tone: 'var(--ink)', sub: 'by attested block height', suffix: '%' },
            { label: 'Missed', v: st.missed, tone: st.missed ? 'var(--rose)' : 'var(--ink)', sub: 'permanent, consented, proof-backed' },
            { label: 'tUSD settled', v: st.settled, tone: 'var(--sky)', sub: `${st.batched} tx across ${st.batches} batch proofs` },
          ].map((s, i) => (
            <Reveal key={s.label} i={i + 1}>
              <Spotlight className="panel px-5 py-5">
                <div className="eyebrow">{s.label}</div>
                <div className="mono mt-2 text-4xl font-semibold" style={{ color: s.tone }}>
                  <CountUp value={s.v} />{s.suffix ?? ''}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{s.sub}</div>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── statement ── */}
      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="eyebrow mb-5">Why Creditcoin, why Attestcoin</div>
        <p className="statement max-w-[34ch]">
          Every number on a Kitty Score is a proven transaction or an attested deadline.
          <span className="dim"> That is credit history a lender can underwrite against, for people the banking system has never seen.</span>
        </p>
      </section>

      {/* ── how it works: a rail with the block-tick motif ── */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow">How a round settles</div>
            <h2 className="mt-2 text-3xl md:text-4xl">Four steps. Two chains. Zero trust in people.</h2>
          </div>
          <Link to="/architecture" className="btn btn-ghost no-underline hidden sm:inline-flex">Architecture <ArrowUpRight size={15} /></Link>
        </div>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} i={i + 1} as="li">
              <Spotlight className="panel flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="mono text-sm" style={{ color: 'var(--mint)' }}>{s.n}</span>
                  <span className="eyebrow" style={{ fontSize: 10 }}>{s.k}</span>
                </div>
                <h3 className="mt-4 text-xl">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{s.d}</p>
                <div className="ticks mt-auto pt-6" aria-hidden>
                  {Array.from({ length: 24 }, (_, k) => <i key={k} className={k < 6 * (i + 1) ? 'on' : ''} />)}
                </div>
              </Spotlight>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ── who you trust ── */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="eyebrow mb-2">Who you have to trust</div>
        <h2 className="text-3xl md:text-4xl">The treasurer, or the proof.</h2>
        <div className="panel mt-6 overflow-x-auto">
          <table>
            <thead><tr><th>Step</th><th>Informal circle</th><th>"ROSCA on-chain" apps</th><th style={{ color: 'var(--mint)' }}>Kitty</th></tr></thead>
            <tbody>
              {TRUST.map((r) => (
                <tr key={r[0]}>
                  <td style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{r[0]}</td>
                  <td style={{ color: 'var(--muted)' }}>{r[1]}</td>
                  <td style={{ color: 'var(--muted)' }}>{r[2]}</td>
                  <td style={{ color: 'var(--ink)' }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── score → credit ── */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <Spotlight className="inset grid gap-6 p-8 md:grid-cols-[1.3fr_1fr] md:items-center md:p-10">
          <div>
            <div className="eyebrow">Kitty Score</div>
            <h2 className="mt-2 text-3xl md:text-4xl">The score is used, not just displayed.</h2>
            <p className="mt-3 max-w-[60ch]" style={{ color: 'var(--muted)' }}>
              500 base. +15 per on-time installment, −20 late, −120 missed, clamped to 300–850. KittyCreditLine lends against it. A soulbound badge renders it on-chain. Any Creditcoin contract can read it without trusting Kitty's operator, because no operator input ever touched it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/score" className="btn no-underline">Look up a score</Link>
              <Link to="/borrow" className="btn btn-mint no-underline">Borrow against it <ArrowRight size={16} className="arrow" /></Link>
            </div>
          </div>
          <div className="mono grid gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            {[['on time', '+15', 'var(--mint)'], ['late', '−20', 'var(--amber)'], ['missed', '−120', 'var(--rose)'], ['range', '300 – 850', 'var(--ink)']].map(([k, v, c]) => (
              <div key={k} className="panel-2 flex items-center justify-between px-4 py-3"><span>{k}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span></div>
            ))}
          </div>
        </Spotlight>
      </section>
    </main>
  )
}
