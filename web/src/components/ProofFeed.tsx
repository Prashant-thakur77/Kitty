import { useProofFeed } from '../hooks'
import { cfg } from '../config'

const tone: Record<string, string> = {
  BatchVerified: 'var(--sky)', ContributionRecorded: 'var(--mint)', ContributionMissed: 'var(--rose)', RoundClosed: 'var(--amber)',
  PayoutConfirmed: 'var(--mint)', CircleCreated: 'var(--muted)', RoundOpened: 'var(--muted)', CircleCompleted: 'var(--sky)',
}

export function ProofFeed({ circleId }: { circleId?: bigint }) {
  const items = useProofFeed(circleId)
  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Proof feed · KittyLedger events on Creditcoin</h3>
        <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{items.length} events</span>
      </div>
      {items.length === 0 && <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>No events yet. Once a member contributes on Sepolia and the block is attested, the worker submits one batch proof per round and the entries appear here.</p>}
      <ul className="mt-2 grid gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.tx}-${i}`} className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm" style={{ background: '#0f151d', border: '1px solid var(--line)' }}>
            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: tone[it.kind] ?? 'var(--muted)' }} />
            <div className="min-w-0 flex-1">
              <div>{it.text}</div>
              <div className="mono text-[11px]" style={{ color: 'var(--muted)' }}>
                block {String(it.block)} · <a href={`${cfg.creditcoinExplorer}/tx/${it.tx}`} target="_blank" rel="noreferrer" style={{ color: 'var(--sky)' }}>{it.tx.slice(0, 14)}…</a>
                {it.qid && <> · query {it.qid.slice(0, 12)}…</>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
