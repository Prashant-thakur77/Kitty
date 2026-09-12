import { NavLink, Link } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Wallet, LogOut } from 'lucide-react'
import 'viem/window'
import { useAttestation } from '../hooks'
import { useScrolled } from './motion'
import { short, num } from '../lib/format'

export function Nav() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'
  const { disconnect } = useDisconnect()
  const { head, attested, lag } = useAttestation()
  const scrolled = useScrolled()
  const links = (
    <>
      <NavLink to="/circles" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Circles</NavLink>
      <NavLink to="/score" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Score</NavLink>
      <NavLink to="/borrow" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Borrow</NavLink>
      <NavLink to="/lab" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Attack lab</NavLink>
      <NavLink to="/architecture" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Architecture</NavLink>
      <NavLink to="/presentation" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>Present</NavLink>
    </>
  )
  return (
    <header className="nav noprint sticky top-0 z-30" data-scrolled={scrolled}>
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 no-underline" style={{ color: 'var(--ink)' }}>
            <img src={`${import.meta.env.BASE_URL}kitty.svg`} alt="" width={28} height={28} />
            <span className="display text-2xl" style={{ letterSpacing: "-.01em" }}>Kitty</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex md:ml-4">{links}</nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 text-xs mono lg:flex" title="Latest Sepolia block vs the latest block attested on Creditcoin by the attestor network">
              <span style={{ color: 'var(--muted)' }}>Sepolia</span><span>{num(head)}</span>
              <span style={{ color: 'var(--muted)' }}>→ attested</span><span style={{ color: 'var(--sky)' }}>{num(attested)}</span>
              {lag !== undefined && <span className="pill sky">lag {lag}</span>}
            </div>
            {isConnected ? (
              <button className="btn" onClick={() => disconnect()}><LogOut size={15} /> {short(address)}</button>
            ) : noWallet ? (
              <span className="pill amber" title="Proving from the browser needs any EVM wallet holding a little tCTC on Creditcoin Testnet">no wallet · install MetaMask to prove from the browser</span>
            ) : (
              <>
                <button className="btn btn-mint" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}><Wallet size={15} /> Connect</button>
                {error && <span className="max-w-[26ch] text-xs leading-tight" style={{ color: 'var(--amber)' }}>{(error as { shortMessage?: string }).shortMessage ?? error.message}</span>}
              </>
            )}
          </div>
        </div>
        {/* phones: one scrollable row of links under the logo line */}
        <nav className="mt-2 flex gap-1 overflow-x-auto pb-1 md:hidden" style={{ scrollbarWidth: 'none' }}>{links}</nav>
      </div>
    </header>
  )
}
