import { cfg } from '../config'
import type { FeedItem } from '../hooks'
import { Section } from './ui'

const tone: Record<string, string> = {
  BatchVerified: 'var(--sky)', ContributionRecorded: 'var(--mint)', ContributionMissed: 'var(--rose)', RoundClosed: 'var(--amber)',
  PayoutConfirmed: 'var(--mint)', CircleCreated: 'var(--muted)', RoundOpened: 'var(--muted)', CircleCompleted: 'var(--sky)', InviteRedeemed: 'var(--muted)',
}

export function ProofFeed({ items, compact }: { items: FeedItem[]; compact?: boolean }) {
  return (
    <Section title="Proof feed · KittyLedger events on Creditcoin" right={<span className="mono text-xs" style={{ color: 'var(--muted)' }}>{items.length} events</span>}>
      {items.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No events yet. Once a member pays on Sepolia and the block is attested, the worker submits one batch proof per round and rows appear here.</p>}
      <ul className="grid gap-1.5">
        {(compact ? items.slice(0, 8) : items).map((it, i) => (
          <li key={`${it.tx}-${i}`} className="panel-2 flex items-start gap-3 px-3 py-2 text-sm">
            <span className="dot mt-[7px]" style={{ background: tone[it.kind] ?? 'var(--muted)' }} />
            <div className="min-w-0 flex-1">
              <div>{it.text}</div>
              <div className="mono text-[11px]" style={{ color: 'var(--muted)' }}>
                block {String(it.block)} · <a href={`${cfg.creditcoinExplorer}/tx/${it.tx}`} target="_blank" rel="noreferrer">{it.tx.slice(0, 14)}…</a>{it.qid && <> · query {it.qid.slice(0, 12)}…</>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}
