import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import { useScore, useLedgerEvents } from '../hooks'
import { Blockie, Section, Stat, Tag } from '../components/ui'
import { short } from '../lib/format'
import { cfg } from '../config'
import { BadgeCard } from '../components/BadgeCard'

export function ScorePage() {
  const { address: param } = useParams()
  const { address: connected } = useAccount()
  const nav = useNavigate()
  const addr = (param && isAddress(param) ? param : connected) as `0x${string}` | undefined
  const [input, setInput] = useState('')
  const { score, record } = useScore(addr)
  const { items } = useLedgerEvents({ member: addr })
  const history = items.filter((i) => ['ContributionRecorded', 'ContributionMissed', 'RoundClosed', 'PayoutConfirmed'].includes(i.kind))
  const value = score?.[0] ?? 500
  const tier = score?.[1] ?? 'C'
  const tierColor = tier === 'A' ? 'var(--mint)' : tier === 'B' ? 'var(--sky)' : tier === 'C' ? 'var(--amber)' : 'var(--rose)'

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Kitty Score</div><h1 className="text-3xl">What a lender sees</h1></div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (isAddress(input)) nav(`/score/${input}`) }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… member address" className="mono panel-2 px-3 py-2 text-sm" style={{ width: 300, color: 'var(--ink)' }} />
          <button className="btn" type="submit">Look up</button>
        </form>
      </div>
      {!addr && <div className="panel mt-5 p-5 text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet or paste a member address.</div>}
      {addr && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[380px_1fr]">
          <section className="panel p-5">
            <div className="flex items-center gap-2"><Blockie address={addr} size={28} /><span className="mono">{short(addr)}</span></div>
            <div style={{ height: 230 }} className="mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ v: value - 300 }]} startAngle={220} endAngle={-40}>
                  <PolarAngleAxis type="number" domain={[0, 550]} tick={false} />
                  <RadialBar dataKey="v" cornerRadius={8} fill={tierColor} background={{ fill: '#1B2823' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none -mt-[150px] text-center">
                <div className="mono text-5xl font-semibold" style={{ color: tierColor }}>{value}</div>
                <div className="eyebrow">tier {tier} · range 300–850</div>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-2">
              <Stat label="On time" value={record?.onTime ?? 0} tone="mint" />
              <Stat label="Late" value={record?.late ?? 0} tone="amber" />
              <Stat label="Missed" value={record?.missed ?? 0} tone="rose" />
              <Stat label="Pots received" value={record?.received ?? 0} />
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>500 base · +15 on time · −20 late · −120 missed. Proven volume {record ? (Number(record.volume) / 1e6).toLocaleString() : 0} tUSD.</p>
          </section>
          <div className="grid gap-4">
            <Section title="Lender view · readable by any Creditcoin contract" right={<Tag tone="sky">creditScore(address)</Tag>}>
              <pre className="log panel-2 p-3">{JSON.stringify({ member: addr, score: value, tier, onTime: record?.onTime ?? 0, late: record?.late ?? 0, missed: record?.missed ?? 0, received: record?.received ?? 0, volume_tUSD: record ? Number(record.volume) / 1e6 : 0, source: 'KittyLedger on Creditcoin CC3 Testnet · inputs are Attestcoin-proven Sepolia txs and attested deadlines' }, null, 2)}</pre>
            </Section>
            <BadgeCard address={addr} />
            <Section title="History · every entry is a proof or an attested deadline">
              {history.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No proven activity for this address yet.</p>}
              {history.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
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
          </div>
        </div>
      )}
    </main>
  )
}
