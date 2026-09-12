import { useState } from 'react'
import { Download } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { useScore, useLedgerEvents } from '../hooks'
import { Blockie, Section, Tag } from '../components/ui'
import { short } from '../lib/format'
import { cfg, CHAIN_INFO_PRECOMPILE, VERIFIER_PRECOMPILE } from '../config'
import { BadgeCard } from '../components/BadgeCard'
import { ScoreRing, ScoreBreakdown, ScoreSparkline } from '../components/ScoreRing'
import { Reveal } from '../components/motion'

export function ScorePage() {
  const { address: param } = useParams()
  const { address: connected } = useAccount()
  const nav = useNavigate()
  const addr = (param && isAddress(param) ? param : connected) as `0x${string}` | undefined
  const [input, setInput] = useState('')
  const [formErr, setFormErr] = useState('')
  const { score, record, isLoading, error } = useScore(addr)
  const { items } = useLedgerEvents({ member: addr })
  const history = items.filter((i) => ['ContributionRecorded', 'ContributionMissed', 'RoundClosed', 'PayoutConfirmed'].includes(i.kind))
  // No defaults: a score the chain has not produced is never shown as a number.
  const value = score?.[0]
  const tier = score?.[1]

  function exportBundle() {
    const bundle = {
      member: addr, issuedAt: new Date().toISOString(), score: value ?? null, tier: tier ?? null,
      record: record ? { onTime: record.onTime, late: record.late, missed: record.missed, received: record.received, volume_tUSD: Number(record.volume) / 1e6 } : undefined,
      ledger: { address: cfg.ledger, chainId: cfg.creditcoinChainId, rpc: cfg.creditcoinRpc },
      sourceChain: { chainKey: cfg.sourceChainKey, vault: cfg.vault, rpc: cfg.sepoliaRpc },
      attestcoin: { blockProver: VERIFIER_PRECOMPILE, chainInfo: CHAIN_INFO_PRECOMPILE },
      howToVerify: [
        'Each entry names the Creditcoin transaction that carried its Attestcoin proof.',
        'Re-check any payment against the live block-prover precompile: pnpm verify:live <sourceTx>, or the Re-verify button on the circle page.',
        'Read the ledger directly: creditScore(member) and getContribution(circleId, round, member).',
        'Nothing here has to be trusted: every number comes from a proven transaction or an attested deadline.',
      ],
      entries: history.map((h) => ({ event: h.kind, text: h.text, circleId: String(h.args.circleId ?? ''), round: Number(h.args.round ?? 0), queryId: h.qid, creditcoinTx: h.tx, creditcoinBlock: String(h.block) })),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = `kitty-receipts-${addr!.slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Kitty Score</div><h1 className="text-3xl">What a lender sees</h1></div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (isAddress(input)) { setFormErr(''); nav(`/score/${input}`) } else setFormErr('Not an address') }}>
          <div className="grid gap-1">
            <input value={input} onChange={(e) => { setInput(e.target.value); if (formErr) setFormErr('') }} placeholder="0x… member address" className="mono panel-2 px-3 py-2 text-sm" style={{ width: 'min(300px, 100%)', color: 'var(--ink)' }} />
            {formErr && <span className="text-xs" style={{ color: 'var(--amber)' }}>{formErr}</span>}
          </div>
          <button className="btn" type="submit">Look up</button>
        </form>
      </div>
      {(!cfg.ledger || error || isLoading) && (
        <p className="mt-2 text-xs" style={{ color: !cfg.ledger || error ? 'var(--amber)' : 'var(--muted)' }}>
          {!cfg.ledger ? 'ledger not deployed yet' : error ? 'could not read KittyLedger' : 'reading…'}
        </p>
      )}
      {!addr && <div className="panel mt-5 p-5 text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet or paste a member address.</div>}
      {addr && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="grid content-start gap-4">
            <Reveal as="section" className="panel p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Blockie address={addr} size={28} /><span className="mono">{short(addr)}</span></div>
                {connected && connected.toLowerCase() === addr.toLowerCase() && <Tag tone="muted">you</Tag>}
              </div>
              <div className="mt-3"><ScoreRing value={value} tier={tier} loading={isLoading} /></div>
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--muted)' }}>500 base · +15 on time · −20 late · −120 missed · clamped 300–850</p>
            </Reveal>
            <Reveal i={1}>
              <Section title="Score breakdown · getRecord(address)" right={<Tag tone="sky">ledger counters</Tag>}>
                <ScoreBreakdown record={record} />
                <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Proven volume <span className="mono" style={{ color: 'var(--ink)' }}>{record ? (Number(record.volume) / 1e6).toLocaleString() : '—'} tUSD</span> across {record ? record.onTime + record.late : '—'} proven payments. Nothing here is self-reported: each counter moves only on a verified Attestcoin proof or an attested deadline.</p>
              </Section>
            </Reveal>
          </div>
          <div className="grid content-start gap-4">
            <Reveal i={1}>
              <Section title="Score over time · replayed from ledger events" right={<Tag tone="muted">{history.filter((h) => h.kind === 'ContributionRecorded' || h.kind === 'ContributionMissed').length} scoring events</Tag>}>
                <div style={{ minHeight: 140 }}>
                  {history.some((h) => h.kind === 'ContributionRecorded' || h.kind === 'ContributionMissed')
                    ? <ScoreSparkline events={history} current={value} />
                    : <p className="text-sm" style={{ color: 'var(--muted)' }}>{isLoading ? 'Reading the ledger…' : 'No proven payments or attested misses yet, so the score sits at the 500 base.'}</p>}
                </div>
              </Section>
            </Reveal>
            <Reveal i={2}>
            <Section title="Lender view · readable by any Creditcoin contract" right={<div className="flex items-center gap-2"><button className="btn btn-ghost" style={{ padding: '.25rem .6rem', fontSize: 13 }} disabled={value === undefined} title={value === undefined ? 'No score read from the ledger yet' : undefined} onClick={exportBundle}><Download size={13} /> Proof bundle</button><Tag tone="sky">creditScore(address)</Tag></div>}>
              <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>Download the proof bundle to hand a lender a self-verifying history: every entry names the Creditcoin transaction that carried its Attestcoin proof, so they can re-check it themselves.</p>
              <pre className="log panel-2 p-3">{JSON.stringify({ member: addr, score: value ?? null, tier: tier ?? null, onTime: record?.onTime ?? 0, late: record?.late ?? 0, missed: record?.missed ?? 0, received: record?.received ?? 0, volume_tUSD: record ? Number(record.volume) / 1e6 : 0, source: 'KittyLedger on Creditcoin CC3 Testnet · inputs are Attestcoin-proven Sepolia txs and attested deadlines' }, null, 2)}</pre>
            </Section>
            </Reveal>
            <Reveal i={3}><BadgeCard address={addr} /></Reveal>
            <Reveal i={4}>
            <Section title="History · every entry is a proof or an attested deadline">
              {history.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No proven activity for this address yet.</p>}
              {history.length > 0 && (
                <div style={{ overflowX: 'auto', minWidth: 0, contain: 'inline-size' }}>
                  <table>
                    <thead><tr><th>Event</th><th>Circle · round</th><th>Sepolia block</th><th>Creditcoin tx</th></tr></thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i}>
                          <td><Tag tone={h.kind === 'ContributionMissed' ? 'rose' : h.kind === 'ContributionRecorded' ? (h.args.onTime ? 'mint' : 'amber') : 'sky'}>{h.kind === 'ContributionRecorded' ? (h.args.onTime ? 'on time' : 'late') : h.kind === 'ContributionMissed' ? 'missed' : h.kind === 'RoundClosed' ? 'received pot' : 'payout proven'}</Tag></td>
                          <td className="mono">#{String(h.args.circleId)} · r{String(h.args.round)}</td>
                          <td className="mono">{h.args.sourceHeight ? String(h.args.sourceHeight) : h.args.deadlineHeight ? `deadline ${String(h.args.deadlineHeight)}` : '—'}</td>
                          <td className="mono"><a href={`${cfg.creditcoinExplorer}/tx/${h.tx}`} target="_blank" rel="noreferrer">{h.tx.slice(0, 12)}…</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
            </Reveal>
          </div>
        </div>
      )}
    </main>
  )
}
