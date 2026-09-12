import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import type { FeedItem } from '../hooks'
import type { Circle } from '../lib/types'
import { blockieCells, blockieTexture } from './blockie'
import { usePointer } from './pointer'

/**
 * The savings circle as one object: member coins (each stamped with the member's Blockie) orbit a lacquered pot on a thin
 * orbit line, ringed by 48 block ticks. Nothing here is invented — every pulse is a ledger event (newest-first `items`):
 *   ContributionRecorded → coin → pot (a whole batch leaves together, so "one call" is what the eye sees)
 *   RoundClosed / PayoutConfirmed → pot → recipient; a paid recipient keeps a thin mint ring
 *   attested height advancing → one sweep around the 48 ticks (the only place an attestation is visible)
 * Between events the scene only breathes: a slow orbit, a soft pot glow. All per-frame work is refs; no allocations.
 */

const R = 1.95                   // orbit radius
const COIN_Y = 0.11              // coins hover a little above the ground so the contact shadow reads
const POT_Y = 0.2
const MINT = '#4FD1A3'
const BG = '#0B100E'
const TICK_BASE = '#3A4E45'
const TWO_PI = Math.PI * 2
const HERO_CAMERA: [number, number, number] = [0, 4.9, 7.4] // keep in sync with Landing.tsx
const TICKS = 48
const SWEEP_DUR = 1.2            // s, tick-to-tick sweep of one attestation
const SWEEP_FADE = 0.9           // s, each tick's afterglow

// Six placeholder members whose leading bytes land on spaced hues, the same derivation Blockie uses (first 8 hex chars mod 360).
const PLACEHOLDER = ['0x000000a0', '0x000000cd', '0x00000028', '0x0000015e', '0x00000109', '0x0000005f'].map((p) => (p + '0'.repeat(32)) as `0x${string}`)

type Pulse = { active: boolean; t: number; dur: number; out: boolean; token: number; batch: boolean }
type Cue = { at: number; kind: 'in' | 'out' | 'pot'; token: number; batch?: boolean }

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const POOL = 12

export type HeroProps = { members?: readonly `0x${string}`[]; items: FeedItem[]; attested?: bigint; circleId?: bigint; circle?: Circle }

export default function HeroScene({ members, items, attested, circleId, circle }: HeroProps) {
  const addrs = members && members.length > 0 ? members : PLACEHOLDER
  const n = addrs.length
  const key = addrs.join(',')

  // Per-member materials: a hue-tinted metal edge and a face stamped with the member's identicon. Rebuilt only when the roster changes.
  const coinMats = useMemo(() => addrs.map((a) => {
    const { hue } = blockieCells(a)
    const face = blockieTexture(a)
    const edge = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.38, 0.46), metalness: 0.75, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 })
    const top = new THREE.MeshPhysicalMaterial({
      map: face, emissiveMap: face, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.32,
      metalness: 0.6, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.18,
    })
    return { face, mats: [edge, top, top] as THREE.Material[] }
  }), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const c of coinMats) { c.face.dispose(); c.mats[0].dispose(); c.mats[1].dispose() } }, [coinMats])

  // Recipients already paid out (PayoutConfirmed for this circle) keep a persistent ring.
  const paid = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) {
      if (it.kind !== 'PayoutConfirmed') continue
      if (circleId !== undefined && it.args.circleId !== undefined && (it.args.circleId as bigint) !== circleId) continue
      set.add(String(it.args.recipient).toLowerCase())
    }
    return addrs.map((a) => set.has(a.toLowerCase()))
  }, [items, circleId, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const orbit = useRef<THREE.Group>(null)
  const coins = useRef<(THREE.Group | null)[]>([])
  const paidRings = useRef<(THREE.Mesh | null)[]>([])
  const pot = useRef<THREE.Group>(null)
  const potMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const potLight = useRef<THREE.PointLight>(null)
  const ring = useRef<THREE.Mesh>(null)
  const outer = useRef<THREE.Mesh>(null)
  const pulses = useRef<(THREE.Group | null)[]>([])
  const ticks = useRef<THREE.InstancedMesh>(null)
  const pointer = usePointer()
  const camera = useThree((s) => s.camera)

  // simulation state, mutated in useFrame only
  const sim = useRef({
    t: 0, angle: 0, potPulse: 0, primed: false, sweep: -1, lastAttested: undefined as bigint | undefined,
    seen: new Set<string>(),
    queue: [] as Cue[],
    pool: Array.from({ length: POOL }, (): Pulse => ({ active: false, t: 0, dur: 1.7, out: false, token: 0, batch: false })),
    v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), camBase: new THREE.Vector3(...HERO_CAMERA), camTarget: new THREE.Vector3(),
    tickObj: new THREE.Object3D(), tickBase: new THREE.Color(TICK_BASE), tickHot: new THREE.Color('#7BE3BE'), col: new THREE.Color(),
  })

  const indexOf = (addr: unknown) => {
    if (typeof addr !== 'string') return 0
    const i = addrs.findIndex((a) => a.toLowerCase() === addr.toLowerCase())
    return i >= 0 ? i : parseInt(addr.slice(2, 6), 16) % n
  }

  // Ledger events → cues. First load replays the most recent handful so the mechanic is visible; after that only new ones fire.
  // Events are grouped by transaction: the contributions of one batch proof leave their coins at the same instant.
  useEffect(() => {
    const s = sim.current
    if (circleId === undefined && items.length) return // the circle id lands a beat after the events; wait so the replay is this circle's
    const fresh = items.filter((i) => {
      const k = `${i.kind}:${i.tx}:${String(i.args.member ?? i.args.recipient ?? '')}:${String(i.args.round ?? '')}`
      if (s.seen.has(k)) return false
      s.seen.add(k); return true
    })
    const play = (s.primed ? fresh : fresh.slice(0, 6)).slice().reverse()
    s.primed = true
    let delay = 0.6
    // events of other circles are not this circle's story: drop them (BatchVerified carries no circleId, so it rides with its tx)
    const ours = (g: FeedItem) => circleId === undefined || g.args.circleId === undefined || (g.args.circleId as bigint) === circleId
    for (let i = 0; i < play.length;) {
      const tx = play[i].tx
      const all: FeedItem[] = []
      while (i < play.length && play[i].tx === tx) all.push(play[i++])
      const grp = all.filter(ours)
      const contribs = grp.filter((g) => g.kind === 'ContributionRecorded')
      if (contribs.length) {
        for (const c of contribs) s.queue.push({ at: s.t + delay, kind: 'in', token: indexOf(c.args.member), batch: contribs.length > 1 })
        delay += 2.1
      } else if (grp.some((g) => g.kind === 'BatchVerified') && !all.some((g) => g.kind === 'ContributionRecorded')) { s.queue.push({ at: s.t + delay, kind: 'pot', token: 0 }); delay += 0.5 }
      for (const g of grp) {
        if (g.kind === 'RoundClosed') { s.queue.push({ at: s.t + delay, kind: 'pot', token: 0 }); s.queue.push({ at: s.t + delay + 0.5, kind: 'out', token: indexOf(g.args.recipient) }); delay += 1.4 }
        else if (g.kind === 'PayoutConfirmed') { s.queue.push({ at: s.t + delay, kind: 'out', token: indexOf(g.args.recipient) }); delay += 1.0 }
      }
    }
  }, [items, circleId]) // eslint-disable-line react-hooks/exhaustive-deps

  // An attestation advancing the frontier is a real event: sweep the 48 ticks once. Never on first load (nothing advanced yet).
  useEffect(() => {
    const s = sim.current
    if (attested !== undefined && s.lastAttested !== undefined && attested > s.lastAttested) s.sweep = 0
    s.lastAttested = attested
  }, [attested])

  // paid rings follow the ledger, not the frame loop
  useEffect(() => { paidRings.current.forEach((m, i) => { if (m) m.visible = !!paid[i] }) }, [paid])

  // static block ticks around the outer rim: 48 marks, the same scale the circle page draws
  useEffect(() => {
    const m = ticks.current; if (!m) return
    const { tickObj, tickBase } = sim.current
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * TWO_PI
      tickObj.position.set(Math.cos(a) * (R + 0.42), -0.02, Math.sin(a) * (R + 0.42))
      tickObj.rotation.set(0, -a, 0)
      tickObj.scale.setScalar(i % 12 === 0 ? 1.6 : 1)
      tickObj.updateMatrix()
      m.setMatrixAt(i, tickObj.matrix)
      m.setColorAt(i, tickBase)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  const coinGeo = useMemo(() => new THREE.CylinderGeometry(0.33, 0.33, 0.085, 48, 1), [])
  const paidGeo = useMemo(() => new THREE.TorusGeometry(0.43, 0.011, 8, 64), [])
  const pulseGeo = useMemo(() => new THREE.SphereGeometry(0.07, 12, 8), [])
  // a 64px radial gradient, drawn once, for the soft halo under the pot
  const halo = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(79,209,163,0.5)'); grad.addColorStop(0.45, 'rgba(79,209,163,0.14)'); grad.addColorStop(1, 'rgba(79,209,163,0)')
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const haloGeo = useMemo(() => new THREE.SphereGeometry(0.16, 12, 8), [])
  // radial alpha for the floor disc: solid under the circle, gone before the canvas edge, so the stage has no visible bounds
  const floorAlpha = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.36, '#fff'); grad.addColorStop(0.72, '#000'); grad.addColorStop(1, '#000')
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])

  const spawn = (kind: Cue['kind'], token: number, batch = false) => {
    const s = sim.current
    if (kind === 'pot') { s.potPulse = Math.max(s.potPulse, 1); return }
    const p = s.pool.find((x) => !x.active); if (!p) return
    p.active = true; p.t = 0; p.out = kind === 'out'; p.token = token % n; p.dur = p.out ? 1.9 : 1.6; p.batch = batch
    if (kind === 'out') s.potPulse = Math.max(s.potPulse, 0.7)
  }

  useFrame((_, delta) => {
    const s = sim.current
    const dt = Math.min(delta, 0.05)
    s.t += dt
    s.angle += dt * 0.06

    // ambient orbit: coins drift round, hover and tilt a touch
    if (orbit.current) orbit.current.rotation.y = -s.angle
    for (let i = 0; i < n; i++) {
      const c = coins.current[i]; if (!c) continue
      c.position.y = COIN_Y + Math.sin(s.t * 0.7 + i * 1.3) * 0.035
      c.rotation.z = -0.16 + Math.sin(s.t * 0.45 + i) * 0.04
    }

    // pot: light breathing, plus a flash per event
    s.potPulse = Math.max(0, s.potPulse - dt / 1.4)
    const breath = 0.5 + Math.sin(s.t * 0.9) * 0.5 // 0..1
    if (potMat.current) potMat.current.emissiveIntensity = 0.16 + breath * 0.08 + s.potPulse * 0.6
    if (potLight.current) potLight.current.intensity = 7 + breath * 2 + s.potPulse * 26
    if (pot.current) { pot.current.rotation.y += dt * 0.1; pot.current.scale.setScalar(1 + Math.sin(Math.min(1, s.potPulse) * Math.PI) * 0.05) }
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.2 + s.potPulse * 0.25

    // cues → pulses (no idle invention: an empty queue is a still pot)
    while (s.queue.length && s.queue[0].at <= s.t) { const c = s.queue.shift()!; spawn(c.kind, c.token, c.batch) }

    // pulses travel between a coin and the pot along a lifted arc
    for (let i = 0; i < POOL; i++) {
      const p = s.pool[i]; const g = pulses.current[i]; if (!g) continue
      if (!p.active) { g.visible = false; continue }
      p.t += dt / p.dur
      if (p.t >= 1) { p.active = false; g.visible = false; if (!p.out) s.potPulse = Math.max(s.potPulse, p.batch ? 1 : 0.55); continue }
      const e = easeInOut(p.t)
      const th = (p.token / n) * TWO_PI + s.angle
      s.a.set(Math.cos(th) * R, COIN_Y + 0.05, Math.sin(th) * R)   // coin
      s.b.set(0, POT_Y + 0.1, 0)                                    // pot
      if (p.out) s.v.lerpVectors(s.b, s.a, e); else s.v.lerpVectors(s.a, s.b, e)
      s.v.y += Math.sin(p.t * Math.PI) * 0.42
      g.visible = true
      g.position.copy(s.v)
      g.scale.setScalar(0.55 + Math.sin(p.t * Math.PI) * 0.65)
    }

    // attestation sweep: light the 48 ticks in order, each fading back to graphite
    const m = ticks.current
    if (m && s.sweep >= 0) {
      s.sweep += dt
      const done = s.sweep > SWEEP_DUR + SWEEP_FADE
      for (let i = 0; i < TICKS; i++) {
        const age = s.sweep - (i / TICKS) * SWEEP_DUR
        const k = done || age < 0 ? 0 : Math.max(0, 1 - age / SWEEP_FADE)
        m.setColorAt(i, s.col.lerpColors(s.tickBase, s.tickHot, k))
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      if (outer.current) (outer.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + (done ? 0 : Math.sin(Math.min(1, s.sweep / SWEEP_DUR) * Math.PI) * 0.4)
      if (done) s.sweep = -1
    }

    // camera: slow drift + pointer parallax, eased
    const pt = pointer.current
    s.camTarget.set(s.camBase.x + Math.sin(s.t * 0.11) * 0.26 + pt.x * 0.5, s.camBase.y + Math.sin(s.t * 0.07) * 0.12 + pt.y * 0.28, s.camBase.z)
    camera.position.lerp(s.camTarget, 1 - Math.exp(-dt * 2.2))
    camera.lookAt(0, 0.02, 0)
  })

  const label = circle ? `${circle.name} · round ${circle.currentRound + 1}` : undefined

  return (
    <>
      <fog attach="fog" args={[BG, 7, 15]} />
      <hemisphereLight args={['#d7e4dd', BG, 0.3]} />
      <directionalLight position={[4, 6, 3]} intensity={1.5} color="#eef5f1" />
      <directionalLight position={[-5, 2.5, -4]} intensity={0.6} color="#7DB6E8" />
      <pointLight ref={potLight} position={[0, POT_Y + 0.3, 0]} color={MINT} intensity={8} distance={5.5} decay={2} />

      {/* grounding: soft contact shadow of pot and coins; the coins move, so it re-renders (256², a fraction of a ms) */}
      <ContactShadows frames={Infinity} resolution={256} opacity={0.55} blur={2.2} scale={7} far={2.2} near={0.08} position={[0, -0.07, 0]} color="#000000" />

      {/* floor: graphite disc the shadow lands on, faintly lit by the room environment; the CSS mask fades its edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[11, 11]} />
        <meshPhysicalMaterial color="#151E19" roughness={0.62} metalness={0.2} clearcoat={0.2} clearcoatRoughness={0.6} alphaMap={floorAlpha} transparent depthWrite={false} />
      </mesh>

      {/* ground halo under the pot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial map={halo} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* orbit line + block ticks */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <ringGeometry args={[R - 0.008, R + 0.008, 160]} />
        <meshBasicMaterial color={MINT} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <ringGeometry args={[R + 0.36, R + 0.365, 160]} />
        <meshBasicMaterial color={TICK_BASE} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={ticks} args={[undefined, undefined, TICKS]}>
        <boxGeometry args={[0.02, 0.012, 0.11]} />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>

      {/* the pot: lacquered graphite-mint torus over a dark dish */}
      <group ref={pot} position={[0, POT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.64, 0.13, 24, 72]} />
          <meshPhysicalMaterial ref={potMat} color="#1B4A3D" emissive={MINT} emissiveIntensity={0.18} clearcoat={1} clearcoatRoughness={0.15} roughness={0.28} metalness={0.55} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
          <circleGeometry args={[0.56, 48]} />
          <meshPhysicalMaterial color="#0F1713" emissive={MINT} emissiveIntensity={0.12} clearcoat={0.6} clearcoatRoughness={0.3} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
          <ringGeometry args={[0.36, 0.39, 48]} />
          <meshBasicMaterial color="#7BE3BE" transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {label && (
        <Html position={[0, -0.02, 1.1]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label mint">{label}</span>
        </Html>
      )}

      {/* member coins */}
      <group ref={orbit}>
        {addrs.map((a, i) => {
          const th = (i / n) * TWO_PI
          return (
            <group key={a + i} position={[Math.cos(th) * R, 0, Math.sin(th) * R]} rotation={[0, -th, 0]}>
              <group ref={(el) => { coins.current[i] = el }} position={[0, COIN_Y, 0]} rotation={[0, 0, -0.16]}>
                <mesh geometry={coinGeo} material={coinMats[i].mats} />
                <mesh ref={(el) => { paidRings.current[i] = el }} geometry={paidGeo} rotation={[Math.PI / 2, 0, 0]} visible={false}>
                  <meshBasicMaterial color={MINT} transparent opacity={0.85} />
                </mesh>
              </group>
            </group>
          )
        })}
      </group>

      {/* proof pulses (pooled) */}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(el) => { pulses.current[i] = el }} visible={false}>
          <mesh geometry={pulseGeo}><meshBasicMaterial color="#C8F5E3" /></mesh>
          <mesh geometry={haloGeo}><meshBasicMaterial color={MINT} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
      ))}

      <Sparkles count={28} scale={[6.5, 2.4, 6.5]} position={[0, 0.7, 0]} size={2} speed={0.18} opacity={0.3} color="#7BE3BE" noise={0.6} />
    </>
  )
}
