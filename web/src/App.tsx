import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { CirclePanel } from './components/CirclePanel'
import { ProofFeed } from './components/ProofFeed'
import { useCircleCount } from './hooks'
import { cfg } from './config'

export default function App() {
  const { data: count } = useCircleCount()
  const [id, setId] = useState<bigint | undefined>()
  useEffect(() => { if (count !== undefined && id === undefined && (count as bigint) > 0n) setId(count as bigint) }, [count, id])
  const n = Number(count ?? 0n)
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <Header />
      {!cfg.ledger && (
        <div className="panel p-5 text-sm" style={{ color: 'var(--amber)' }}>
          No deployment configured. Run <code className="mono">scripts/deploy.sh</code> (writes web/.env) or copy web/.env.example.
        </div>
      )}
      {cfg.ledger && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Circles on Creditcoin:</span>
            {n === 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>none yet — run <code className="mono">pnpm demo create</code></span>}
            {Array.from({ length: n }, (_, i) => BigInt(i + 1)).map((c) => (
              <button key={String(c)} className="btn" style={id === c ? { borderColor: 'var(--mint)', color: 'var(--mint)' } : {}} onClick={() => setId(c)}>#{String(c)}</button>
            ))}
          </div>
          <div className="grid gap-4">
            {id !== undefined && <CirclePanel circleId={id} />}
            <ProofFeed circleId={id} />
          </div>
        </>
      )}
      <footer className="mt-10 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        Money: KittyVault on Ethereum Sepolia (chainKey {cfg.sourceChainKey}). Rules: KittyLedger on Creditcoin CC3 Testnet. Proofs: Attestcoin block-prover
        precompile 0x0FD2 (batch verify) + ChainInfo precompile 0x0FD3 (attested-height clock). No oracle operator, no bridge, no treasurer.
      </footer>
    </div>
  )
}
