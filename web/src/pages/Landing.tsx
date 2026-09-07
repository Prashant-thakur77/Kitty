import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Layers, Clock3, BadgeCheck } from 'lucide-react'
import { useCircleCount, useGlobalStats } from '../hooks'
import { Stat } from '../components/ui'
import { cfg } from '../config'

export function Landing() {
  const { data: count } = useCircleCount()
  const st = useGlobalStats()
  const latest = count && (count as bigint) > 0n ? String(count) : undefined
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20">
      <section className="grid gap-8 py-12 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <div className="eyebrow mb-3">Rotating savings · Ethereum money · Creditcoin rules</div>
          <h1 className="text-4xl leading-tight md:text-5xl">Savings circles where every payment is <span style={{ color: 'var(--mint)' }}>proven</span>, not promised.</h1>
          <p className="mt-4 max-w-[60ch] text-lg" style={{ color: 'var(--muted)' }}>
            Chit funds, susu, tandas and chamas run on trust in a treasurer. Kitty keeps the money in stablecoins on Ethereum and puts the rules on Creditcoin,
            fed only by transactions the Attestcoin Protocol has verified. No treasurer, no oracle operator, no bridge.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={latest ? `/circle/${latest}` : '/circles'} className="btn btn-mint no-underline">Open a live circle <ArrowRight size={16} /></Link>
            <Link to="/lab" className="btn no-underline">Try to cheat it</Link>
            <a href={cfg.repo} target="_blank" rel="noreferrer" className="btn btn-ghost no-underline">Source</a>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Proven payments" value={st.proven} tone="mint" />
          <Stat label="On time" value={`${st.onTimePct}%`} />
          <Stat label="Missed" value={st.missed} tone={st.missed ? 'rose' : undefined} />
          <Stat label="tUSD settled" value={st.settled.toLocaleString()} sub={`${st.batched} tx in ${st.batches} batch proofs`} tone="sky" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { icon: <Layers size={18} />, t: '1 · Pay on Ethereum', d: 'Members pay the installment into a tiny escrow vault on Sepolia. The vault only holds money and emits events; it knows nothing about circles.' },
          { icon: <ShieldCheck size={18} />, t: '2 · Prove on Creditcoin', d: 'After the attestor network attests the block, one batch proof for the whole round is verified by the block-prover precompile in a single call, then decoded and bound to the vault, the member and the round.' },
          { icon: <Clock3 size={18} />, t: '3 · Settle by attested time', d: 'The round closes when everyone has paid, or when the deadline block is attested. Missed payments become permanent credit history; the rotation recipient is deterministic and the payout is proven back.' },
        ].map((s) => (
          <div key={s.t} className="panel p-5">
            <div className="mb-2 flex items-center gap-2" style={{ color: 'var(--mint)' }}>{s.icon}<span className="font-semibold" style={{ color: 'var(--ink)' }}>{s.t}</span></div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{s.d}</p>
          </div>
        ))}
      </section>

      <section className="panel mt-8 grid gap-4 p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="flex items-center gap-2" style={{ color: 'var(--mint)' }}><BadgeCheck size={18} /><span className="font-semibold" style={{ color: 'var(--ink)' }}>Kitty Score</span></div>
          <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>
            500 base, +15 per on-time installment, −20 per late, −120 per missed, clamped to 300–850. Every input is a proven transaction or an attested deadline, so any Creditcoin lender can read it without trusting Kitty's operator.
          </p>
        </div>
        <Link to="/score" className="btn no-underline">Look up a score</Link>
      </section>
    </main>
  )
}
