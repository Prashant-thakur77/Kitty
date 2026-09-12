import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import type { FeedItem } from '../hooks'
import { usePointer } from './pointer'

/**
 * The savings circle as an object: member tokens orbit a glowing pot on a thin orbit line, ringed by 48 block ticks.
 * Ledger events arrive as props (newest first); each new one becomes a proof pulse — tokens → pot on a proven payment,
 * pot → recipient on a closed round or proven payout. Everything per-frame runs through refs; no state, no allocations.
 */

const R = 1.95                   // orbit radius
const POT_Y = 0.18
const MINT = '#4FD1A3'
const BG = '#0B100E'
const TWO_PI = Math.PI * 2
const HERO_CAMERA: [number, number, number] = [0, 4.1, 8.0] // keep in sync with Landing.tsx

// Six placeholder members whose leading bytes land on spaced hues, the same derivation Blockie uses (first 8 hex chars mod 360).
const PLACEHOLDER = ['0x000000a0', '0x000000cd', '0x00000028', '0x0000015e', '0x00000109', '0x0000005f'].map((p) => (p + '0'.repeat(32)) as `0x${string}`)
const hueOf = (addr: string) => parseInt(addr.slice(2, 10), 16) % 360

type Pulse = { active: boolean; t: number; dur: number; out: boolean; token: number }
type Cue = { at: number; kind: 'in' | 'out' | 'pot'; token: number }

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const POOL = 8

export default function HeroScene({ members, items }: { members?: readonly `0x${string}`[]; items: FeedItem[] }) {
  const addrs = members && members.length > 0 ? members : PLACEHOLDER
  const n = addrs.length
  const key = addrs.join(',')
  const colors = useMemo(() => addrs.map((a) => new THREE.Color().setHSL(hueOf(a) / 360, 0.42, 0.6)), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const emissives = useMemo(() => addrs.map((a) => new THREE.Color().setHSL(hueOf(a) / 360, 0.5, 0.28)), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const orbit = useRef<THREE.Group>(null)
  const coins = useRef<(THREE.Group | null)[]>([])
  const pot = useRef<THREE.Group>(null)
  const potMat = useRef<THREE.MeshStandardMaterial>(null)
  const potLight = useRef<THREE.PointLight>(null)
  const ring = useRef<THREE.Mesh>(null)
  const pulses = useRef<(THREE.Group | null)[]>([])
  const ticks = useRef<THREE.InstancedMesh>(null)
  const pointer = usePointer()
  const camera = useThree((s) => s.camera)

  // simulation state, mutated in useFrame only
  const sim = useRef({
    t: 0, angle: 0, potPulse: 0, idle: 4, primed: false,
    seen: new Set<string>(),
    queue: [] as Cue[],
    pool: Array.from({ length: POOL }, (): Pulse => ({ active: false, t: 0, dur: 1.7, out: false, token: 0 })),
    v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), camBase: new THREE.Vector3(...HERO_CAMERA), camTarget: new THREE.Vector3(),
    tickMat: new THREE.Matrix4(), tickObj: new THREE.Object3D(),
  })

  const indexOf = (addr: unknown) => {
    if (typeof addr !== 'string') return Math.floor(Math.random() * n)
    const i = addrs.findIndex((a) => a.toLowerCase() === addr.toLowerCase())
    return i >= 0 ? i : parseInt(addr.slice(2, 6), 16) % n
  }

  // Ledger events → cues. First load replays the four most recent so the mechanic is visible; after that only new ones fire.
  useEffect(() => {
    const s = sim.current
    const fresh = items.filter((i) => {
      const k = `${i.kind}:${i.tx}:${String(i.args.member ?? i.args.recipient ?? '')}:${String(i.args.round ?? '')}`
      if (s.seen.has(k)) return false
      s.seen.add(k); return true
    })
    const play = (s.primed ? fresh : fresh.slice(0, 4)).slice().reverse()
    s.primed = true
    let delay = 0.6
    for (const it of play) {
      if (it.kind === 'ContributionRecorded') { s.queue.push({ at: s.t + delay, kind: 'in', token: indexOf(it.args.member) }); delay += 0.45 }
      else if (it.kind === 'BatchVerified') { s.queue.push({ at: s.t + delay, kind: 'pot', token: 0 }); delay += 0.3 }
      else if (it.kind === 'RoundClosed') { s.queue.push({ at: s.t + delay, kind: 'pot', token: 0 }); s.queue.push({ at: s.t + delay + 0.5, kind: 'out', token: indexOf(it.args.recipient) }); delay += 1.2 }
      else if (it.kind === 'PayoutConfirmed') { s.queue.push({ at: s.t + delay, kind: 'out', token: indexOf(it.args.recipient) }); delay += 0.8 }
    }
    if (play.length) s.idle = 0
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  // static block ticks around the outer rim: 48 marks, the same scale the circle page draws
  useEffect(() => {
    const m = ticks.current; if (!m) return
    const { tickObj } = sim.current
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TWO_PI
      tickObj.position.set(Math.cos(a) * (R + 0.42), -0.02, Math.sin(a) * (R + 0.42))
      tickObj.rotation.set(0, -a, 0)
      tickObj.scale.setScalar(i % 12 === 0 ? 1.6 : 1)
      tickObj.updateMatrix()
      m.setMatrixAt(i, tickObj.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }, [])

  const coinGeo = useMemo(() => new THREE.CylinderGeometry(0.33, 0.33, 0.09, 22, 1), [])
  const coinRim = useMemo(() => new THREE.CylinderGeometry(0.34, 0.34, 0.03, 22, 1, true), [])
  const pulseGeo = useMemo(() => new THREE.SphereGeometry(0.07, 12, 8), [])
  // a 64px radial gradient, drawn once, for the soft halo under the pot
  const halo = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(79,209,163,0.55)'); grad.addColorStop(0.45, 'rgba(79,209,163,0.16)'); grad.addColorStop(1, 'rgba(79,209,163,0)')
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const haloGeo = useMemo(() => new THREE.SphereGeometry(0.16, 12, 8), [])

  const spawn = (kind: Cue['kind'], token: number) => {
    const s = sim.current
    if (kind === 'pot') { s.potPulse = Math.max(s.potPulse, 1); return }
    const p = s.pool.find((x) => !x.active); if (!p) return
    p.active = true; p.t = 0; p.out = kind === 'out'; p.token = token % n; p.dur = p.out ? 1.9 : 1.6
    if (kind === 'out') s.potPulse = Math.max(s.potPulse, 0.7)
  }

  useFrame((_, delta) => {
    const s = sim.current
    const dt = Math.min(delta, 0.05)
    s.t += dt
    s.angle += dt * 0.075
    s.idle += dt

    // orbit + coins
    if (orbit.current) orbit.current.rotation.y = -s.angle
    for (let i = 0; i < n; i++) {
      const c = coins.current[i]; if (!c) continue
      c.position.y = Math.sin(s.t * 0.7 + i * 1.3) * 0.05
      c.rotation.z = -0.14 + Math.sin(s.t * 0.45 + i) * 0.05
    }

    // pot breathing + pulse decay
    s.potPulse = Math.max(0, s.potPulse - dt / 1.4)
    const glow = 0.32 + Math.sin(s.t * 0.9) * 0.06 + s.potPulse * 0.7
    if (potMat.current) potMat.current.emissiveIntensity = glow
    if (potLight.current) potLight.current.intensity = 10 + s.potPulse * 26
    if (pot.current) { pot.current.rotation.y += dt * 0.12; pot.current.scale.setScalar(1 + Math.sin(Math.min(1, s.potPulse) * Math.PI) * 0.06) }
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + s.potPulse * 0.25

    // cues → pulses
    while (s.queue.length && s.queue[0].at <= s.t) { const c = s.queue.shift()!; spawn(c.kind, c.token); s.idle = 0 }
    if (s.idle > 9 && !s.queue.length) { spawn('in', Math.floor(Math.random() * n)); s.idle = 0 }

    // pulses travel between a token and the pot along a lifted arc
    for (let i = 0; i < POOL; i++) {
      const p = s.pool[i]; const g = pulses.current[i]; if (!g) continue
      if (!p.active) { g.visible = false; continue }
      p.t += dt / p.dur
      if (p.t >= 1) { p.active = false; g.visible = false; if (!p.out) s.potPulse = Math.max(s.potPulse, 0.55); continue }
      const e = easeInOut(p.t)
      const th = (p.token / n) * TWO_PI + s.angle
      s.a.set(Math.cos(th) * R, 0.04, Math.sin(th) * R)   // token
      s.b.set(0, POT_Y + 0.1, 0)                            // pot
      if (p.out) s.v.lerpVectors(s.b, s.a, e); else s.v.lerpVectors(s.a, s.b, e)
      s.v.y += Math.sin(p.t * Math.PI) * 0.42
      g.visible = true
      g.position.copy(s.v)
      g.scale.setScalar(0.55 + Math.sin(p.t * Math.PI) * 0.65)
    }

    // camera: slow drift + pointer parallax, eased
    const pt = pointer.current
    s.camTarget.set(s.camBase.x + Math.sin(s.t * 0.11) * 0.28 + pt.x * 0.55, s.camBase.y + Math.sin(s.t * 0.07) * 0.14 + pt.y * 0.3, s.camBase.z)
    camera.position.lerp(s.camTarget, 1 - Math.exp(-dt * 2.2))
    camera.lookAt(0, -0.1, 0)
  })

  return (
    <>
      <fog attach="fog" args={[BG, 6.5, 13.5]} />
      <hemisphereLight args={['#d7e4dd', BG, 0.55]} />
      <directionalLight position={[4, 6, 3]} intensity={1.8} color="#eef5f1" />
      <directionalLight position={[-5, 2.5, -4]} intensity={1.1} color="#7DB6E8" />
      <pointLight ref={potLight} position={[0, POT_Y + 0.3, 0]} color={MINT} intensity={10} distance={5.5} decay={2} />

      {/* ground halo under the pot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial map={halo} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* orbit line + block ticks */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <ringGeometry args={[R - 0.008, R + 0.008, 160]} />
        <meshBasicMaterial color={MINT} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <ringGeometry args={[R + 0.36, R + 0.365, 160]} />
        <meshBasicMaterial color="#2E3F37" transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={ticks} args={[undefined, undefined, 48]}>
        <boxGeometry args={[0.02, 0.012, 0.11]} />
        <meshBasicMaterial color="#2E3F37" />
      </instancedMesh>

      {/* the pot */}
      <group ref={pot} position={[0, POT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.64, 0.13, 18, 56]} />
          <meshStandardMaterial ref={potMat} color="#123128" emissive={MINT} emissiveIntensity={0.32} roughness={0.3} metalness={0.3} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
          <circleGeometry args={[0.56, 40]} />
          <meshStandardMaterial color="#0F1713" emissive={MINT} emissiveIntensity={0.14} roughness={0.7} metalness={0.1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
          <ringGeometry args={[0.36, 0.39, 48]} />
          <meshBasicMaterial color="#7BE3BE" transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* member tokens */}
      <group ref={orbit}>
        {addrs.map((a, i) => {
          const th = (i / n) * TWO_PI
          return (
            <group key={a + i} position={[Math.cos(th) * R, 0, Math.sin(th) * R]} rotation={[0, -th, 0]}>
              <group ref={(el) => { coins.current[i] = el }} rotation={[0, 0, -0.14]}>
                <mesh geometry={coinGeo} castShadow={false}>
                  <meshStandardMaterial color={colors[i]} emissive={emissives[i]} emissiveIntensity={0.55} roughness={0.42} metalness={0.35} flatShading />
                </mesh>
                <mesh geometry={coinRim}>
                  <meshBasicMaterial color="#E8F0EB" transparent opacity={0.16} depthWrite={false} />
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

      <Sparkles count={34} scale={[6.5, 2.4, 6.5]} position={[0, 0.7, 0]} size={2} speed={0.18} opacity={0.32} color="#7BE3BE" noise={0.6} />
    </>
  )
}
