import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { motion, animate, useMotionValue, useTransform, useReducedMotion } from 'motion/react'
import { CountUp } from './motion'
import { Blockie } from './ui'
import { short, usd } from '../lib/format'
import type { Contribution, Record_, Round } from '../lib/types'
import type { VaultPayment } from '../hooks'
import { isProven } from '../hooks'
import './viz.css'

export type MemberStatus = 'on-time' | 'late' | 'paid-pending' | 'missed' | 'pending'

type Props = {
  members: readonly `0x${string}`[]
  currentRound: number
  active: boolean
  byScore: boolean
  recipient?: `0x${string}`
  rounds?: (Round | undefined)[]
  roundStatus?: number
  contributions?: (Contribution | undefined)[]
  scores?: (readonly [number, string] | undefined)[]
  records?: (Record_ | undefined)[]
  payments: VaultPayment[]
  pot?: bigint
  you?: `0x${string}`
  deadlineAttested?: boolean
  loading?: boolean
}

const VB = 500
const C = VB / 2
const R = 150
const INNER = 76

const pt = (deg: number, r: number) => ({ x: C + Math.cos((deg * Math.PI) / 180) * r, y: C + Math.sin((deg * Math.PI) / 180) * r })
function arcPath(centreDeg: number, spanDeg: number, r: number) {
  const a = pt(centreDeg - spanDeg / 2, r)
  const b = pt(centreDeg + spanDeg / 2, r)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${spanDeg > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

export function memberStatus(c: Contribution | undefined, paidOnSource: boolean, roundClosed: boolean): MemberStatus {
  if (isProven(c)) return c!.onTime ? 'on-time' : 'late'
  if (paidOnSource) return 'paid-pending'
  if (roundClosed) return 'missed'
  return 'pending'
}
export const STATUS_LABEL: Record<MemberStatus, string> = { 'on-time': 'proven · on time', late: 'proven · late', 'paid-pending': 'paid · proof pending', missed: 'missed', pending: 'pending' }
const STATUS_COLOR: Record<MemberStatus, string> = { 'on-time': 'var(--mint)', late: 'var(--amber)', 'paid-pending': 'var(--sky)', missed: 'var(--rose)', pending: 'var(--dim)' }

/**
 * The circle as a ring: members around it, the pot in the middle, the current recipient under a mint arc that sweeps
 * to the next member when the round changes. Every status shown here comes from the same ledger reads as the member table.
 */
export function RotationWheel({ members, currentRound, active, byScore, recipient, rounds, roundStatus, contributions, scores, records, payments, pot, you, deadlineAttested, loading }: Props) {
  const n = Math.max(members.length, 1)
  const reduced = useReducedMotion()
  const [hot, setHot] = useState<number | null>(null)
  const nr = n > 8 ? 15 : n > 5 ? 17 : 19
  const idSize = n > 8 ? 16 : 20
  const step = 360 / n
  const angleOf = (i: number) => -90 + step * i
  const recipientIdx = recipient ? members.findIndex((m) => m.toLowerCase() === recipient.toLowerCase()) : -1
  const roundClosed = roundStatus !== undefined && roundStatus !== 0

  // Past recipients: any round already closed or paid names its recipient on chain.
  const past = useMemo(() => {
    const s = new Set<string>()
    for (const r of rounds ?? []) if (r && r.status !== 0 && r.recipient) s.add(r.recipient.toLowerCase())
    return s
  }, [rounds])

  // Highlight arc: a motion value in degrees; on recipient change, sweep forward around the ring.
  const angle = useMotionValue(recipientIdx >= 0 ? angleOf(recipientIdx) : -90)
  useEffect(() => {
    if (recipientIdx < 0) return
    const target = angleOf(recipientIdx)
    const cur = angle.get()
    const delta = ((target - cur) % 360 + 360) % 360 // always forward
    const to = cur + (delta > 0.001 ? delta : 0)
    if (reduced) { angle.set(to); return }
    const ctrl = animate(angle, to, { type: 'spring', stiffness: 60, damping: 16, mass: 1 })
    return () => ctrl.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientIdx, n])
  const span = Math.min(step * 0.72, 64)
  const arcD = useTransform(angle, (a) => arcPath(a, span, R))
  const haloX = useTransform(angle, (a) => pt(a, R).x)
  const haloY = useTransform(angle, (a) => pt(a, R).y)

  const statuses = members.map((m, i) => memberStatus(contributions?.[i], payments.some((p) => p.member.toLowerCase() === m.toLowerCase()), roundClosed))
  const potNum = pot === undefined ? undefined : Number(pot) / 1e6
  const hotM = hot !== null ? members[hot] : undefined
  const hotP = hot !== null ? pt(angleOf(hot), R) : undefined

  return (
    <div className="viz-wheel" onMouseLeave={() => setHot(null)}>
      <svg viewBox={`0 0 ${VB} ${VB}`} role="img" aria-label={`Rotation wheel: ${members.length} members, round ${currentRound + 1} of ${members.length}`}>
        <defs>
          <radialGradient id="wheel-pot" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#1A2A22" />
            <stop offset="100%" stopColor="#0F1713" />
          </radialGradient>
        </defs>
        {/* ambient dashed guide, slowly turning */}
        <circle cx={C} cy={C} r={R + nr + 6} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 7" className="guide" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: reduced ? undefined : 'viz-spin 120s linear infinite' }} />
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
        {/* spokes: proven payments flow to the pot; drawn in on arrival */}
        {members.map((m, i) => {
          const st = statuses[i]
          if (st === 'pending') return null
          const a = angleOf(i)
          const from = pt(a, R - nr - 2)
          const to = pt(a, INNER + 12)
          const color = STATUS_COLOR[st]
          const dash = st === 'missed' ? '3 4' : st === 'paid-pending' ? '2 3' : undefined
          return (
            <g key={`s-${m}`}>
              <motion.line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={st === 'missed' ? 1.25 : 1.75} strokeDasharray={dash} strokeLinecap="round" opacity={st === 'missed' ? 0.7 : 0.9}
                initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 + i * 0.05 }} />
              <motion.circle cx={to.x} cy={to.y} r={4} fill="none" stroke={color} strokeWidth={2}
                initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.6, delay: 0.85 + i * 0.05 }} />
              {(st === 'on-time' || st === 'late') && <motion.circle cx={to.x} cy={to.y} r={2} fill={color} initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.2 + i * 0.05 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />}
            </g>
          )
        })}
        {/* recipient arc + halo */}
        {recipientIdx >= 0 && active && (
          <g className="halo">
            <motion.path d={arcD} fill="none" stroke="var(--mint)" strokeWidth={4} strokeLinecap="round" initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1, delay: 0.2 }} />
            <motion.circle cx={haloX} cy={haloY} r={nr + 7} fill="var(--mint-glow)" opacity={0.35} />
            <motion.circle cx={haloX} cy={haloY} r={nr + 4} fill="none" stroke="var(--mint)" strokeWidth={1.5} />
          </g>
        )}
        {/* members */}
        {members.map((m, i) => {
          const a = angleOf(i)
          const p = pt(a, R)
          const lp = pt(a, R + nr + 16)
          const cos = Math.cos((a * Math.PI) / 180)
          const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end'
          const isPast = past.has(m.toLowerCase())
          const isRec = i === recipientIdx && active
          const st = statuses[i]
          const hue = parseInt(m.slice(2, 10), 16) % 360
          const isYou = you && you.toLowerCase() === m.toLowerCase()
          return (
            <g key={m} className="member" data-hot={hot === i} data-past={isPast && !isRec} tabIndex={0} role="button" aria-label={`${short(m)} · ${STATUS_LABEL[st]}`}
              onMouseEnter={() => setHot(i)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} style={{ opacity: isPast && !isRec ? 0.55 : 1, transition: 'opacity .3s' }}>
              <circle className="node-ring" cx={p.x} cy={p.y} r={nr} fill={`hsl(${hue} 30% 16%)`} stroke={isYou ? 'var(--ink-2)' : 'var(--line-2)'} strokeWidth={isYou ? 1.75 : 1} />
              <g transform={`translate(${p.x - idSize / 2} ${p.y - idSize / 2})`}><Blockie address={m} size={idSize} /></g>
              {/* this-round status dot on the node's outer edge */}
              {st !== 'pending' && (
                <motion.circle cx={p.x + cos * (nr - 1)} cy={p.y + Math.sin((a * Math.PI) / 180) * (nr - 1)} r={4.5} fill={STATUS_COLOR[st]} stroke="var(--panel)" strokeWidth={1.5}
                  initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.5 + i * 0.05 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              )}
              {/* past recipients: a drawn-in check, tucked beside the node */}
              {isPast && (() => { const q = pt(a - 90, nr + 3); const cx = p.x + (q.x - C), cy = p.y + (q.y - C); return (
                <g>
                  <circle cx={cx} cy={cy} r={7} fill="var(--panel)" stroke="var(--mint)" strokeWidth={1} />
                  <motion.path d={`M ${cx - 3.5} ${cy} l 2.5 2.5 l 4.5 -5`} fill="none" stroke="var(--mint)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                    initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.6 }} />
                </g>) })()}
              <text className="label" x={lp.x} y={lp.y + 3.5} textAnchor={anchor}>{short(m)}{isYou ? ' (you)' : ''}</text>
            </g>
          )
        })}
        {/* the pot */}
        <circle cx={C} cy={C} r={INNER} fill="url(#wheel-pot)" stroke="var(--line-2)" strokeWidth="1" />
        <circle cx={C} cy={C} r={INNER - 5} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" />
        <text x={C} y={C - 28} textAnchor="middle" className="centre-eyebrow">{active ? `round ${currentRound + 1} of ${members.length}` : 'complete'}</text>
        <text x={C} y={C + 6} textAnchor="middle" className="centre-num" style={{ fontSize: potNum !== undefined && potNum >= 10000 ? 26 : 30, fill: 'var(--mint)' }}>
          {loading || potNum === undefined ? '—' : <CountUp value={potNum} format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />}
        </text>
        <text x={C} y={C + 24} textAnchor="middle" className="centre-sub">tUSD in the pot</text>
        <text x={C} y={C + 44} textAnchor="middle" className="centre-sub" style={{ fill: active ? 'var(--sky)' : 'var(--muted)' }}>
          {!active ? 'all pots paid' : recipient ? `→ ${short(recipient)}` : byScore ? 'decided by score' : '…'}
        </text>
      </svg>
      {hot !== null && hotM && hotP && (
        <div className="viz-tip" style={{ left: `${(hotP.x / VB) * 100}%`, top: `${((hotP.y - nr - 4) / VB) * 100}%` }} role="tooltip">
          <div className="row"><Link to={`/score/${hotM}`} className="mono" style={{ pointerEvents: 'auto' }}>{short(hotM)}</Link>{hot === recipientIdx && active && <span style={{ color: 'var(--sky)' }}>{byScore ? 'leading' : 'receives'}</span>}</div>
          <div className="row"><span>this round</span><span style={{ color: STATUS_COLOR[statuses[hot]] }}>{STATUS_LABEL[statuses[hot]]}{statuses[hot] === 'pending' && deadlineAttested ? ' · past deadline' : ''}</span></div>
          {contributions?.[hot] && isProven(contributions[hot]) && <div className="row"><span>Sepolia block</span><span className="mono">{String(contributions[hot]!.height)}</span></div>}
          <div className="row"><span>Kitty Score</span><span className="mono">{scores?.[hot] ? `${scores[hot]![0]} · tier ${scores[hot]![1]}` : '—'}</span></div>
          {records?.[hot] && <div className="row" style={{ color: 'var(--muted)' }}><span>record</span><span className="mono">{records[hot]!.onTime} on time · {records[hot]!.late} late · {records[hot]!.missed} missed</span></div>}
          {past.has(hotM.toLowerCase()) && <div className="row" style={{ color: 'var(--mint)' }}><span>already received a pot</span></div>}
        </div>
      )}
      {loading && <div className="viz-tip" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>reading round from Creditcoin…</div>}
    </div>
  )
}

/** Compact legend for the wheel. Kept separate so the page can place it under the ring. */
export function WheelLegend() {
  const dot = (c: string) => <i className="dot" style={{ background: c, width: 7, height: 7 }} />
  return (
    <div className="viz-legend">
      <span>{dot('var(--mint)')} proven on time</span>
      <span>{dot('var(--amber)')} proven late</span>
      <span>{dot('var(--sky)')} paid · proof pending</span>
      <span>{dot('var(--rose)')} missed</span>
      <span><i style={{ width: 10, height: 3, background: 'var(--mint)', borderRadius: 2, boxShadow: '0 0 6px var(--mint-glow)' }} /> receives this round</span>
      <span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.5l2.5 2.5 4.5-5" fill="none" stroke="var(--mint)" strokeWidth="1.8" /></svg> already received</span>
    </div>
  )
}

/** Round history as a strip: one node per round, connectors draw in as the circle progresses. */
export function RoundTimeline({ members, currentRound, active, byScore, recipient, rounds }: { members: readonly `0x${string}`[]; currentRound: number; active: boolean; byScore: boolean; recipient?: `0x${string}`; rounds?: (Round | undefined)[] }) {
  const reduced = useReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  // Right-edge fade only while there is more strip to the right (more than ~4 rounds on a phone).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const check = () => setOverflow(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : undefined
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', check); ro?.disconnect() }
  }, [members.length])
  return (
    <div ref={box} className="viz-timeline" role="list" aria-label="Round history" data-overflow={overflow}>
      <div className="strip" style={{ '--n': members.length } as CSSProperties}>
        {members.map((m, r) => {
          const rd = rounds?.[r]
          const state = rd?.status === 2 ? 'paid' : rd?.status === 1 ? 'closed' : r === currentRound && active ? 'current' : 'upcoming'
          const who = byScore ? (rd && rd.status !== 0 ? rd.recipient : r === currentRound && active ? recipient : undefined) : m
          const settled = state === 'paid' || state === 'closed'
          const prevSettled = r > 0 && (rounds?.[r - 1]?.status ?? 0) !== 0
          const tone = state === 'paid' ? 'mint' : state === 'closed' ? 'amber' : state === 'current' ? 'sky' : 'muted'
          const label = state === 'paid' ? 'Paid' : state === 'closed' ? 'Closed' : state === 'current' ? 'Open' : 'upcoming'
          return (
            <div key={r} className="node" data-state={state} role="listitem">
              {r > 0 && (
                <svg className="link" viewBox="0 0 132 2" preserveAspectRatio="none" aria-hidden>
                  <line x1={17} y1={1} x2={115} y2={1} stroke="var(--line-2)" strokeWidth={2} />
                  {(prevSettled || state === 'current' || settled) && (
                    <motion.line x1={17} y1={1} x2={115} y2={1} stroke={settled ? 'var(--mint)' : 'var(--sky)'} strokeWidth={2} strokeDasharray={settled ? undefined : '4 4'}
                      initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.15 + r * 0.18, ease: [0.22, 1, 0.36, 1] }} />
                  )}
                </svg>
              )}
              <motion.div className="disc" initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 + r * 0.18 }}>
                {state === 'paid' ? (
                  <svg width="14" height="14" viewBox="0 0 14 14"><motion.path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.4 + r * 0.18 }} /></svg>
                ) : state === 'closed' ? (
                  <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M7 4v3.5l2 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                ) : String(r + 1)}
              </motion.div>
              <div className={`who ${who ? '' : 'tbd'}`}>{who ? <Link to={`/score/${who}`} className="no-underline" style={{ color: 'inherit' }}>{short(who)}</Link> : 'by score at close'}</div>
              <div className="pot">{rd && rd.pot > 0n ? usd(rd.pot) : state === 'upcoming' ? '' : ' '}</div>
              <div className="st"><span className={`pill ${tone === 'muted' ? '' : tone}`}>{label}{byScore && state === 'current' && who ? ' · leading' : ''}</span></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
