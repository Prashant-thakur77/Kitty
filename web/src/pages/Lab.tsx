import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Play, ShieldAlert, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cfg } from '../config'
import { Tag } from '../components/ui'
import { Reveal, Stagger, Item, EASE_OUT } from '../components/motion'
import { Skeleton } from '../components/Skeleton'

type Scenario = { name: string; title: string; expected: string; description?: string }
type Result = { ok: boolean; expected: string; got: string }
/** Shape written by worker/src/record-lab.ts into web/public/lab-recorded.json. */
type Recorded = { commit: string; date: string; mode?: string; results: (Scenario & { lines: string[]; ok: boolean; got: string })[] }

// Mirrors worker/src/scenarios.ts SCENARIOS (same order, descriptions verbatim). Not imported: that module pulls ethers and the worker config into the bundle.
const FALLBACK: Scenario[] = [
  { name: 'replay', title: 'Replay a proven contribution', expected: 'QueryAlreadyProcessed', description: 'Re-submits the batch proof of a contribution the ledger already counted. Query id (chainKey ‖ height ‖ txIndex) is marked processed.' },
  { name: 'spoofEmitter', title: 'Spoofed emitter', expected: 'WrongEmitter', description: 'A look-alike contract on Sepolia emits a byte-identical Contributed event. The log address is bound to the registered vault.' },
  { name: 'wrongChain', title: 'Wrong chain key', expected: 'WrongChain, or the precompile rejects the continuity proof', description: 'A valid proof submitted with chainKey 3 (Ethereum mainnet on CC3 testnet). The ledger is pinned to chainKey 1.' },
  { name: 'revertedTx', title: 'Reverted source transaction', expected: 'SourceTxFailed', description: 'A contribute() call that mined but reverted (no allowance). Inclusion is proven, receipt status 0 is rejected.' },
  { name: 'stealFromSteward', title: 'Steal the steward’s key', expected: 'every privileged call reverts', description: 'Takes a key with the steward’s exact powers and tries to move a pot, trust a vault, and close a round early. The steward has no role, no ownership and no allowance, so its key is worth nothing.' },
  { name: 'fireTheAgent', title: 'Fire the agent', expected: 'a stranger’s proof is accepted', description: 'Submits a round’s proof from a wallet with no relationship to Kitty at all. The ledger checks the proof, never the caller, so the agent is a convenience and not a dependency.' },
  { name: 'poisonReasoning', title: 'Poison the reasoning', expected: 'fabricated sentences stripped', description: 'Feeds the explainer’s citation validator a paragraph mixing true cited facts with invented ones. Anything the decision log cannot back is removed before display.' },
  { name: 'late', title: 'Late payment', expected: 'ContributionRecorded onTime=false', description: 'A member pays after the round deadline block. The proof is accepted, but the proven height marks it late in the credit record.' },
]
const WHY: Record<string, string> = {
  replay: 'Query id = keccak(chainKey ‖ height ‖ txIndex) is marked processed before any state changes. Same derivation as ASCBase.',
  spoofEmitter: 'The decoded log’s emitting address must equal the circle’s registered vault, and the transaction’s own `to` must be that vault too.',
  wrongChain: 'Each circle stores its own chain key, validated against get_chain_by_key. Under another key the live 0x0FD2 rejects the continuity proof itself; if a proof ever got past it, the ledger reverts WrongChain(got, want).',
  revertedTx: 'The precompile proves inclusion, not success. KittyLedger checks receiptStatus == 1 before reading any log.',
  late: 'Deadlines are source-chain block heights. A payment proven above the deadline height counts, but is recorded as late (−20 score).',
  stealFromSteward: 'The steward key has no ledger role: payout → NotOperator, setTrustedVault → OwnableUnauthorizedAccount, closeRound early → RoundStillOpenOnSource, createCircle with its own vault → VaultNotTrusted.',
  fireTheAgent: 'A wallet with no role, membership or history submits the round proof; the ledger checks the proof, not the caller.',
  poisonReasoning: 'citations.ts strips any sentence whose figure is not in the decision log.',
}

export function Lab() {
  const [scenarios, setScenarios] = useState<Scenario[]>(FALLBACK)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [offline, setOffline] = useState(false)
  const [recorded, setRecorded] = useState<{ commit: string; date: string; mode?: string } | null>(null)
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const reduced = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    // No local API (GitHub Pages): show the recorded run committed by `pnpm lab:record`, if present.
    async function loadRecorded() {
      try {
        // Prefer the run recorded against the real testnets (explorer-verifiable), then the local-world run.
        let res = await fetch(`${import.meta.env.BASE_URL}lab-testnet.json`)
        if (!res.ok) res = await fetch(`${import.meta.env.BASE_URL}lab-recorded.json`)
        if (!res.ok) return
        const rec = (await res.json()) as Recorded
        if (cancelled || !Array.isArray(rec?.results) || rec.results.length === 0) return
        setScenarios(rec.results.map(({ name, title, expected, description }) => ({ name, title, expected, description })))
        setLogs(Object.fromEntries(rec.results.map((r) => [r.name, r.lines ?? []])))
        setResults(Object.fromEntries(rec.results.map((r) => [r.name, { ok: r.ok, expected: r.expected, got: r.got }])))
        setRecorded({ commit: String(rec.commit ?? ''), date: String(rec.date ?? ''), mode: rec.mode })
      } catch { /* no recorded run shipped: the fallback list with explanations stays */ }
    }
    fetch(`${cfg.labApi}/scenarios`).then((r) => r.json()).then((s: Scenario[]) => { if (!cancelled && Array.isArray(s) && s.length) setScenarios(s) }).catch(() => { if (!cancelled) { setOffline(true); loadRecorded() } })
    fetch(`${cfg.labApi}/status`).then((r) => r.json()).then((st) => { if (!cancelled) setStatus(st) }).catch(() => { if (!cancelled) setOffline(true) })
    return () => { cancelled = true }
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
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Attack lab</div><h1 className="text-3xl">Try to cheat the ledger</h1>
          <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>Each button runs a real transaction through the real pipeline: source chain → proof → KittyLedger on Creditcoin. The ledger answers with a decoded custom error, or accepts and flags.</p></div>
        <div className="text-xs mono" style={{ color: 'var(--muted)' }} aria-live="polite">
          {offline ? (recorded ? <Tag tone={recorded.mode === 'testnet' ? 'mint' : 'sky'}>{recorded.mode === 'testnet' ? 'recorded on Sepolia + CC3 Testnet' : 'recorded run'} · {recorded.date.slice(0, 10)} · {recorded.commit.slice(0, 7)}</Tag> : <Tag tone="amber">lab api offline · run `pnpm lab:api`</Tag>) : status ? <span>mode {String(status.mode)} · source head {String(status.sourceHead)} · attested {String(status.attestedHeight ?? 'n/a')}</span> : <span className="flex items-center gap-2" aria-label="Connecting to the lab API"><Skeleton w={200} h={12} /><Skeleton w={54} h={22} r={999} /></span>}
        </div>
      </Reveal>
      <Stagger className="mt-5 grid gap-3 md:grid-cols-2">
        {scenarios.map((s) => {
          const r = results[s.name]; const lines = logs[s.name] ?? []
          const live = running === s.name
          return (
            <Item key={s.name} as="section" className="panel p-4" style={{ transition: 'border-color .4s', ...(r ? { borderColor: r.ok ? 'var(--mint)' : 'var(--rose)' } : live ? { borderColor: 'var(--line-2)' } : {}) }}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex items-center gap-2"><ShieldAlert size={16} style={{ color: 'var(--rose)' }} /><span className="font-semibold">{s.title}</span></div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{WHY[s.name] ?? s.description}</div>
                  <div className="mt-2 text-xs">expects <span className="mono" style={{ color: 'var(--amber)' }}>{s.expected}</span></div></div>
                <button className="btn" disabled={offline || !!running} aria-busy={live} title={offline ? 'Start the local lab API with `pnpm lab:api` to run this live' : undefined} onClick={() => run(s.name)}>{live ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {live ? 'Running…' : offline ? 'Run live (needs pnpm lab:api)' : 'Run'}</button>
              </div>
              <AnimatePresence initial={false}>
                {(lines.length > 0 || r || live) && (
                  <motion.div key="log" initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: EASE_OUT }} style={{ overflow: 'hidden' }}>
                    <div ref={(el) => { logRefs.current[s.name] = el }} className="log panel-2 mt-3 max-h-56 overflow-auto p-3" aria-live="polite">
                      {lines.length === 0 && live && <span className="grid gap-2" aria-label="Waiting for the first line"><Skeleton w="72%" h={10} /><Skeleton w="48%" h={10} /></span>}
                      {lines.map((l, i) => <motion.div key={i} initial={reduced ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }}>{l}</motion.div>)}
                      {r && <motion.div initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="mt-2 flex items-center gap-2" style={{ color: r.ok ? 'var(--mint)' : 'var(--rose)' }}>{r.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {r.ok ? 'as expected' : 'UNEXPECTED'} · got {r.got}</motion.div>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Item>
          )
        })}
      </Stagger>
    </main>
  )
}
