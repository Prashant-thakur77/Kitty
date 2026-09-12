import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Nav } from './components/Nav'
import { EASE_OUT } from './components/motion'
import { Landing } from './pages/Landing'
import { Circles } from './pages/Circles'
import { CirclePage } from './pages/Circle'
import { ScorePage } from './pages/Score'
import { Lab } from './pages/Lab'
import { Steward } from './pages/Steward'
import { Borrow } from './pages/Borrow'
import { Architecture } from './pages/Architecture'
import { Presentation } from './pages/Presentation'
import { cfg } from './config'

/** A thin mint bar at the very top that runs while one page leaves and the next arrives. */
function RouteProgress({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {active && !reduced && (
        <motion.div
          className="route-progress" aria-hidden
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 0.85, transition: { duration: 0.5, ease: EASE_OUT } }}
          exit={{ scaleX: 1, opacity: 0, transition: { scaleX: { duration: 0.15 }, opacity: { duration: 0.25, delay: 0.1 } } }}
        />
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const location = useLocation()
  const reduced = useReducedMotion()
  const [busy, setBusy] = useState(false)
  const prev = useRef(location.pathname)
  // The bar starts the moment the URL changes and stops once the incoming page has finished its rise (not on first paint;
  // comparing against the previous path keeps StrictMode's double effect idempotent).
  useEffect(() => { if (prev.current !== location.pathname) { prev.current = location.pathname; setBusy(true) } }, [location.pathname])

  const page = reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8, transition: { duration: 0.16, ease: EASE_OUT } }, transition: { duration: 0.22, ease: EASE_OUT } }

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <RouteProgress active={busy} />
      <Nav />
      {!cfg.ledger && (
        <div className="mx-auto mt-4 max-w-6xl px-4">
          <div className="panel p-4 text-sm" style={{ color: 'var(--amber)' }}>
            KittyLedger is not configured yet: <code className="mono">VITE_KITTY_LEDGER_ADDRESS</code> is empty. Sepolia contracts are set; the Creditcoin side deploys with <code className="mono">scripts/deploy.sh</code> once the deployer holds tCTC.
          </div>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })}>
        <motion.div
          key={location.pathname}
          id="main"
          tabIndex={-1}
          className="route"
          {...page}
          onAnimationComplete={(def) => { if ((def as { opacity?: number }).opacity === 1) setBusy(false) }}
        >
          <Routes location={location}>
            <Route path="/" element={<Landing />} />
            <Route path="/circles" element={<Circles />} />
            <Route path="/circle/:id" element={<CirclePage />} />
            <Route path="/score" element={<ScorePage />} />
            <Route path="/score/:address" element={<ScorePage />} />
            <Route path="/borrow" element={<Borrow />} />
            <Route path="/steward" element={<Steward />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/architecture" element={<Architecture />} />
            <Route path="/presentation" element={<Presentation />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </>
  )
}
