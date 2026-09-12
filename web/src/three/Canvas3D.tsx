import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { PointerContext } from './pointer'
import type { StageCamera } from './Stage'
import './three.css'

type SceneModule<P> = { default: ComponentType<P> }
type Loaded<P> = ComponentType<{ active: boolean; camera: StageCamera; sceneProps: P }>

/** Resolves the three.js stage and a scene module in one Suspense pass, so the canvas mounts once with its scene ready. */
function loadStage<P>(scene: () => Promise<SceneModule<P>>): Loaded<P> {
  return lazy(async () => {
    const [{ default: Stage }, { default: Scene }] = await Promise.all([import('./Stage'), scene()])
    const Both: Loaded<P> = ({ active, camera, sceneProps }) => <Stage active={active} camera={camera}><Scene {...(sceneProps as P & object)} /></Stage>
    return { default: Both }
  })
}

/* ── capability gate: reduced motion, small screens, no WebGL2 ── */
const MIN_WIDTH = 640
let webglProbe: boolean | undefined
function hasWebGL() {
  if (webglProbe !== undefined) return webglProbe
  try {
    const c = document.createElement('canvas')
    webglProbe = !!c.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
  } catch { webglProbe = false }
  return webglProbe
}
const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : undefined)
function compute() {
  if (typeof window === 'undefined') return false
  if (mq('(prefers-reduced-motion: reduce)')?.matches) return false
  if (window.innerWidth < MIN_WIDTH) return false
  return hasWebGL()
}

/** True when a 3D stage should render: motion allowed, viewport ≥ 640px, WebGL2 available. Re-evaluates on resize and media changes. */
export function useCan3D() {
  const [can, setCan] = useState(compute)
  useEffect(() => {
    const on = () => setCan(compute())
    const rm = mq('(prefers-reduced-motion: reduce)')
    const w = mq(`(min-width: ${MIN_WIDTH}px)`)
    rm?.addEventListener('change', on); w?.addEventListener('change', on)
    return () => { rm?.removeEventListener('change', on); w?.removeEventListener('change', on) }
  }, [])
  return can
}

type Props<P> = {
  /** Dynamic import of the scene module (its default export is the scene component). Keeps three out of the page's chunk. */
  scene: () => Promise<SceneModule<P>>
  sceneProps?: P
  camera: StageCamera
  className?: string
  style?: CSSProperties
  /** Rendered instead of the stage when 3D is skipped. */
  fallback?: ReactNode
  /** Element whose pointer movement drives parallax (defaults to the stage itself). */
  pointerFrom?: RefObject<HTMLElement | null>
  label?: string
}

/**
 * Shared wrapper for every 3D scene: capability gate, lazy-loaded three chunk, Suspense, dpr cap,
 * pointer tracking for parallax, and a frame loop that pauses while the stage is scrolled out of view.
 */
export function Canvas3D<P extends object = Record<string, never>>({ scene, sceneProps, camera, className = '', style, fallback = null, pointerFrom, label }: Props<P>) {
  const can = useCan3D()
  const [Loaded] = useState(() => loadStage(scene))
  const wrap = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(true)
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const el = wrap.current
    if (!can || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '96px 0px', threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [can])

  useEffect(() => {
    const host = pointerFrom?.current ?? wrap.current
    if (!can || !host) return
    const p = pointer.current
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      if (!r.width || !r.height) return
      p.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2))
      p.y = Math.max(-1, Math.min(1, -((e.clientY - r.top) / r.height - 0.5) * 2))
    }
    const leave = () => { p.x = 0; p.y = 0 }
    host.addEventListener('pointermove', move, { passive: true })
    host.addEventListener('pointerleave', leave, { passive: true })
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave) }
  }, [can, pointerFrom])

  if (!can) return <>{fallback}</>
  return (
    <div ref={wrap} className={`t3 ${className}`} style={style} data-active={inView} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <PointerContext.Provider value={pointer}>
        <Suspense fallback={null}>
          <Loaded active={inView} camera={camera} sceneProps={sceneProps as P} />
        </Suspense>
      </PointerContext.Provider>
    </div>
  )
}
