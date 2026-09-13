/**
 * The guided tour: a spotlight overlay that walks through every tab. Dependency-free (motion for the transitions, the
 * router for navigation). `TourProvider` owns the step index and resolves each step's route against the ledger;
 * `useTour()` exposes start/stop to the nav, the guide page and the first-visit prompt; `?tour=1` (or `?tour=<stepId>`)
 * on any URL starts it. Completion, skips and the dismissed prompt persist under `kitty.tour.v1`.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, Compass, Info, X } from 'lucide-react'
import { STEPS, stepIndex, type Placement, type TourStep } from './steps'
import { useCircle, useCircleCount } from '../hooks'
import { EASE_OUT } from '../components/motion'
import './tour.css'

export const TOUR_STORAGE_KEY = 'kitty.tour.v1'
type Saved = { completed?: string; skipped?: string; promptDismissed?: string }
function load(): Saved { try { return JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? '{}') as Saved } catch { return {} } }
function save(patch: Partial<Saved>) { try { localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ ...load(), ...patch })) } catch { /* private mode or blocked storage: the tour still runs, it just does not remember */ } }

const TAB_LABEL: Record<TourStep['tab'], string> = { nav: 'Navigation', landing: 'Home', circles: 'Circles', circle: 'A circle', create: 'Create', score: 'Score', borrow: 'Borrow', steward: 'Steward', lab: 'Attack lab', architecture: 'Architecture', present: 'Present', telegram: 'Telegram', story: 'Story' }

type Ctx = { active: boolean; index: number; step?: TourStep; start: (at?: string | number) => void; stop: () => void; next: () => void; back: () => void }
const TourCtx = createContext<Ctx | null>(null)
export function useTour(): Ctx {
  const c = useContext(TourCtx)
  if (!c) throw new Error('useTour must be used inside <TourProvider>')
  return c
}

/** `:latest` → the newest circle id, `:member` → its first member. Undefined while the ledger is still being read. */
function resolveRoute(route: string, r: { latest?: bigint; member?: `0x${string}`; pending: boolean }): string | undefined {
  if (route.includes(':latest')) return r.latest !== undefined ? route.replace(':latest', String(r.latest)) : r.pending ? undefined : '/circles'
  if (route.includes(':member')) return r.member ? route.replace(':member', r.member) : r.pending ? undefined : '/score'
  return route
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(-1)
  const active = index >= 0
  const navigate = useNavigate()
  const location = useLocation()
  const count = useCircleCount()
  const latest = count.data !== undefined && (count.data as bigint) > 0n ? (count.data as bigint) : undefined
  const { circle, isLoading: circleLoading } = useCircle(latest)
  const member = circle?.members[0]
  const pending = count.isLoading || (latest !== undefined && circleLoading)

  const stop = useCallback((reason: 'skip' | 'done' = 'skip') => {
    save(reason === 'done' ? { completed: new Date().toISOString() } : { skipped: new Date().toISOString() })
    setIndex(-1)
  }, [])
  const start = useCallback((at?: string | number) => {
    save({ promptDismissed: new Date().toISOString() })
    setIndex(typeof at === 'number' ? Math.max(0, Math.min(STEPS.length - 1, at)) : at ? stepIndex(at) : 0)
  }, [])
  const indexRef = useRef(index)
  useEffect(() => { indexRef.current = index }, [index])
  const next = useCallback(() => { if (indexRef.current >= STEPS.length - 1) stop('done'); else setIndex(indexRef.current + 1) }, [stop])
  const back = useCallback(() => setIndex(Math.max(0, indexRef.current - 1)), [])

  // `?tour=1` or `?tour=<stepId>` on any URL starts the tour and drops the parameter from the address bar.
  useEffect(() => {
    const p = new URLSearchParams(location.search)
    const t = p.get('tour')
    if (!t) return
    p.delete('tour')
    navigate({ pathname: location.pathname, search: p.toString() ? `?${p.toString()}` : '', hash: location.hash }, { replace: true })
    start(t === '1' ? 0 : t)
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = active ? STEPS[index] : undefined
  const route = step ? resolveRoute(step.route, { latest, member, pending }) : undefined
  useEffect(() => { if (route && location.pathname !== route) navigate(route) }, [route, index]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<Ctx>(() => ({ active, index, step, start, stop: () => stop('skip'), next, back }), [active, index, step, start, stop, next, back])
  return (
    <TourCtx.Provider value={value}>
      {children}
      <AnimatePresence>{active && step && <TourOverlay key="tour" step={step} index={index} onRoute={route !== undefined && location.pathname === route} routePending={route === undefined} next={next} back={back} skip={() => stop('skip')} />}</AnimatePresence>
      <FirstVisitPrompt active={active} start={start} />
    </TourCtx.Provider>
  )
}

/* ───────────────────────────── overlay ───────────────────────────── */

type Rect = { top: number; left: number; width: number; height: number }
const same = (a: Rect | null, b: Rect) => !!a && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
const toRect = (r: DOMRect): Rect => ({ top: r.top, left: r.left, width: r.width, height: r.height })
const NAV_H = 64
const FIND_TIMEOUT = 6000
const HIDDEN_TIMEOUT = 1500

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/** True when the element or an ancestor is position: fixed (it will not move when the page scrolls). */
function isFixed(el: HTMLElement) {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true
  return false
}

/**
 * The document scroll position that puts the element in the free area: the viewport under the nav on desktop, the part above the
 * sheet on phones. A wide element that leaves no room for the card beside it is placed so element and card stack vertically;
 * anything taller than the free area is aligned under the nav. Null for fixed elements, which do not move with the page.
 */
function desiredScrollTop(el: HTMLElement, card: { w: number; h: number }, placement: Placement, mobile: boolean): number | null {
  if (isFixed(el)) return null
  const r = el.getBoundingClientRect()
  const docTop = r.top + window.scrollY
  const vw = window.innerWidth, vh = window.innerHeight
  const pad = 16, gap = 14, top = NAV_H + 12
  const bottom = mobile ? vh - card.h - 12 : vh - pad
  const visible = Math.max(120, bottom - top)
  const sideRoom = !mobile && (r.left >= card.w + gap + pad || vw - (r.left + r.width) >= card.w + gap + pad)
  let viewportTop: number
  if (mobile || sideRoom) viewportTop = r.height >= visible ? top : top + (visible - r.height) / 2
  else {
    const needed = r.height + gap + card.h
    if (needed <= visible) { const start = top + (visible - needed) / 2; viewportTop = placement === 'top' ? start + card.h + gap : start }
    else viewportTop = top
  }
  const max = Math.max(0, document.documentElement.scrollHeight - vh)
  return Math.min(max, Math.max(0, docTop - viewportTop))
}

/** Where the card goes on desktop: the preferred side if it fits, else the first side that does, else along the bottom edge. */
function placeCard(rect: Rect, card: { w: number; h: number }, pref: Placement, vw: number, vh: number) {
  const gap = 14, pad = 16
  const cx = (x: number) => Math.min(Math.max(x, pad), Math.max(pad, vw - pad - card.w))
  const cy = (y: number) => Math.min(Math.max(y, pad), Math.max(pad, vh - pad - card.h))
  const fits = (p: { x: number; y: number }) => p.x >= pad && p.y >= pad && p.x + card.w <= vw - pad && p.y + card.h <= vh - pad
  const c: Record<Exclude<Placement, 'auto'>, { x: number; y: number }> = {
    bottom: { x: cx(rect.left + rect.width / 2 - card.w / 2), y: rect.top + rect.height + gap },
    top: { x: cx(rect.left + rect.width / 2 - card.w / 2), y: rect.top - gap - card.h },
    right: { x: rect.left + rect.width + gap, y: cy(rect.top + rect.height / 2 - card.h / 2) },
    left: { x: rect.left - gap - card.w, y: cy(rect.top + rect.height / 2 - card.h / 2) },
  }
  const order: Exclude<Placement, 'auto'>[] = pref === 'auto' ? ['bottom', 'right', 'top', 'left'] : [pref, ...(['bottom', 'right', 'top', 'left'] as const).filter((k) => k !== pref)]
  for (const k of order) if (fits(c[k])) return c[k]
  return { x: Math.max(pad, vw - pad - card.w), y: Math.max(pad, vh - pad - card.h) }
}

function TourOverlay({ step, index, onRoute, routePending, next, back, skip }: { step: TourStep; index: number; onRoute: boolean; routePending: boolean; next: () => void; back: () => void; skip: () => void }) {
  const reduced = !!useReducedMotion()
  const mobile = useMediaQuery('(max-width: 639px)')
  const [rect, setRect] = useState<Rect | null>(null)
  const [status, setStatus] = useState<'searching' | 'found' | 'missing' | 'none'>('searching')
  const [sheetSide, setSheetSide] = useState<'bottom' | 'top'>('bottom')
  const [card, setCard] = useState({ w: 380, h: 220 })
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  const cardRef = useRef<HTMLDivElement>(null)
  const total = STEPS.length
  const selector = mobile && step.mobileTarget ? step.mobileTarget : step.target

  // Find the target: poll until it exists (the page may still be arriving), give up after FIND_TIMEOUT; an element that exists but
  // has no box (display: none at this width) is treated as missing after a short grace. Once found, scroll it into the free area
  // and keep measuring so the hole follows scrolling, resizing and the page's own entry animation.
  useEffect(() => {
    setStatus(selector ? 'searching' : 'none'); setRect(null); setSheetSide('bottom')
    if (!onRoute || !selector) return
    let cancelled = false
    let el: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    const t0 = performance.now()
    const measure = () => { if (!el || cancelled) return; const r = toRect(el.getBoundingClientRect()); setRect((prev) => (same(prev, r) ? prev : r)) }
    const tick = () => {
      if (cancelled) return
      el = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`)
      const elapsed = performance.now() - t0
      if (!el) { if (elapsed > FIND_TIMEOUT) setStatus('missing'); else timer = setTimeout(tick, 120); return }
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) { el = null; if (elapsed > HIDDEN_TIMEOUT) setStatus('missing'); else timer = setTimeout(tick, 120); return }
      setStatus('found')
      if (mobile && isFixed(el) && r.top + r.height / 2 > window.innerHeight * 0.55) setSheetSide('top')
      // The card's size decides the free area; it settles after the content transition, so re-aim the scroll for the first few ticks.
      const found = performance.now()
      let aimed = -1
      const aim = () => {
        if (!el) return
        const c = cardRef.current?.getBoundingClientRect()
        const target = desiredScrollTop(el, { w: c?.width ?? 380, h: Math.max(200, c?.height ?? 260) }, step.placement, mobile)
        if (target === null || Math.abs(target - (aimed < 0 ? window.scrollY : aimed)) < 4) { if (aimed < 0) aimed = window.scrollY; return }
        aimed = target
        window.scrollTo({ top: target, behavior: reduced ? 'instant' : 'smooth' })
      }
      aim(); measure()
      interval = setInterval(() => { if (performance.now() - found < 700) aim(); measure() }, 150)
    }
    tick()
    const on = () => measure()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => { cancelled = true; if (timer) clearTimeout(timer); if (interval) clearInterval(interval); window.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [step.id, step.placement, selector, onRoute, mobile, reduced])

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // The card's own size decides where it fits; measure it whenever its content changes.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const read = () => { const r = el.getBoundingClientRect(); setCard((c) => (Math.abs(c.w - r.width) < 0.5 && Math.abs(c.h - r.height) < 0.5 ? c : { w: r.width, h: r.height })) }
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : undefined
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [step.id, mobile, status])

  // Keyboard: arrows and Escape, captured before the deck and the story see them. Tab stays inside the card.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip() }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'Backspace') { if (!(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [next, back, skip])
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }) }, [step.id])
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !cardRef.current) return
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button, a[href]')).filter((b) => !b.hasAttribute('disabled'))
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const spot = rect && status === 'found'
  // SVG geometry animates as attributes (attrX/attrY), not transforms, so the hole and the mask agree exactly.
  const hole = spot ? { attrX: rect.left - 8, attrY: rect.top - 8, width: rect.width + 16, height: rect.height + 16 } : { attrX: vp.w / 2, attrY: vp.h / 2, width: 0, height: 0 }
  const pos = !mobile && spot ? placeCard(rect, card, step.placement, vp.w, vp.h) : { x: Math.max(16, vp.w / 2 - card.w / 2), y: Math.max(16, vp.h / 2 - card.h / 2) }
  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 34, mass: 0.8 }
  const missing = status === 'missing'
  const last = index === total - 1

  return (
    <>
      <motion.svg className="tour-overlay" aria-hidden initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.2 } }} transition={{ duration: 0.25, ease: EASE_OUT }} onClick={(e) => e.preventDefault()}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="#fff" />
            <motion.rect initial={false} animate={hole} transition={spring} rx={14} ry={14} fill="#000" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(5, 10, 8, 0.76)" mask="url(#tour-mask)" />
        <motion.rect initial={false} animate={{ ...hole, opacity: spot ? 1 : 0 }} transition={spring} rx={14} ry={14} fill="none" stroke="var(--mint)" strokeOpacity={0.75} strokeWidth={1.5} />
      </motion.svg>
      <motion.div
        ref={cardRef}
        className={`tour-card${mobile ? ` tour-sheet ${sheetSide}` : ''}`}
        role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}
        onKeyDown={trapTab}
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={mobile ? { opacity: 1, y: 0 } : { opacity: 1, x: pos.x, y: pos.y }}
        exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.18 } }}
        transition={spring}
        style={mobile ? undefined : { left: 0, top: 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="eyebrow">{index + 1} / {total} · {TAB_LABEL[step.tab]}</div>
          <button type="button" className="tour-x" onClick={skip} aria-label="Skip the tour" title="Skip (Esc)"><X size={15} /></button>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: reduced ? 0 : 0.12 } }} transition={{ duration: reduced ? 0 : 0.22, ease: EASE_OUT }}>
            <h2 id="tour-title" className="display mt-1">{step.title}</h2>
            <p id="tour-body" className="mt-2">{step.body}</p>
            {status === 'searching' && !routePending && <div className="mono mt-2 text-[11px]" style={{ color: 'var(--dim)' }}>finding it on the page…</div>}
            {routePending && <div className="mono mt-2 text-[11px]" style={{ color: 'var(--dim)' }}>reading the ledger…</div>}
            {missing && <div className="tour-note mt-3"><Info size={14} style={{ flex: 'none', marginTop: 2 }} /><span>Not on this screen right now: the ledger may have no circle yet, the panel may need a wider viewport, or the round is not in that state. The description still applies.</span></div>}
          </motion.div>
        </AnimatePresence>
        <div className="tour-bar mt-4" aria-hidden><motion.span initial={false} animate={{ scaleX: (index + 1) / total }} transition={reduced ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }} /></div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="tour-keys hidden sm:inline-flex"><kbd>←</kbd><kbd>→</kbd><span>steps</span><kbd>Esc</kbd><span>skip</span></span>
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" className="btn btn-ghost" style={{ padding: '.45rem .8rem', fontSize: 14 }} onClick={back} disabled={index === 0}><ArrowLeft size={14} /> Back</button>
            <button type="button" className="btn btn-mint" style={{ padding: '.45rem .95rem', fontSize: 14 }} onClick={next}>{last ? 'Finish' : 'Next'} {!last && <ArrowRight size={14} className="arrow" />}</button>
          </div>
        </div>
      </motion.div>
    </>
  )
}

/* ───────────────────────────── first-visit prompt ───────────────────────────── */

function FirstVisitPrompt({ active, start }: { active: boolean; start: (at?: string | number) => void }) {
  const [show, setShow] = useState(false)
  const location = useLocation()
  const reduced = !!useReducedMotion()
  useEffect(() => {
    const s = load()
    if (s.completed || s.skipped || s.promptDismissed) return
    if (new URLSearchParams(window.location.search).has('tour')) return
    const t = setTimeout(() => setShow(true), 2000)
    return () => clearTimeout(t)
  }, [])
  // The deck and the story are full-screen experiences; the prompt waits for the next page instead of sitting on them.
  const suppressed = active || /^\/(presentation|story)(\/|$)/.test(location.pathname)
  const dismiss = () => { save({ promptDismissed: new Date().toISOString() }); setShow(false) }
  return (
    <AnimatePresence>
      {show && !suppressed && (
        <motion.div className="tour-prompt noprint" role="dialog" aria-label="Take the tour" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: reduced ? 0 : 0.18 } }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}>
          <div className="flex items-start gap-3">
            <span style={{ color: 'var(--mint)', marginTop: 2, flex: 'none' }}><Compass size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>New here?</div>
              <p className="m-0 mt-0.5 text-xs leading-snug" style={{ color: 'var(--muted)' }}>A two-minute tour explains every tab, or <Link to="/guide" onClick={dismiss}>read what each tab does</Link>.</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" className="btn btn-mint" style={{ padding: '.4rem .85rem', fontSize: 13 }} onClick={() => { setShow(false); start() }}>Start</button>
                <button type="button" className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: 13 }} onClick={dismiss}>Not now</button>
              </div>
            </div>
            <button type="button" className="tour-x" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
