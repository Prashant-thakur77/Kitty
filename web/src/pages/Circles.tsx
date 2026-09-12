import { Link } from 'react-router-dom'
import { useReadContracts } from 'wagmi'
import { CircleDashed, ArrowRight, Plus } from 'lucide-react'
import { useAttestation, useCircleCount } from '../hooks'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet } from '../lib/wagmi'
import type { Circle, Round } from '../lib/types'
import { usd, num } from '../lib/format'
import { Tag } from '../components/ui'
import { chainName } from '../lib/verifier'
import { Reveal, Stagger, Item } from '../components/motion'
import { Skeleton, SkeletonCard, Empty } from '../components/Skeleton'

export function Circles() {
  const { data: count, isLoading: counting } = useCircleCount()
  const n = Number(count ?? 0n)
  const q = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'getCircle', args: [BigInt(i + 1)] })),
    query: { enabled: n > 0 },
  })
  const circles = (q.data ?? []).map((r) => r.result as Circle | undefined)
  // Live state for every card in two multicalls: the current round (pot) and its deadline block, plus one attestation read for the chip.
  const { attested } = useAttestation()
  const live = useReadContracts({
    contracts: circles.flatMap((c, i) => c ? [
      { chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRound', args: [BigInt(i + 1), c.currentRound] } as const,
      { chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'deadlineHeight', args: [BigInt(i + 1), c.currentRound] } as const,
    ] : []),
    query: { enabled: circles.some(Boolean), refetchInterval: 12000 },
  })
  // Map each circle back to its pair of results (circles that failed to load take no slots).
  const liveFor = (i: number) => {
    let k = 0
    for (let j = 0; j < i; j++) if (circles[j]) k += 2
    if (!circles[i]) return undefined
    return { round: live.data?.[k]?.result as Round | undefined, deadline: live.data?.[k + 1]?.result as bigint | undefined }
  }
  const countPending = !!cfg.ledger && (counting || count === undefined)
  const loading = countPending || (n > 0 && !q.data)
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Ledger</div>
            <h1 className="text-3xl">Circles on Creditcoin</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              {countPending ? <Skeleton w={120} h={12} style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : <>{n} circle{n === 1 ? '' : 's'} · newest last</>}
            </p>
          </div>
          <Link to="/create" className="btn btn-mint no-underline"><Plus size={15} /> Create a circle</Link>
        </div>
      </Reveal>
      {loading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading circles">
          {Array.from({ length: Math.max(2, Math.min(n, 4)) }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : n === 0 ? (
        <Reveal i={1} className="mt-5">
          <Empty
            icon={<CircleDashed size={22} />}
            title="No circles yet"
            body={<>This ledger has not opened a circle. Create one from your wallet, with <code className="mono">pnpm demo create</code> from the repo, or let the worker create the demo world. <Link to="/architecture">See how a circle works</Link>.</>}
            action={{ label: <>Create a circle <ArrowRight size={14} className="arrow" /></>, to: '/create', primary: true }}
          />
        </Reveal>
      ) : (
        <Stagger className="mt-5 grid gap-3 md:grid-cols-2">
          {q.data?.map((r, i) => {
            const c = r.result as Circle | undefined
            if (!c) return null
            return (
              <Item key={i}>
                <Link to={`/circle/${i + 1}`} className="panel card-hover block p-5 no-underline" style={{ color: 'var(--ink)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="eyebrow">#{i + 1}</div><div className="display text-xl">{c.name}</div></div>
                    <Tag tone={c.status === 0 ? 'mint' : 'muted'}>{c.status === 0 ? 'active' : 'completed'}</Tag>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><div className="eyebrow">members</div><div className="mono">{c.members.length}</div></div>
                    <div><div className="eyebrow">installment</div><div className="mono">{usd(c.contribution)}</div></div>
                    <div><div className="eyebrow">round</div><div className="mono">{c.currentRound + 1} / {c.members.length}</div></div>
                    <div className="col-span-3"><div className="eyebrow">settles from</div><div className="mono text-xs">{chainName(c.chainKey)}</div></div>
                  </div>
                  {(() => {
                    const lv = liveFor(i)
                    const dl = lv?.deadline
                    const toGo = dl !== undefined && attested !== undefined ? dl - attested : undefined
                    const done = c.status !== 0
                    const chip = done ? <Tag tone="muted">completed</Tag>
                      : toGo === undefined ? <Tag tone="muted">reading attestation…</Tag>
                      : toGo <= 0n ? <Tag tone="amber">deadline attested</Tag>
                      : <Tag tone="sky">{num(toGo)} blocks to go</Tag>
                    return (
                      <div className="card-live" aria-label="Live round state">
                        <div className="cell"><div className="eyebrow">pot</div><div className="v" style={{ color: 'var(--mint)' }}>{lv?.round ? usd(lv.round.pot) : '—'}</div></div>
                        <div className="cell"><div className="eyebrow">deadline block</div><div className="v">{dl !== undefined ? num(dl) : '—'}</div></div>
                        <div className="cell"><div className="eyebrow">{done ? 'status' : `proven · ${lv?.round ? `${lv.round.contributions}/${c.members.length}` : '—'}`}</div><div className="v">{chip}</div></div>
                      </div>
                    )
                  })()}
                </Link>
              </Item>
            )
          })}
        </Stagger>
      )}
    </main>
  )
}
