import type { ReactNode } from 'react'

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'mint' | 'amber' | 'rose' | 'sky' }) {
  const color = tone ? `var(--${tone})` : 'var(--ink)'
  return (
    <div className="panel-2 px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mono text-2xl font-semibold" style={{ color }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

export function Tag({ tone, children, title }: { tone: 'mint' | 'amber' | 'rose' | 'sky' | 'muted'; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone === 'muted' ? '' : tone}`} title={title}>{children}</span>
}

/** 48-block progress bar (Saving Circles pattern, re-implemented). Fills by source-chain blocks elapsed in the round. */
export function BlockProgress({ start, deadline, now, attested }: { start: bigint; deadline: bigint; now?: bigint; attested?: bigint }) {
  const total = 48
  const span = Number(deadline - start) || 1
  const elapsed = now === undefined ? 0 : Math.max(0, Math.min(span, Number(now - start)))
  const att = attested === undefined ? 0 : Math.max(0, Math.min(span, Number(attested - start)))
  const filled = Math.round((elapsed / span) * total)
  const attFilled = Math.round((att / span) * total)
  return (
    <div>
      <div className="blocks" aria-hidden>
        {Array.from({ length: total }, (_, i) => <i key={i} className={i < attFilled ? 'on' : i < filled ? 'late' : ''} />)}
      </div>
      <div className="mt-1 flex justify-between text-[11px] mono" style={{ color: 'var(--muted)' }}>
        <span>round opens · block {String(start)}</span>
        <span><i className="dot" style={{ background: 'var(--mint)' }} /> attested&nbsp;&nbsp;<i className="dot" style={{ background: 'var(--amber)' }} /> mined, not yet attested</span>
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
