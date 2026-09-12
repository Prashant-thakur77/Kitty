import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, animate, useMotionValue, useTransform, useReducedMotion } from 'motion/react'
import { CountUp } from './motion'
import type { Record_ } from '../lib/types'
import type { FeedItem } from '../hooks'
import './viz.css'

/** creditScore(member) = 500 + 15·onTime − 20·late − 120·missed, clamped to 300–850; tiers A ≥ 700, B ≥ 600, C ≥ 500, D below (KittyLedger). */
export const SCORE_MIN = 300
export const SCORE_MAX = 850
export const SCORE_BASE = 500
export const TIERS: { grade: string; min: number }[] = [{ grade: 'A', min: 700 }, { grade: 'B', min: 600 }, { grade: 'C', min: 500 }, { grade: 'D', min: SCORE_MIN }]
export const tierOf = (v: number) => TIERS.find((t) => v >= t.min)?.grade ?? 'D'
export const tierColor = (grade?: string) => (grade === 'A' ? 'var(--mint)' : grade === 'B' ? 'var(--sky)' : grade === 'C' ? 'var(--amber)' : grade === 'D' ? 'var(--rose)' : 'var(--muted)')
export const POINTS = { onTime: 15, late: -20, missed: -120 } as const

const VB = 300
const C = VB / 2
const R = 118
const START = 140 // SVG degrees (y down); the gauge sweeps clockwise over the top to 400° = 40°
const SWEEP = 260
const clamp = (v: number) => Math.min(SCORE_MAX, Math.max(SCORE_MIN, v))
const frac = (v: number) => (clamp(v) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)
const pt = (deg: number, r: number) => ({ x: C + Math.cos((deg * Math.PI) / 180) * r, y: C + Math.sin((deg * Math.PI) / 180) * r })
function arc(fromDeg: number, toDeg: number, r: number) {
  if (toDeg - fromDeg < 0.01) return ''
  const a = pt(fromDeg, r), b = pt(toDeg, r)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** Arc gauge 300–850 with tier boundaries; springs to the score on load and whenever the ledger value changes. */
export function ScoreRing({ value, tier, loading }: { value?: number; tier?: string; loading?: boolean }) {
  const reduced = useReducedMotion()
  const grade = tier ?? (value !== undefined ? tierOf(value) : undefined)
  const color = tierColor(grade)
  const t = useMotionValue(0)
  useEffect(() => {
    const target = value === undefined ? 0 : frac(value)
    if (reduced) { t.set(target); return }
    const ctrl = animate(t, target, { type: 'spring', stiffness: 42, damping: 14, mass: 1.1, delay: 0.15 })
    return () => ctrl.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const d = useTransform(t, (f) => arc(START, START + SWEEP * f, R))
  const tipX = useTransform(t, (f) => pt(START + SWEEP * f, R).x)
  const tipY = useTransform(t, (f) => pt(START + SWEEP * f, R).y)
  const marks = [500, 600, 700]
  return (
    <div className="viz-ring" aria-label={value !== undefined ? `Kitty Score ${value}, tier ${grade}` : 'Kitty Score not read yet'} role="img">
      <svg viewBox={`0 8 ${VB} 262`}>
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        <path d={arc(START, START + SWEEP, R)} fill="none" stroke="#1B2823" strokeWidth={14} strokeLinecap="round" />
        {/* tier bands, quiet, under the value arc */}
        {TIERS.slice().reverse().map((tr, i, all) => {
          const next = all[i + 1]?.min ?? SCORE_MAX
          const a0 = START + SWEEP * frac(tr.min) + (i === 0 ? 0 : 0.6), a1 = START + SWEEP * frac(next) - (i === all.length - 1 ? 0 : 0.6)
          return <path key={tr.grade} d={arc(a0, a1, R)} fill="none" stroke={tierColor(tr.grade)} strokeWidth={14} strokeOpacity={0.12} strokeLinecap="butt" />
        })}
        {value !== undefined && <motion.path d={d} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" opacity={0.35} filter="url(#ring-glow)" />}
        <motion.path d={d} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" style={{ transition: 'stroke .5s' }} />
        {value !== undefined && <motion.circle cx={tipX} cy={tipY} r={4} fill="var(--bg)" />}
        {/* boundary marks */}
        {marks.map((m) => {
          const a = START + SWEEP * frac(m)
          const o = pt(a, R + 12), i = pt(a, R + 8), l = pt(a, R + 24)
          return (
            <g key={m}>
              <line x1={i.x} y1={i.y} x2={o.x} y2={o.y} stroke="var(--line-2)" strokeWidth={1.5} />
              <text className="tick-label" x={l.x} y={l.y + 3.5} textAnchor="middle">{m}</text>
            </g>
          )
        })}
        {/* range ends */}
        {[SCORE_MIN, SCORE_MAX].map((m) => { const l = pt(START + SWEEP * frac(m), R + 30); return <text key={m} className="tick-label" x={l.x} y={l.y + 3} textAnchor="middle">{m}</text> })}
        {/* tier letters in the middle of each band */}
        {TIERS.slice().reverse().map((tr, i, all) => {
          const next = all[i + 1]?.min ?? SCORE_MAX
          const mid = pt(START + SWEEP * ((frac(tr.min) + frac(next)) / 2), R - 18)
          return <text key={tr.grade} className="tier-label" x={mid.x} y={mid.y + 3.5} textAnchor="middle" style={{ fill: grade === tr.grade ? tierColor(tr.grade) : undefined, opacity: grade === tr.grade ? 1 : 0.55 }}>{tr.grade}</text>
        })}
      </svg>
      <div className="centre">
        <div style={{ textAlign: 'center', paddingTop: 14 }}>
          <div className="big" style={{ color }}>{value === undefined ? '—' : <CountUp value={value} duration={1400} />}</div>
          <div className="grade" style={{ color }}>{grade ? `tier ${grade}` : loading ? 'reading…' : 'no score'}</div>
          <div className="range">300 – 850</div>
        </div>
      </div>
    </div>
  )
}

/** The four counters the ledger keeps per member, as bars that grow in. Points column is the score formula applied to each counter. */
export function ScoreBreakdown({ record }: { record?: Record_ }) {
  const reduced = useReducedMotion()
  const rows = [
    { key: 'onTime', label: 'On time', n: record?.onTime, color: 'var(--mint)', pts: POINTS.onTime, icon: <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.5l2.5 2.5 4.5-5" fill="none" stroke="var(--mint)" strokeWidth="1.8" /></svg> },
    { key: 'late', label: 'Late', n: record?.late, color: 'var(--amber)', pts: POINTS.late, icon: <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.8" fill="none" stroke="var(--amber)" strokeWidth="1.5" /><path d="M5 3v2.3l1.5 1" fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" /></svg> },
    { key: 'missed', label: 'Missed', n: record?.missed, color: 'var(--rose)', pts: POINTS.missed, icon: <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="var(--rose)" strokeWidth="1.8" strokeLinecap="round" /></svg> },
    { key: 'received', label: 'Pots received', n: record?.received, color: 'var(--sky)', pts: 0, icon: <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.8" fill="none" stroke="var(--sky)" strokeWidth="1.5" /></svg> },
  ]
  const max = Math.max(1, ...rows.map((r) => r.n ?? 0))
  return (
    <div className="viz-bars">
      {rows.map((r, i) => (
        <div key={r.key} className="bar">
          <span className="lbl">{r.icon}{r.label}</span>
          <div className="track" aria-hidden>
            <motion.div className="fill" style={{ background: r.color, width: `${((r.n ?? 0) / max) * 100}%` }} initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.3 + i * 0.1 }} />
          </div>
          <span className="val">{r.n === undefined ? '—' : <CountUp value={r.n} />}{r.n !== undefined && r.n > 0 && r.pts !== 0 && <small> {r.pts > 0 ? '+' : '−'}{Math.abs(r.pts * r.n)}</small>}</span>
        </div>
      ))}
    </div>
  )
}

/** Replays the member's proven events (oldest first) through the ledger's formula so the line ends at today's score. */
export function scoreSeries(events: FeedItem[]) {
  const evs = events.filter((e) => e.kind === 'ContributionRecorded' || e.kind === 'ContributionMissed').slice().sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))
  let onTime = 0, late = 0, missed = 0
  const pts: { score: number; kind: 'on-time' | 'late' | 'missed'; block: bigint; circleId: string; round: number; tx: string }[] = []
  for (const e of evs) {
    let kind: 'on-time' | 'late' | 'missed'
    if (e.kind === 'ContributionMissed') { missed++; kind = 'missed' } else if (e.args.onTime) { onTime++; kind = 'on-time' } else { late++; kind = 'late' }
    pts.push({ score: clamp(SCORE_BASE + POINTS.onTime * onTime + POINTS.late * late + POINTS.missed * missed), kind, block: e.block, circleId: String(e.args.circleId ?? ''), round: Number(e.args.round ?? 0), tx: e.tx })
  }
  return pts
}

const KIND_COLOR = { 'on-time': 'var(--mint)', late: 'var(--amber)', missed: 'var(--rose)' } as const
const KIND_LABEL = { 'on-time': 'proven on time', late: 'proven late', missed: 'missed' } as const

/** Score over time from the ledger's own events; a flat 500 start, then one step per proven payment or attested miss. */
export function ScoreSparkline({ events, current }: { events: FeedItem[]; current?: number }) {
  const reduced = useReducedMotion()
  const series = useMemo(() => scoreSeries(events), [events])
  const [hot, setHot] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(520)
  useEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const H = 120, PL = 34, PR = 14, PT = 12, PB = 22
  const all = [{ score: SCORE_BASE }, ...series]
  const lo = Math.min(...all.map((p) => p.score)), hi = Math.max(...all.map((p) => p.score))
  const yMin = Math.max(SCORE_MIN, Math.floor((lo - 30) / 50) * 50), yMax = Math.min(SCORE_MAX, Math.ceil((hi + 30) / 50) * 50)
  const x = (i: number) => PL + ((W - PL - PR) * i) / Math.max(1, all.length - 1)
  const y = (s: number) => PT + (H - PT - PB) * (1 - (s - yMin) / Math.max(1, yMax - yMin))
  const path = all.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ')
  const area = `${path} L ${x(all.length - 1).toFixed(1)} ${(H - PB).toFixed(1)} L ${x(0).toFixed(1)} ${(H - PB).toFixed(1)} Z`
  const matches = current !== undefined && series.length > 0 && series[series.length - 1].score === current
  const last = series[series.length - 1]
  const lineColor = tierColor(last ? tierOf(last.score) : 'C')
  if (series.length === 0) return null
  return (
    <div>
      <div className="viz-spark" ref={box} onMouseLeave={() => setHot(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score over ${series.length} events, now ${last.score}`}>
          <defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={lineColor} stopOpacity="0.22" /><stop offset="100%" stopColor={lineColor} stopOpacity="0" /></linearGradient></defs>
          {[500, 600, 700].filter((g) => g >= yMin && g <= yMax).map((g) => (
            <g key={g}><line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="2 4" /><text className="axis" x={PL - 6} y={y(g) + 3} textAnchor="end">{g}</text></g>
          ))}
          <motion.path d={area} fill="url(#spark-fill)" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.6 }} />
          <motion.path d={path} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
          {series.map((p, i) => (
            <g key={i}>
              <motion.circle cx={x(i + 1)} cy={y(p.score)} r={hot === i ? 5 : 3.5} fill={KIND_COLOR[p.kind]} stroke="var(--panel)" strokeWidth={1.5} initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + (i / series.length) * 1.1, type: 'spring', stiffness: 300, damping: 18 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              <rect x={x(i + 1) - (W - PL - PR) / all.length / 2} y={0} width={(W - PL - PR) / all.length} height={H} fill="transparent" onMouseEnter={() => setHot(i)} />
            </g>
          ))}
          <text className="axis" x={PL} y={H - 6}>start 500</text>
          <text className="axis" x={W - PR} y={H - 6} textAnchor="end">{series.length} event{series.length === 1 ? '' : 's'}</text>
        </svg>
        {hot !== null && (
          <div className="viz-tip" style={{ left: `${(x(hot + 1) / W) * 100}%`, top: `${(y(series[hot].score) / H) * 100}%` }}>
            <div className="row"><span className="mono">{series[hot].score}</span><span style={{ color: KIND_COLOR[series[hot].kind] }}>{KIND_LABEL[series[hot].kind]}</span></div>
            <div className="row" style={{ color: 'var(--muted)' }}><span>circle #{series[hot].circleId} · r{series[hot].round}</span><span className="mono">cc block {String(series[hot].block)}</span></div>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
        Replayed from {series.length} ledger event{series.length === 1 ? '' : 's'} through the on-chain formula. {matches ? 'Ends at the live creditScore.' : current !== undefined ? `Ends at ${last.score}; live creditScore is ${current} (event window may be partial).` : ''}
      </p>
    </div>
  )
}
