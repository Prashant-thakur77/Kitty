import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Wallet, LogOut, Menu, X, Send, Compass, BookOpen } from 'lucide-react'
import 'viem/window'
import { useAttestation } from '../hooks'
import { useScrolled, EASE_OUT } from './motion'
import { short, num } from '../lib/format'
import { useTelegram, TELEGRAM_BOT_URL } from '../lib/telegram'
import { useTour } from '../tour/Tour'

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

/** Sepolia head against the attested frontier. In the header the words show only from the `wide` breakpoint; the lag pill always
 *  does, carrying the full sentence in its title. `full` (the sheet) shows everything. */
function AttestationPill({ className = '', tour, full = false }: { className?: string; tour?: string; full?: boolean }) {
  const { head, attested, lag } = useAttestation()
  const text = `Latest Sepolia block ${num(head)}, latest block attested on Creditcoin ${num(attested)}${lag !== undefined ? `, lag ${lag}` : ''}`
  const words = full ? '' : 'hidden wide:inline'
  return (
    <div className={`shrink-0 items-center gap-2 whitespace-nowrap text-xs mono ${className}`} data-tour={tour} title={`${text}. The attestor network's attestation is the only clock Kitty uses.`}>
      <span className={words} style={{ color: 'var(--muted)' }}>Sepolia</span><span className={words}>{num(head)}</span>
      <span className={words} style={{ color: 'var(--muted)' }}>→ attested</span><span className={words} style={{ color: 'var(--sky)' }}>{num(attested)}</span>
      {lag !== undefined ? <span className="pill sky" title={text}>lag {lag}</span> : <span className="pill" title={text}>attesting…</span>}
    </div>
  )
}

/** Link to the Kitty bot: proofs, deadline reminders and the Mini App, in Telegram. Hidden inside Telegram itself.
 *  `compact` (the header) drops the word under the `tools` breakpoint and keeps the icon. */
function TelegramPill({ className = '', tour, compact = false }: { className?: string; tour?: string; compact?: boolean }) {
  const { inTelegram } = useTelegram()
  if (inTelegram) return null
  return (
    <a href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer" className={`pill sky no-underline ${className}`} style={compact ? { minHeight: 28, padding: '.2rem .55rem' } : undefined} data-tour={tour} aria-label="Kitty on Telegram" title="Kitty on Telegram: /circle, /score, proof pushes and deadline reminders, and the Mini App">
      <Send size={12} /><span className={compact ? 'hidden tools:inline' : ''}>Telegram</span>
    </a>
  )
}

/** `full` stretches the control across the sheet; `compact` (the header) shortens the read-only pill under the `tools` breakpoint. */
function WalletControl({ full = false, compact = false }: { full?: boolean; compact?: boolean }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'
  const { disconnect } = useDisconnect()
  const { inTelegram } = useTelegram()
  const w = full ? ' w-full' : ''
  if (isConnected) return <button className={`btn${w}`} onClick={() => disconnect()} title={`Connected as ${address}. Click to disconnect.`} aria-label={`Disconnect wallet ${short(address)}`}><LogOut size={15} /> <span className="mono text-sm">{short(address)}</span></button>
  // Telegram Mini Apps have no injected wallet (no MetaMask): read everything here, pay from a wallet browser.
  if (inTelegram && noWallet) return <span className={`pill sky${full ? ' wrap' : ''}`} title="Telegram Mini Apps cannot inject a wallet. Open this page in MetaMask, Rabby or any wallet browser to pay or prove.">{compact ? 'read-only' : 'open in a wallet browser to pay'}</span>
  if (noWallet) return <span className="pill amber" title="No wallet detected. Proving from the browser needs any EVM wallet holding a little tCTC on Creditcoin Testnet; everything else is readable without one."><span className={compact ? 'hidden tools:inline' : ''}>no wallet ·</span>read-only</span>
  return (
    <>
      <button className={`btn btn-mint${w}`} disabled={isPending} onClick={() => connect({ connector: connectors[0] })} title="Connect an EVM wallet to pay, prove and create"><Wallet size={15} /> Connect</button>
      {error && <span className="max-w-[26ch] text-xs leading-tight" style={{ color: 'var(--amber)' }}>{(error as { shortMessage?: string }).shortMessage ?? error.message}</span>}
    </>
  )
}

export function Nav() {
  const scrolled = useScrolled()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const tour = useTour()
  useEffect(() => { setOpen(false) }, [pathname])
  const startTour = () => { setOpen(false); tour.start() }

  return (
    <header className="nav noprint sticky top-0 z-30" data-scrolled={scrolled}>
      <div className="mx-auto max-w-[1720px] px-5 py-3 md:px-8 lg:px-10">
        {/* logo at the far left, links 24px after it, tools at the far right; every part is `shrink-0` so the row never wraps */}
        <div className="flex min-h-10 items-center gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 no-underline" style={{ color: 'var(--ink)' }} aria-label="Kitty home">
            <img src={`${import.meta.env.BASE_URL}kitty.svg`} alt="" width={28} height={28} />
            <span className="display text-2xl" style={{ letterSpacing: '-.01em' }}>Kitty</span>
          </Link>
          <nav className="hidden shrink-0 items-center gap-1 nav:ml-6 nav:flex" aria-label="Primary" data-tour="nav"><Links group="desktop" /></nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
            <AttestationPill className="hidden md:flex" tour="attestation" />
            {/* wrapped: `.pill` and `.btn` set display outside Tailwind's layers, so `hidden` on them would never win */}
            <span className="hidden md:inline-flex"><TelegramPill tour="telegram" compact /></span>
            <span className="hidden md:inline-flex"><button type="button" className="btn btn-ghost btn-icon" onClick={startTour} title="Take the tour: two minutes, every tab" aria-label="Take the tour"><Compass size={16} /></button></span>
            <div className="hidden items-center gap-3 md:flex"><WalletControl compact /></div>
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <div className="nav:hidden">
                <Dialog.Trigger asChild>
                  <button className="btn btn-ghost btn-icon" aria-label="Open menu" aria-expanded={open} title="Menu" data-tour="nav-menu"><Menu size={20} /></button>
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
                          <Dialog.Close asChild><button className="btn btn-ghost btn-icon" aria-label="Close menu"><X size={18} /></button></Dialog.Close>
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
                        <div className="mt-3 grid gap-1" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                          <button type="button" className="navlink navlink-lg flex items-center gap-2 text-left" style={{ background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'var(--body)' }} onClick={startTour}><Compass size={16} /> Take the tour</button>
                          <NavLink to="/guide" className={({ isActive }) => `navlink navlink-lg flex items-center gap-2${isActive ? ' active' : ''}`}><BookOpen size={16} /> What each tab does</NavLink>
                        </div>
                        <div className="sheet-foot">
                          <div className="eyebrow mb-2">Attestation</div>
                          <AttestationPill className="flex flex-wrap" full />
                          <div className="mt-3 flex flex-col gap-2"><WalletControl full /><Link to="/create" className="btn w-full no-underline" title="Open the create form: one Creditcoin transaction opens a circle">Create a circle</Link><TelegramPill className="justify-center" /></div>
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
