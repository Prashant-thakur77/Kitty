import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Wallet, LogOut, Menu, X, Send } from 'lucide-react'
import 'viem/window'
import { useAttestation } from '../hooks'
import { useScrolled, EASE_OUT } from './motion'
import { short, num } from '../lib/format'
import { useTelegram, TELEGRAM_BOT_URL } from '../lib/telegram'

const LINKS = [
  { to: '/circles', label: 'Circles' },
  { to: '/score', label: 'Score' },
  { to: '/borrow', label: 'Borrow' },
  { to: '/steward', label: 'Steward' },
  { to: '/lab', label: 'Attack lab' },
  { to: '/architecture', label: 'Architecture' },
  { to: '/presentation', label: 'Present' },
]

/** The nav links; the active one carries a shared-layout pill that slides between links as the route changes. */
function Links({ group }: { group: string }) {
  const reduced = useReducedMotion()
  return (
    <>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId={`nav-pill-${group}`} className="navlink-pill" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }} aria-hidden />}
              <span className="relative">{l.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  )
}

function AttestationPill({ className = '' }: { className?: string }) {
  const { head, attested, lag } = useAttestation()
  return (
    <div className={`shrink-0 items-center gap-2 whitespace-nowrap text-xs mono ${className}`} title="Latest Sepolia block vs the latest block attested on Creditcoin by the attestor network">
      <span style={{ color: 'var(--muted)' }}>Sepolia</span><span>{num(head)}</span>
      <span style={{ color: 'var(--muted)' }}>→ attested</span><span style={{ color: 'var(--sky)' }}>{num(attested)}</span>
      {lag !== undefined && <span className="pill sky">lag {lag}</span>}
    </div>
  )
}

/** Compact link to the Kitty bot: proofs, deadline reminders and the Mini App, in Telegram. Hidden inside Telegram itself. */
function TelegramPill({ className = '' }: { className?: string }) {
  const { inTelegram } = useTelegram()
  if (inTelegram) return null
  return (
    <a href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer" className={`pill sky no-underline ${className}`} title="Kitty on Telegram: /circle, /score, proof pushes and deadline reminders, and the Mini App">
      <Send size={12} /> Telegram
    </a>
  )
}

function WalletControl({ full = false }: { full?: boolean }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'
  const { disconnect } = useDisconnect()
  const { inTelegram } = useTelegram()
  const w = full ? ' w-full justify-center' : ''
  if (isConnected) return <button className={`btn${w}`} onClick={() => disconnect()} aria-label={`Disconnect wallet ${short(address)}`}><LogOut size={15} /> {short(address)}</button>
  // Telegram Mini Apps have no injected wallet (no MetaMask): read everything here, pay from a wallet browser.
  if (inTelegram && noWallet) return <span className={`pill sky${full ? ' wrap' : ''}`} title="Telegram Mini Apps cannot inject a wallet. Open this page in MetaMask, Rabby or any wallet browser to pay or prove.">open in a wallet browser to pay</span>
  if (noWallet) return <span className="pill amber" title="Proving from the browser needs any EVM wallet holding a little tCTC on Creditcoin Testnet">no wallet · read-only</span>
  return (
    <>
      <button className={`btn btn-mint${w}`} disabled={isPending} onClick={() => connect({ connector: connectors[0] })}><Wallet size={15} /> Connect</button>
      {error && <span className="max-w-[26ch] text-xs leading-tight" style={{ color: 'var(--amber)' }}>{(error as { shortMessage?: string }).shortMessage ?? error.message}</span>}
    </>
  )
}

export function Nav() {
  const scrolled = useScrolled()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  useEffect(() => { setOpen(false) }, [pathname])

  return (
    <header className="nav noprint sticky top-0 z-30" data-scrolled={scrolled}>
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 no-underline" style={{ color: 'var(--ink)' }} aria-label="Kitty home">
            <img src={`${import.meta.env.BASE_URL}kitty.svg`} alt="" width={28} height={28} />
            <span className="display text-2xl" style={{ letterSpacing: '-.01em' }}>Kitty</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex md:ml-4" aria-label="Primary"><Links group="desktop" /></nav>
          <div className="ml-auto flex items-center gap-3">
            <AttestationPill className="hidden lg:flex" />
            <TelegramPill className="hidden md:inline-flex" />
            <div className="hidden items-center gap-3 md:flex"><WalletControl /></div>
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <div className="md:hidden">
                <Dialog.Trigger asChild>
                  <button className="btn btn-ghost" aria-label="Open menu" aria-expanded={open} style={{ padding: '.5rem' }}><Menu size={20} /></button>
                </Dialog.Trigger>
              </div>
              <AnimatePresence>
                {open && (
                  <Dialog.Portal forceMount>
                    <Dialog.Overlay asChild forceMount>
                      <motion.div className="sheet-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.22 }} />
                    </Dialog.Overlay>
                    <Dialog.Content asChild forceMount aria-describedby={undefined}>
                      <motion.div
                        className="sheet"
                        initial={reduced ? { opacity: 0 } : { x: '100%' }}
                        animate={reduced ? { opacity: 1 } : { x: 0 }}
                        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { x: '100%', transition: { duration: 0.22, ease: EASE_OUT } }}
                        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
                      >
                        <div className="flex items-center justify-between">
                          <Dialog.Title className="display text-2xl" style={{ letterSpacing: '-.01em' }}>Kitty</Dialog.Title>
                          <Dialog.Close asChild><button className="btn btn-ghost" aria-label="Close menu" style={{ padding: '.5rem' }}><X size={18} /></button></Dialog.Close>
                        </div>
                        <motion.nav
                          className="mt-5 grid gap-1" aria-label="Primary"
                          initial="hidden" animate="show"
                          variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.035, delayChildren: reduced ? 0 : 0.08 } } }}
                        >
                          {LINKS.map((l) => (
                            <motion.div key={l.to} variants={{ hidden: reduced ? { opacity: 1 } : { opacity: 0, x: 16 }, show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE_OUT } } }}>
                              <NavLink to={l.to} className={({ isActive }) => `navlink navlink-lg flex${isActive ? ' active' : ''}`}>
                                {({ isActive }) => (
                                  <>
                                    {isActive && <motion.span layoutId="nav-pill-sheet" className="navlink-pill" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }} aria-hidden />}
                                    <span className="relative">{l.label}</span>
                                  </>
                                )}
                              </NavLink>
                            </motion.div>
                          ))}
                        </motion.nav>
                        <div className="sheet-foot">
                          <div className="eyebrow mb-2">Attestation</div>
                          <AttestationPill className="flex flex-wrap" />
                          <div className="mt-3 flex flex-col gap-2"><WalletControl full /><TelegramPill className="justify-center" /></div>
                        </div>
                      </motion.div>
                    </Dialog.Content>
                  </Dialog.Portal>
                )}
              </AnimatePresence>
            </Dialog.Root>
          </div>
        </div>
      </div>
    </header>
  )
}
