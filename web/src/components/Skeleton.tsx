import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** A shimmering placeholder block in the panel palette. Sized by props or by the parent; hidden from AT. */
export function Skeleton({ w, h = 14, r = 6, className = '', style }: { w?: number | string; h?: number | string; r?: number; className?: string; style?: CSSProperties }) {
  return <span className={`skeleton ${className}`} aria-hidden style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} />
}

/** `n` lines of skeleton text, the last one shorter, like a paragraph. */
export function SkeletonText({ n = 3, className = '' }: { n?: number; className?: string }) {
  return (
    <span className={`grid gap-2 ${className}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} h={12} w={i === n - 1 ? '62%' : '100%'} />)}
    </span>
  )
}

/** A panel-shaped card skeleton: eyebrow, title, then a row of three stats. Mirrors the circle card layout. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`panel p-5 ${className}`} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-2"><Skeleton w={28} h={10} /><Skeleton w={160} h={22} /></div>
        <Skeleton w={64} h={22} r={999} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => <span key={i} className="grid gap-2"><Skeleton w={54} h={10} /><Skeleton w="70%" h={16} /></span>)}
      </div>
    </div>
  )
}

/** A stat tile skeleton matching `Stat` in ui.tsx. */
export function SkeletonStat() {
  return (
    <div className="panel-2 px-4 py-3" aria-hidden>
      <Skeleton w={64} h={10} />
      <Skeleton w="55%" h={26} className="mt-2" />
      <Skeleton w={90} h={10} className="mt-2" />
    </div>
  )
}

/** Rows shaped like the steward's decision entries. */
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="panel-2 px-3 py-2.5">
          <div className="flex items-center gap-2"><Skeleton w={52} h={20} r={999} /><Skeleton w={110} h={10} /><Skeleton w={`${48 + ((i * 17) % 30)}%`} h={12} /></div>
          <div className="mt-2 flex gap-1.5"><Skeleton w={84} h={18} r={5} /><Skeleton w={120} h={18} r={5} /><Skeleton w={66} h={18} r={5} /></div>
        </div>
      ))}
    </div>
  )
}

/** A friendly empty state: an icon, a one-line reason, and one action. Stays within the panel it replaces. */
export function Empty({ icon, title, body, action, className = '' }: { icon?: ReactNode; title: string; body?: ReactNode; action?: { label: ReactNode; to?: string; href?: string; onClick?: () => void; primary?: boolean }; className?: string }) {
  const cls = `btn ${action?.primary ? 'btn-mint' : ''} mt-1`
  return (
    <div className={`empty ${className}`} role="status">
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <div className="display text-2xl" style={{ color: 'var(--ink)' }}>{title}</div>
      {body && <p className="m-0 max-w-[48ch] text-sm" style={{ color: 'var(--muted)' }}>{body}</p>}
      {action && (action.to ? <Link to={action.to} className={cls}>{action.label}</Link>
        : action.href ? <a href={action.href} target="_blank" rel="noreferrer" className={cls}>{action.label}</a>
        : <button type="button" className={cls} onClick={action.onClick}>{action.label}</button>)}
    </div>
  )
}
