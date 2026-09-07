import { useEffect, useRef, useState } from 'react'
import { Play, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react'
import { cfg } from '../config'
import { Tag } from '../components/ui'

type Scenario = { name: string; title: string; expected: string }
type Result = { ok: boolean; expected: string; got: string }

const FALLBACK: Scenario[] = [
  { name: 'replay', title: 'Replay a proof that already counted', expected: 'QueryAlreadyProcessed' },
  { name: 'spoofEmitter', title: 'Fake vault emits a perfect Contributed event', expected: 'WrongEmitter' },
  { name: 'wrongChain', title: 'Same proof, different chain key', expected: 'WrongChain' },
  { name: 'revertedTx', title: 'Included but reverted source transaction', expected: 'SourceTxFailed' },
  { name: 'late', title: 'Pay after the deadline block', expected: 'accepted, flagged onTime=false' },
]
const WHY: Record<string, string> = {
  replay: 'Query id = keccak(chainKey ‖ height ‖ txIndex) is marked processed before any state changes. Same derivation as ASCBase.',
  spoofEmitter: 'The decoded log’s emitting address must equal the circle’s registered vault, and the transaction’s own `to` must be that vault too.',
  wrongChain: 'The ledger pins SOURCE_CHAIN_KEY at deployment. Ethereum mainnet is chainKey 3 on this testnet; its proofs never count.',
  revertedTx: 'The precompile proves inclusion, not success. KittyLedger checks receiptStatus == 1 before reading any log.',
  late: 'Deadlines are source-chain block heights. A payment proven above the deadline height counts, but is recorded as late (−20 score).',
}

export function Lab() {
  const [scenarios, setScenarios] = useState<Scenario[]>(FALLBACK)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [offline, setOffline] = useState(false)
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    fetch(`${cfg.labApi}/scenarios`).then((r) => r.json()).then((s: Scenario[]) => { if (Array.isArray(s) && s.length) setScenarios(s) }).catch(() => setOffline(true))
    fetch(`${cfg.labApi}/status`).then((r) => r.json()).then(setStatus).catch(() => setOffline(true))
  }, [])
  useEffect(() => { for (const el of Object.values(logRefs.current)) el?.scrollTo({ top: el.scrollHeight }) }, [logs])

  async function run(name: string) {
    if (running) return
    setRunning(name); setLogs((l) => ({ ...l, [name]: [] })); setResults((r) => { const c = { ...r }; delete c[name]; return c })
    try {
      const res = await fetch(`${cfg.labApi}/run/${name}`, { method: 'POST' })
      if (res.status === 409) { setLogs((l) => ({ ...l, [name]: ['another scenario is still running — wait for it to finish'] })); return }
      if (!res.ok || !res.body) throw new Error(`lab api ${res.status}`)
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
          const ev = /^event: (.+)$/m.exec(chunk)?.[1]
          const data = /^data: (.+)$/m.exec(chunk)?.[1]
          if (!data) continue
          try {
            const j = JSON.parse(data)
            if (ev === 'done') setResults((r) => ({ ...r, [name]: j }))
            else if (j.line !== undefined) setLogs((l) => ({ ...l, [name]: [...(l[name] ?? []), j.line] }))
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setLogs((l) => ({ ...l, [name]: [...(l[name] ?? []), `lab api unreachable at ${cfg.labApi} — start it with \`pnpm lab:api\` (${(e as Error).message})`] }))
    } finally { setRunning(null) }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Attack lab</div><h1 className="text-3xl">Try to cheat the ledger</h1>
          <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>Each button runs a real transaction through the real pipeline: source chain → proof → KittyLedger on Creditcoin. The ledger answers with a decoded custom error, or accepts and flags.</p></div>
        <div className="text-xs mono" style={{ color: 'var(--muted)' }}>
          {offline ? <Tag tone="amber">lab api offline · run `pnpm lab:api`</Tag> : status ? <span>mode {String(status.mode)} · source head {String(status.sourceHead)} · attested {String(status.attestedHeight ?? 'n/a')}</span> : 'connecting…'}
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {scenarios.map((s) => {
          const r = results[s.name]; const lines = logs[s.name] ?? []
          return (
            <section key={s.name} className="panel p-4" style={r ? { borderColor: r.ok ? 'var(--mint)' : 'var(--rose)' } : {}}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex items-center gap-2"><ShieldAlert size={16} style={{ color: 'var(--rose)' }} /><span className="font-semibold">{s.title}</span></div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{WHY[s.name]}</div>
                  <div className="mt-2 text-xs">expects <span className="mono" style={{ color: 'var(--amber)' }}>{s.expected}</span></div></div>
                <button className="btn" disabled={!!running} onClick={() => run(s.name)}><Play size={14} /> {running === s.name ? 'Running…' : 'Run'}</button>
              </div>
              {(lines.length > 0 || r) && (
                <div ref={(el) => { logRefs.current[s.name] = el }} className="log panel-2 mt-3 max-h-56 overflow-auto p-3">
                  {lines.map((l, i) => <div key={i}>{l}</div>)}
                  {r && <div className="mt-2 flex items-center gap-2" style={{ color: r.ok ? 'var(--mint)' : 'var(--rose)' }}>{r.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {r.ok ? 'ledger rejected/flagged as expected' : 'UNEXPECTED'} · got {r.got}</div>}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
