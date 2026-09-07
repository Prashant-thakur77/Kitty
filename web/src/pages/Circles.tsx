import { Link } from 'react-router-dom'
import { useReadContracts } from 'wagmi'
import { useCircleCount } from '../hooks'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet } from '../lib/wagmi'
import type { Circle } from '../lib/types'
import { usd } from '../lib/format'
import { Tag } from '../components/ui'

export function Circles() {
  const { data: count } = useCircleCount()
  const n = Number(count ?? 0n)
  const q = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'getCircle', args: [BigInt(i + 1)] })),
    query: { enabled: n > 0 },
  })
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl">Circles on Creditcoin</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{n} circle{n === 1 ? '' : 's'} · newest last</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {n === 0 && <div className="panel p-5 text-sm" style={{ color: 'var(--muted)' }}>No circles yet. Run <code className="mono">pnpm demo create</code> or create one from the worker.</div>}
        {q.data?.map((r, i) => {
          const c = r.result as Circle | undefined
          if (!c) return null
          return (
            <Link key={i} to={`/circle/${i + 1}`} className="panel block p-5 no-underline" style={{ color: 'var(--ink)' }}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="eyebrow">#{i + 1}</div><div className="display text-xl">{c.name}</div></div>
                <Tag tone={c.status === 0 ? 'mint' : 'muted'}>{c.status === 0 ? 'active' : 'completed'}</Tag>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="eyebrow">members</div><div className="mono">{c.members.length}</div></div>
                <div><div className="eyebrow">installment</div><div className="mono">{usd(c.contribution)}</div></div>
                <div><div className="eyebrow">round</div><div className="mono">{c.currentRound + 1} / {c.members.length}</div></div>
              </div>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
