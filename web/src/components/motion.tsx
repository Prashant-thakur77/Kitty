import { useEffect, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { motion, useInView, useReducedMotion, type Variants } from 'motion/react'

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const TAGS = { div: motion.div, section: motion.section, li: motion.li, span: motion.span, ul: motion.ul, ol: motion.ol } as const
type RevealTag = keyof typeof TAGS

/**
 * Rises in when it scrolls into view (IntersectionObserver, once, 10% inset). Elements already on screen at mount
 * animate immediately, as the old CSS version did; `i` staggers siblings by 60ms. Reduced motion: opacity only, instant.
 */
export function Reveal({ i = 0, className = '', children, as = 'div', style }: { i?: number; className?: string; children: ReactNode; as?: RevealTag; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px -10% 0px' })
  const reduced = useReducedMotion()
  const M = TAGS[as] as typeof motion.div
  return (
    <M
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={reduced ? { duration: 0 } : { duration: 0.7, ease: EASE_OUT, delay: i * 0.06 }}
    >
      {children}
    </M>
  )
}

const staggerParent: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } }
const staggerItem: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } } }
const staggerItemReduced: Variants = { hidden: { opacity: 1 }, show: { opacity: 1 } }

/** A list whose `Item` children cascade in as the list scrolls into view. Use with `Item` for each row/card. */
export function Stagger({ className = '', children, as = 'div', style }: { className?: string; children: ReactNode; as?: RevealTag; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px -10% 0px' })
  const M = TAGS[as] as typeof motion.div
  return (
    <M ref={ref as React.Ref<HTMLDivElement>} className={className} style={style} variants={staggerParent} initial="hidden" animate={inView ? 'show' : 'hidden'}>
      {children}
    </M>
  )
}

/** One entry of a `Stagger` list. Inherits the parent's variants, so it needs no props beyond markup. */
export function Item({ className = '', children, as = 'div', style, layout }: { className?: string; children: ReactNode; as?: RevealTag; style?: CSSProperties; layout?: boolean }) {
  const reduced = useReducedMotion()
  const M = TAGS[as] as typeof motion.div
  return <M className={className} style={style} variants={reduced ? staggerItemReduced : staggerItem} layout={layout}>{children}</M>
}

/** A card whose border and fill light up where the pointer is. */
export function Spotlight({ className = '', children, style }: { className?: string; children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return <div ref={ref} onMouseMove={onMove} className={`spot ${className}`} style={style}>{children}</div>
}

/** Counts from 0 to `value` once, easing out. Respects reduced motion. Formats with `format`. */
export function CountUp({ value, duration = 900, format = (n: number) => Math.round(n).toLocaleString() }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  const from = useRef(0)
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(value); return }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      setShown(a + (value - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(shown)}</>
}

/** Sets data-scrolled on the element once the page has moved, for the nav's blur-and-border. */
export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [threshold])
  return scrolled
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export { EASE_OUT }
