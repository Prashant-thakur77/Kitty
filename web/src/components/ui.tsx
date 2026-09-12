import { useMemo, type ReactNode } from 'react'
import { CountUp } from './motion'

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'mint' | 'amber' | 'rose' | 'sky' }) {
  const color = tone ? `var(--${tone})` : 'var(--ink)'
  return (
    <div className="panel-2 px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mono text-2xl font-semibold" style={{ color }}>{typeof value === 'number' ? <CountUp value={value} /> : value}</div>
      {sub && <div className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

/** `wrap` lets a long tag (> ~24 chars) break onto two lines instead of forcing the page wider on phones. */
export function Tag({ tone, children, title, wrap }: { tone: 'mint' | 'amber' | 'rose' | 'sky' | 'muted'; children: ReactNode; title?: string; wrap?: boolean }) {
  return <span className={`pill ${tone === 'muted' ? '' : tone}${wrap ? ' wrap' : ''}`} title={title}>{children}</span>
}

/** 48-tick scale of the round in source-chain blocks: mint = attested, amber = mined but not yet attested, the tall
 *  white tick is the source head, the rose tick is the deadline. Hover lifts the scale (Rauno-style index). */
export function BlockProgress({ start, deadline, now, attested }: { start: bigint; deadline: bigint; now?: bigint; attested?: bigint }) {
  // Phones get 24 ticks so each stays ≥ 6px wide (48 × 4px is unreadable); decided once, at mount, from the viewport query.
  const total = useMemo(() => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches ? 24 : 48), [])
  const span = Number(deadline - start) || 1
  const pos = (h?: bigint) => (h === undefined ? -1 : Math.round((Math.max(0, Math.min(span, Number(h - start))) / span) * (total - 1)))
  const head = pos(now)
  const att = pos(attested)
  return (
    <div>
      <div className="ticks" aria-hidden>
        {Array.from({ length: total }, (_, i) => {
          const cls = i === total - 1 ? 'deadline' : i === head ? 'head' : i <= att ? 'on' : i <= head ? 'late' : ''
          return <i key={i} className={cls} />
        })}
      </div>
      <div className="mono mt-2 flex flex-wrap justify-between gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
        <span>opens · block {String(start)}</span>
        <span><i className="dot" style={{ background: 'var(--mint)' }} /> attested&nbsp;&nbsp;<i className="dot" style={{ background: 'var(--amber)' }} /> mined, not yet attested&nbsp;&nbsp;<i className="dot" style={{ background: 'var(--ink)' }} /> head&nbsp;&nbsp;<i className="dot" style={{ background: 'var(--rose)' }} /> deadline</span>
        <span>deadline · block {String(deadline)}</span>
      </div>
    </div>
  )
}

export function Blockie({ address, size = 22 }: { address: string; size?: number }) {
  // deterministic 4-colour identicon from the address, no library
  const h = parseInt(address.slice(2, 10), 16)
  const hue = h % 360
  const cells: boolean[] = []
  let x = h
  for (let i = 0; i < 15; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; cells.push(x % 3 !== 0) }
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" style={{ borderRadius: 4, background: `hsl(${hue} 30% 16%)` }} aria-hidden>
      {cells.map((on, i) => {
        const r = Math.floor(i / 3), c = i % 3
        return on ? <g key={i} fill={`hsl(${hue} 70% 62%)`}><rect x={c} y={r} width="1" height="1" /><rect x={4 - c} y={r} width="1" height="1" /></g> : null
      })}
    </svg>
  )
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3"><h3 className="text-sm" style={{ color: 'var(--muted)', fontFamily: 'var(--body)', fontWeight: 600 }}>{title}</h3>{right}</div>
      {children}
    </section>
  )
}
