import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useAttestation } from '../hooks'
import { short, num } from '../lib/format'

export function Header() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { head, attested, lag } = useAttestation()
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐈</span>
          <h1 className="text-2xl font-bold tracking-tight">Kitty</h1>
          <span className="pill">DeFi · BUIDL CTC 2026 Fall</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Savings circles where every payment is proven, not promised.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="panel px-3 py-2 text-xs mono">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--muted)' }}>Sepolia head</span>
            <span>{num(head)}</span>
            <span style={{ color: 'var(--muted)' }}>→ attested on Creditcoin</span>
            <span style={{ color: 'var(--mint)' }}>{num(attested)}</span>
            {lag !== undefined && <span className="pill">lag {lag} blocks</span>}
          </div>
        </div>
        {isConnected ? (
          <button className="btn" onClick={() => disconnect()}>{short(address)} · disconnect</button>
        ) : (
          <button className="btn btn-mint" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
        )}
      </div>
    </header>
  )
}
