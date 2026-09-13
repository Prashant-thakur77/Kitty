import { useEffect, useMemo, useState } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { CheckCircle2, XCircle, Loader2, ShieldCheck, ExternalLink } from 'lucide-react'
import { cfg } from '../config'
import { sepolia, creditcoinTestnet } from '../lib/wagmi'
import { Tag } from '../components/ui'
import { CountUp, Reveal, Stagger, Item, Spotlight } from '../components/motion'
import { SkeletonRows } from '../components/Skeleton'

/** One row of docs/TESTNET_LOG.md as `pnpm verify:log --json` writes it (public/testnet-log.json). */
type Row = { date: string; chain: 'sepolia' | 'creditcoin'; action: string; hash: `0x${string}`; gas: string; reverted: boolean; block: number; to: string | null; created: string | null; status: number; gasUsed: string; ok: boolean; why?: string }
type Log = { verifiedAt: string; total: number; passed: number; rows: Row[] }
type Check = 'ok' | 'fail' | 'busy'

const CHAIN = { sepolia: { label: 'Sepolia', explorer: cfg.sepoliaExplorer, tone: 'sky' as const }, creditcoin: { label: 'Creditcoin CC3', explorer: cfg.creditcoinExplorer, tone: 'mint' as const } }

// Public Sepolia endpoints are load-balanced over nodes that do not all hold every receipt: a null answer is retried elsewhere.
const SEPOLIA_RPCS = [cfg.sepoliaRpc, 'https://sepolia.gateway.tenderly.co', 'https://1rpc.io/sepolia']

function clients(): Record<Row['chain'], PublicClient[]> {
  return {
    sepolia: SEPOLIA_RPCS.map((url) => createPublicClient({ chain: sepolia, transport: http(url) })),
    creditcoin: [createPublicClient({ chain: creditcoinTestnet, transport: http(cfg.creditcoinRpc) })],
  }
}

async function checkRow(r: Row, cs: PublicClient[]): Promise<Check> {
  for (const c of cs) {
    const rc = await c.getTransactionReceipt({ hash: r.hash }).catch(() => null)
    if (!rc) continue
    const okStatus = (rc.status === 'success') !== r.reverted
    return okStatus && rc.gasUsed.toString() === r.gas ? 'ok' : 'fail'
  }
  return 'fail'
}

/** The kind of step a row is, from its action text, so the table can be filtered the way a reader thinks about it. */
function kind(action: string): string {
  const a = action.toLowerCase()
  if (a.startsWith('deploy')) return 'deploy'
  if (a.startsWith('fund') || a.startsWith('mint') || a.startsWith('approve')) return 'fund'
  if (a.startsWith('createcircle') || a.startsWith('create ') || a.includes('joincircle') || a.startsWith('join')) return 'create'
  if (a.startsWith('contribute') || a.startsWith('pay ')) return 'pay'
  if (a.startsWith('recordcontributions') || a.includes('prove') || a.includes('proof') || a.includes('verifyandemit') || a.startsWith('confirmpayouts')) return 'prove'
  if (a.startsWith('closeround') || a.startsWith('close ')) return 'close'
  if (a.startsWith('payout') || a.startsWith('release')) return 'payout'
  if (a.startsWith('scenario') || a.includes('attack') || a.includes('rejected')) return 'attack'
  return 'other'
}
const KINDS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'deploy', label: 'Deployments' }, { id: 'create', label: 'Create and join' }, { id: 'pay', label: 'Payments' },
  { id: 'prove', label: 'Proofs' }, { id: 'close', label: 'Closes' }, { id: 'payout', label: 'Payouts' }, { id: 'attack', label: 'Attack scenarios' }, { id: 'fund', label: 'Funding' }, { id: 'other', label: 'Other' },
]

export function Evidence() {
  const [log, setLog] = useState<Log | null>(null)
  const [missing, setMissing] = useState(false)
  const [chain, setChain] = useState<'all' | Row['chain']>('all')
  const [k, setK] = useState('all')
  const [q, setQ] = useState('')
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}testnet-log.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Log) => { if (!cancelled) setLog(j) }).catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    if (!log) return []
    const needle = q.trim().toLowerCase()
    return log.rows.filter((r) => (chain === 'all' || r.chain === chain) && (k === 'all' || kind(r.action) === k) && (!needle || r.action.toLowerCase().includes(needle) || r.hash.includes(needle) || r.date.includes(needle)))
  }, [log, chain, k, q])

  const totals = useMemo(() => {
    if (!log) return null
    const gas = log.rows.reduce((s, r) => s + BigInt(r.gasUsed), 0n)
    const deploys = log.rows.filter((r) => kind(r.action) === 'deploy').length
    const proofs = log.rows.filter((r) => kind(r.action) === 'prove').length
    return { sep: log.rows.filter((r) => r.chain === 'sepolia').length, cc: log.rows.filter((r) => r.chain === 'creditcoin').length, gas, deploys, proofs, from: log.rows.map((r) => r.date).sort()[0], to: log.rows.map((r) => r.date).sort().at(-1) }
  }, [log])

  const done = Object.values(checks).filter((c) => c !== 'busy').length
  const passed = Object.values(checks).filter((c) => c === 'ok').length
  const failed = Object.values(checks).filter((c) => c === 'fail').length

  /** Re-fetch every receipt from this browser: four in flight per chain, both chains at once, so public RPCs are not burst. */
  async function verifyAll() {
    if (!log || running) return
    setRunning(true)
    setChecks(Object.fromEntries(log.rows.map((r) => [r.hash, 'busy' as Check])))
    const cs = clients()
    const lane = async (list: Row[], c: PublicClient[]) => {
      let i = 0
      const worker = async () => { while (i < list.length) { const r = list[i++]; const res = await checkRow(r, c); setChecks((s) => ({ ...s, [r.hash]: res })) } }
      await Promise.all(Array.from({ length: 4 }, worker))
    }
    await Promise.all([lane(log.rows.filter((r) => r.chain === 'sepolia'), cs.sepolia), lane(log.rows.filter((r) => r.chain === 'creditcoin'), cs.creditcoin)])
    setRunning(false)
  }

  return (
    <main className="page">
      <Reveal className="page-head">
        <div><div className="eyebrow">Evidence</div><h1>{log ? `${log.total} testnet transactions, re-verified` : 'Testnet transactions, re-verified'}</h1>
          <p className="sub">Every on-chain step of the campaign on Ethereum Sepolia and Creditcoin CC3 Testnet, from <span className="mono">docs/TESTNET_LOG.md</span>. CI re-reads each receipt with <span className="mono">pnpm verify:log</span>; the button does the same from your browser, against the public RPCs, right now.</p></div>
        <div className="flex flex-col items-end gap-2 text-xs mono" style={{ color: 'var(--muted)' }} aria-live="polite">
          {log && <Tag wrap tone={log.passed === log.total ? 'mint' : 'amber'}>CI: {log.passed}/{log.total} receipts matched · {log.verifiedAt.slice(0, 10)}</Tag>}
          {done > 0 && <Tag wrap tone={failed ? 'rose' : done === log?.total ? 'mint' : 'sky'}>this browser: {passed} ok{failed ? ` · ${failed} failed` : ''}{running ? ` · ${done}/${log?.total}` : ''}</Tag>}
        </div>
      </Reveal>

      {missing && <Reveal className="panel p-5 section-gap"><p className="text-sm" style={{ color: 'var(--muted)' }}>No verified log in this build. Generate it with <span className="mono">pnpm verify:log --json web/public/testnet-log.json</span>.</p></Reveal>}

      {totals && (
        <Stagger className="section-gap grid gap-3 sm:grid-cols-2 lg:grid-cols-4" tour="evidence-stats">
          {[
            { label: 'Sepolia transactions', v: totals.sep, tone: 'var(--sky)', sub: 'payments, payouts, vault and token deployments' },
            { label: 'Creditcoin transactions', v: totals.cc, tone: 'var(--mint)', sub: `${totals.proofs} carry a block-prover proof · ${totals.deploys} deployments` },
            { label: 'Gas used, both chains', v: Number(totals.gas / 1000n), tone: 'var(--ink)', sub: 'thousands of gas, re-read from receipts', suffix: 'k' },
            { label: 'Ledger deployments', v: 4, tone: 'var(--amber)', sub: `${totals.from} to ${totals.to} · each superseded the day it found a gap` },
          ].map((s) => (
            <Item key={s.label}>
              <Spotlight className="panel px-5 py-5">
                <div className="eyebrow">{s.label}</div>
                <div className="mono mt-2 text-4xl font-semibold" style={{ color: s.tone }}><CountUp value={s.v} />{s.suffix ?? ''}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{s.sub}</div>
              </Spotlight>
            </Item>
          ))}
        </Stagger>
      )}

      <Reveal className="section-gap panel p-4" tour="evidence-table">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={verifyAll} disabled={!log || running} aria-busy={running} title="Fetch every receipt from the public RPCs and compare status and gas with the log">
            {running ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {running ? `Verifying ${done}/${log?.total}…` : 'Verify in this browser'}
          </button>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Chain">
            {(['all', 'sepolia', 'creditcoin'] as const).map((c) => <button key={c} className={`pill ${chain === c ? (c === 'creditcoin' ? 'mint' : c === 'sepolia' ? 'sky' : 'amber') : ''}`} onClick={() => setChain(c)} aria-pressed={chain === c}>{c === 'all' ? 'Both chains' : CHAIN[c].label}</button>)}
          </div>
          <select className="mono panel-2 px-2 py-1 text-xs" value={k} onChange={(e) => setK(e.target.value)} aria-label="Kind of step" style={{ color: 'var(--ink)' }}>
            {KINDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <input className="mono panel-2 px-3 py-1 text-xs" placeholder="Search action or hash" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ color: 'var(--ink)', width: 220, maxWidth: '100%' }} />
          <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{rows.length}{log && rows.length !== log.total ? ` of ${log.total}` : ''} rows</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          {!log && !missing ? <SkeletonRows n={8} /> : (
            <table className="text-[12.5px] [&_td]:py-[5px] [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium">
              <thead><tr style={{ color: 'var(--muted)' }}><th>Date</th><th>Chain</th><th>Action</th><th>Transaction</th><th>Block</th><th className="text-right">Gas</th><th>Check</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const c = checks[r.hash]
                  return (
                    <tr key={r.hash} className="row-hover">
                      <td className="mono whitespace-nowrap" style={{ color: 'var(--muted)' }}>{r.date}</td>
                      <td><Tag tone={CHAIN[r.chain].tone}>{CHAIN[r.chain].label}</Tag></td>
                      <td style={{ color: 'var(--ink)', minWidth: 260 }}>{r.action}</td>
                      <td className="mono whitespace-nowrap"><a href={`${CHAIN[r.chain].explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">{r.hash.slice(0, 10)}…{r.hash.slice(-6)}<ExternalLink size={11} /></a></td>
                      <td className="mono whitespace-nowrap">{r.block.toLocaleString()}</td>
                      <td className="mono whitespace-nowrap text-right">{Number(r.gasUsed).toLocaleString()}</td>
                      <td className="whitespace-nowrap">
                        {c === 'busy' ? <Loader2 size={14} className="spin" style={{ color: 'var(--muted)' }} aria-label="checking" /> : c === 'ok' ? <CheckCircle2 size={14} style={{ color: 'var(--mint)' }} aria-label="receipt matches" /> : c === 'fail' ? <XCircle size={14} style={{ color: 'var(--rose)' }} aria-label="receipt did not match" /> : <span title={r.ok ? `CI matched this receipt on ${log?.verifiedAt.slice(0, 10)}` : r.why} style={{ color: r.ok ? 'var(--mint)' : 'var(--rose)' }}>{r.ok ? 'ci ok' : 'ci fail'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </main>
  )
}
