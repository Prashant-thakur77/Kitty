import { NavLink, Link } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Wallet, LogOut } from 'lucide-react'
import { useAttestation } from '../hooks'
import { short, num } from '../lib/format'

export function Nav() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { head, attested, lag } = useAttestation()
  return (
    <header className="noprint sticky top-0 z-30 border-b" style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(10px)', borderColor: 'var(--line)' }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 no-underline" style={{ color: 'var(--ink)' }}>
          <img src="/kitty.svg" alt="" width={28} height={28} />
          <span className="display text-xl">Kitty</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 sm:ml-4">
          <NavLink to="/circles" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Circles</NavLink>
          <NavLink to="/score" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Score</NavLink>
          <NavLink to="/lab" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Attack lab</NavLink>
          <NavLink to="/architecture" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Architecture</NavLink>
          <NavLink to="/presentation" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Present</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 text-xs mono md:flex" title="Latest Sepolia block vs the latest block attested on Creditcoin by the attestor network">
            <span style={{ color: 'var(--muted)' }}>Sepolia</span><span>{num(head)}</span>
            <span style={{ color: 'var(--muted)' }}>→ attested</span><span style={{ color: 'var(--sky)' }}>{num(attested)}</span>
            {lag !== undefined && <span className="pill sky">lag {lag}</span>}
          </div>
          {isConnected ? (
            <button className="btn" onClick={() => disconnect()}><LogOut size={15} /> {short(address)}</button>
          ) : (
            <button className="btn btn-mint" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}><Wallet size={15} /> Connect</button>
          )}
        </div>
      </div>
    </header>
  )
}
