import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react'

/** Wraps children in the load-in rise animation; `i` staggers siblings. Plays immediately on mount. */
export function Reveal({ i = 0, className = '', children, as: Tag = 'div' }: { i?: number; className?: string; children: ReactNode; as?: 'div' | 'section' | 'li' | 'span' }) {
  return <Tag className={`reveal ${className}`} data-i={i}>{children}</Tag>
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

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
