import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MessageSquare, ExternalLink, ScrollText, Loader2 } from 'lucide-react'
import { cfg } from '../config'
import { Section, Tag } from '../components/ui'
import { Reveal, Stagger, Item, EASE_OUT } from '../components/motion'
import { Skeleton, SkeletonRows, SkeletonText, Empty } from '../components/Skeleton'

/** Mirrors worker/src/agent/log.ts Decision (not imported: that package pulls node:fs into the bundle). */
type Decision = {
  at: string
  kind: 'prove' | 'wait' | 'close' | 'payout' | 'confirm' | 'skip' | 'error'
  summary: string
  evidence: Record<string, unknown>
  txs?: { chain: 'source' | 'creditcoin'; hash: string }[]
}
/** Mirrors worker/src/agent/explain.ts Explanation. */
type Explanation = {
  text: string
  source: 'claude' | 'deterministic'
  verified: string[]
  stripped: { sentence: string; reason: string; value: string }[]
}

const KIND_TONE: Record<Decision['kind'], 'mint' | 'sky' | 'muted' | 'rose'> = { prove: 'mint', payout: 'mint', confirm: 'mint', close: 'sky', wait: 'muted', skip: 'rose', error: 'rose' }
const SAMPLE_QUESTION = 'Why did you close round 1?'

export function Steward() {
  const [entries, setEntries] = useState<Decision[]>([])
  const [offline, setOffline] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [question, setQuestion] = useState(SAMPLE_QUESTION)
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<Explanation | null>(null)
  const [askErr, setAskErr] = useState('')
  const reduced = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    // No local API (GitHub Pages): show the steward's real CC3 Testnet log, committed as web/src/data/steward.sample.json.
    async function loadSample() {
      try {
        const { default: sample } = await import('../data/steward.sample.json')
        const rec = sample as { mode?: string; entries?: Decision[] } | Decision[]
        const list = Array.isArray(rec) ? rec : rec.entries ?? []
        if (!cancelled) { setEntries([...list].reverse()); if (!Array.isArray(rec) && rec.mode) setMode(rec.mode) }
      } catch { /* no sample shipped: the empty state stays */ }
    }
    fetch(`${cfg.labApi}/steward/log`).then((r) => r.json()).then((d: Decision[]) => { if (!cancelled && Array.isArray(d)) setEntries(d) })
      .catch(() => { if (!cancelled) { setOffline(true); return loadSample() } })
      .finally(() => { if (!cancelled) setLoaded(true) })
    fetch(`${cfg.labApi}/status`).then((r) => r.json()).then((st: { mode?: string }) => { if (!cancelled) setMode(String(st.mode ?? '')) }).catch(() => { /* offline: no explorer links */ })
    return () => { cancelled = true }
  }, [])

  // Local anvil hashes do not exist on any explorer, so only a testnet log (live worker or the committed record) earns links.
  const explorerFor = (chain: 'source' | 'creditcoin') => (mode && mode !== 'local' ? (chain === 'source' ? cfg.sepoliaExplorer : cfg.creditcoinExplorer) : null)

  async function ask(e: FormEvent) {
    e.preventDefault()
    if (asking || offline) return
    setAsking(true); setAskErr(''); setAnswer(null)
    try {
      const res = await fetch(`${cfg.labApi}/steward/explain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
      if (!res.ok) throw new Error(`lab api ${res.status}`)
      setAnswer((await res.json()) as Explanation)
    } catch (err) {
      setAskErr(`lab api unreachable at ${cfg.labApi} — start it with \`pnpm lab:api\` (${(err as Error).message})`)
    } finally { setAsking(false) }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Kitty Steward</div><h1 className="text-3xl">The decision log</h1>
          <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>The worker is an agent in three layers, and authority decreases as you move toward the model. Every decision below carries the chain state it saw and the transactions it produced, so any line can be checked against the chain. Layer 3 may only cite figures from this log.</p></div>
        <div className="text-xs mono" style={{ color: 'var(--muted)' }} aria-live="polite">
          {offline ? <Tag tone={mode === 'testnet' ? 'mint' : 'sky'}>{mode === 'testnet' ? 'recorded on CC3 Testnet · every hash resolves on the explorer' : 'sample log · recorded from the local world'}</Tag> : loaded ? <span className="pill live">live · {cfg.labApi.replace(/^https?:\/\//, '')}{mode ? ` · mode ${mode}` : ''}</span> : <span aria-label="Connecting to the lab API"><Skeleton w={190} h={22} r={999} /></span>}
        </div>
      </Reveal>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <Reveal i={1} className="min-w-0">
          <Section title="Decisions · newest first" right={loaded ? <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{entries.length} entries</span> : <Skeleton w={64} h={12} />}>
            {!loaded && <div aria-busy="true" aria-label="Loading the decision log"><SkeletonRows n={5} /></div>}
            {loaded && entries.length === 0 && (
              <Empty
                icon={<ScrollText size={22} />}
                title="No decisions logged yet"
                body={<>The steward writes a line here every time it proves, waits, closes or pays out. Run <code className="mono">pnpm worker</code> or <code className="mono">scripts/local-world.sh</code> and reload.</>}
                action={{ label: 'See what the steward may do', to: '/architecture' }}
              />
            )}
            <Stagger as="ol" className="grid gap-2">
              {entries.map((d, i) => (
                <Item as="li" key={`${d.at}-${i}`} className="panel-2 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={KIND_TONE[d.kind] ?? 'muted'}>{d.kind}</Tag>
                    <span className="mono text-[11px]" style={{ color: 'var(--muted)' }} title={d.at}>{fmtAt(d.at)}</span>
                    <span className="min-w-0 flex-1 basis-full sm:basis-auto" style={{ overflowWrap: 'anywhere' }}>{d.summary}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(d.evidence).map(([k, v]) => (
                      <span key={k} className="mono rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}><span style={{ color: 'var(--muted)' }}>{k}=</span>{fmtVal(v)}</span>
                    ))}
                  </div>
                  {d.txs && d.txs.length > 0 && (
                    <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                      {d.txs.map((t, j) => {
                        const ex = explorerFor(t.chain)
                        const label = <>{t.chain === 'source' ? 'source' : 'creditcoin'} {t.hash.slice(0, 14)}…</>
                        return ex ? <a key={j} href={`${ex}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">{label}<ExternalLink size={10} /></a> : <span key={j} title={t.hash}>{label}</span>
                      })}
                    </div>
                  )}
                </Item>
              ))}
            </Stagger>
          </Section>
        </Reveal>

        <Reveal i={2} className="min-w-0">
          <Section title="Ask the steward · Layer 3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Claude rewrites the log in plain language. Every figure it states must be cited and must appear in the log; the citation validator strips any sentence it cannot back before it is shown. Without an API key the answer is the deterministic sentence from Layer 2.</p>
            <form onSubmit={ask} className="mt-3 grid gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={offline} placeholder="why did you close round 1?" className="mono panel-2 w-full px-3 py-2 text-sm" style={{ color: 'var(--ink)' }} />
              <button type="submit" className="btn btn-mint justify-center" disabled={offline || asking || !question.trim()} aria-busy={asking} title={offline ? 'Start the local lab API with `pnpm lab:api` to ask live' : undefined}>{asking ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />} {asking ? 'Asking…' : offline ? 'Ask (needs pnpm lab:api)' : 'Ask'}</button>
            </form>
            {asking && <div className="panel-2 mt-3 p-3" aria-busy="true" aria-label="Waiting for the steward"><Skeleton w={120} h={20} r={999} /><SkeletonText n={3} className="mt-3" /></div>}
            {askErr && <div className="log mt-3" style={{ color: 'var(--amber)' }} role="alert">{askErr}</div>}
            <AnimatePresence initial={false}>
            {answer && (
              <motion.div key={answer.text} className="panel-2 mt-3 p-3 text-sm" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
                <div className="mb-2 flex flex-wrap items-center gap-2"><Tag tone={answer.source === 'claude' ? 'mint' : 'muted'}>{answer.source === 'claude' ? 'claude · cited' : 'deterministic · Layer 2'}</Tag>{answer.source === 'deterministic' && <span className="text-xs" style={{ color: 'var(--muted)' }}>no ANTHROPIC_API_KEY on the API, or nothing survived the check</span>}</div>
                <p className="m-0">{answer.text}</p>
                {answer.verified.length > 0 && (
                  <div className="mt-3">
                    <div className="eyebrow">verified citations</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">{answer.verified.map((v, i) => <span key={i} className="pill mint mono" style={{ fontWeight: 500 }}>{v.length > 18 ? `${v.slice(0, 14)}…` : v}</span>)}</div>
                  </div>
                )}
                {answer.stripped.length > 0 && (
                  <div className="mt-3">
                    <div className="eyebrow">stripped before display</div>
                    <ul className="mt-1 grid gap-1.5">
                      {answer.stripped.map((s, i) => (
                        <li key={i} className="text-xs"><span style={{ color: 'var(--dim)', textDecoration: 'line-through' }}>{s.sentence}</span> <span className="mono" style={{ color: 'var(--rose)' }}>{s.reason}: {s.value}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </Section>
        </Reveal>
      </div>
    </main>
  )
}

function fmtAt(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtVal(v: unknown) {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
  return /^0x[0-9a-fA-F]{20,}$/.test(s) ? `${s.slice(0, 10)}…${s.slice(-4)}` : s
}
