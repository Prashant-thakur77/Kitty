import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2, X } from 'lucide-react'

export type ToastTone = 'mint' | 'amber' | 'rose' | 'sky'
export type ToastInput = {
  title: ReactNode
  description?: ReactNode
  tone?: ToastTone
  /** ms before auto-dismiss; 0 keeps it until dismissed or updated. Default 5000. */
  duration?: number
  /** Shows a spinner instead of the tone icon: for work in progress. */
  busy?: boolean
  /** Reuse an id to update a toast in place (e.g. one toast that walks a lifecycle). */
  id?: string
}
type ToastItem = Required<Pick<ToastInput, 'id' | 'tone' | 'duration' | 'busy'>> & Pick<ToastInput, 'title' | 'description'>

type Api = {
  toast: (t: ToastInput) => string
  update: (id: string, t: Partial<ToastInput>) => void
  dismiss: (id?: string) => void
}
const ToastCtx = createContext<Api | null>(null)

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const clearTimer = (id: string) => { const t = timers.current.get(id); if (t) { clearTimeout(t); timers.current.delete(id) } }
  const dismiss = useCallback((id?: string) => {
    if (id === undefined) { timers.current.forEach(clearTimeout); timers.current.clear(); setItems([]); return }
    clearTimer(id); setItems((s) => s.filter((t) => t.id !== id))
  }, [])
  const arm = useCallback((id: string, duration: number) => {
    clearTimer(id)
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration))
  }, [dismiss])
  const toast = useCallback((t: ToastInput) => {
    const id = t.id ?? `t${++seq}`
    const item: ToastItem = { id, title: t.title, description: t.description, tone: t.tone ?? 'sky', duration: t.duration ?? 5000, busy: !!t.busy }
    setItems((s) => (s.some((x) => x.id === id) ? s.map((x) => (x.id === id ? item : x)) : [...s.slice(-4), item]))
    arm(id, item.duration)
    return id
  }, [arm])
  const update = useCallback((id: string, t: Partial<ToastInput>) => {
    setItems((s) => s.map((x) => (x.id === id ? { ...x, ...t, id, busy: t.busy ?? false } : x)))
    if (t.duration !== undefined) arm(id, t.duration)
    else if (t.busy === false || t.busy === undefined) arm(id, 5000)
  }, [arm])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const api = useMemo(() => ({ toast, update, dismiss }), [toast, update, dismiss])
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastViewport items={items} onClose={dismiss} />
    </ToastCtx.Provider>
  )
}

export function useToast(): Api {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const ICON: Record<ToastTone, ReactNode> = { mint: <CheckCircle2 size={16} />, amber: <AlertTriangle size={16} />, rose: <XCircle size={16} />, sky: <Info size={16} /> }

function ToastViewport({ items, onClose }: { items: ToastItem[]; onClose: (id: string) => void }) {
  const reduced = useReducedMotion()
  return (
    <div className="toast-region noprint" role="region" aria-label="Notifications">
      {/* the live region announces every toast; the visual list animates independently */}
      <div className="sr-only" aria-live="polite" aria-atomic="false">
        {items.map((t) => <div key={t.id}>{typeof t.title === 'string' ? t.title : ''} {typeof t.description === 'string' ? t.description : ''}</div>)}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 24, scale: 0.96, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
            className={`toast ${t.tone}`}
            role={t.tone === 'rose' ? 'alert' : 'status'}
          >
            <span className="toast-icon" aria-hidden>{t.busy ? <Loader2 size={16} className="spin" /> : ICON[t.tone]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight" style={{ color: 'var(--ink)' }}>{t.title}</span>
              {t.description && <span className="mt-0.5 block text-xs leading-snug" style={{ color: 'var(--muted)' }}>{t.description}</span>}
            </span>
            <button type="button" className="toast-x" aria-label="Dismiss notification" onClick={() => onClose(t.id)}><X size={14} /></button>
            {t.duration > 0 && !reduced && (
              <motion.span key={`${t.id}-${t.duration}-${String(t.title)}`} className="toast-bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: t.duration / 1000, ease: 'linear' }} aria-hidden />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
