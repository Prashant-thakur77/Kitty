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
              <div><FeedText text={it.text} /></div>
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

/** Feed text ends with the 0-based on-chain round index as `(rN)`; render it as a small mono chip so it reads as an index, not a second round number. */
function FeedText({ text }: { text: string }) {
  const m = /^(.*) \((r\d+)\)$/.exec(text)
  if (!m) return <>{text}</>
  return <>{m[1]} <span className="pill mono" style={{ padding: '0 .4rem', fontSize: 10, fontWeight: 500, verticalAlign: '1px' }} title="0-based round index used by the contracts and logs">{m[2]}</span></>
}
