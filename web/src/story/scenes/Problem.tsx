import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { clock, easeIn, easeOut, flash, lerp, pulse, seg, track } from '../timeline'
import { AMBER, BG, Coin, Floor, GEO, GRAPHITE, HUES, Label, Lights, Person, Pot, ROSE, TWO_PI, faceTo, potHandle, type CoinH, type PersonH } from './common'

/**
 * Chapter 1 · The problem. Eight friends around a table, a glowing pot in the middle. Three months of coins sliding in and
 * the pot sliding out to the next member; then the treasurer lifts the pot and walks into the fog; then one member's coin
 * fails to move, and the bank on the horizon never lights up. Every transform below is a pure function of clock.t.
 */

const N = 8
const R_PERSON = 3.05
const R_COIN = 1.55
const TABLE_Y = 0.8
const POT_Y = TABLE_Y + 0.2
const TREASURER = 4
const SKIPPER = 2
const MONTHS = [2.2, 6.7, 11.2, 23.4]        // month 4 is the one where SKIPPER stops paying
const RECIPIENT = [0, 1, 2, -1]
const LIFT = [16.0, 17.4]
const WALK = [17.6, 22.4]
const NEW_POT = [22.6, 23.3]
const DIM = [20.4, 23.0]
const BANK: [number, number, number] = [6.2, 0, -14]

const ang = (i: number) => ((i + 0.5) / N) * TWO_PI
const at = (i: number, r: number): [number, number, number] => [Math.sin(ang(i)) * r, 0, Math.cos(ang(i)) * r]

const camPos = track([
  { t: 0, v: [0.4, 6.6, 11.2] }, { t: 11, v: [1.3, 4.4, 8.8] }, { t: 16, v: [1.3, 4.4, 8.8] },
  { t: 21.5, v: [-1.2, 3.6, 9.2] }, { t: 26, v: [0.6, 4.2, 8.9] }, { t: 28.4, v: [0.6, 4.2, 8.9] }, { t: 31.6, v: [2.4, 6.2, 12.6] }, { t: 34, v: [2.6, 6.3, 12.9] },
])
const camAim = track([
  { t: 0, v: [0, 1.0, 0] }, { t: 11, v: [0, 0.95, 0] }, { t: 16, v: [0, 0.95, 0] },
  { t: 21.5, v: [-1.6, 1.0, -2.4] }, { t: 26, v: [0.5, 0.9, 0.2] }, { t: 28.4, v: [0.5, 0.9, 0.2] }, { t: 31.6, v: [3.2, 3.2, -8] }, { t: 34, v: [3.3, 3.3, -8.2] },
])

export default function Problem() {
  const camera = useThree((s) => s.camera)
  const people = useRef<(PersonH | null)[]>(Array.from({ length: N }, () => null))
  const coins = useRef<(CoinH | null)[]>(Array.from({ length: N }, () => null))
  const pot = useRef(potHandle())
  const fog = useRef<THREE.Fog>(null)
  const treasurerRing = useRef<THREE.MeshBasicMaterial>(null)
  const skipRing = useRef<THREE.MeshBasicMaterial>(null)
  const s = useMemo(() => ({
    v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), pos: [0, 0, 0], aim: [0, 0, 0],
    graphite: new THREE.Color(GRAPHITE), rose: new THREE.Color(ROSE), tmp: new THREE.Color(),
    spots: Array.from({ length: N }, (_, i) => new THREE.Vector3(...at(i, R_COIN)).setY(TABLE_Y + 0.03)),
    centre: new THREE.Vector3(0, POT_Y, 0),
  }), [])

  useFrame(() => {
    const t = clock.t
    // ── camera ──
    camPos(t, s.pos); camAim(t, s.aim)
    camera.position.set(s.pos[0], s.pos[1], s.pos[2])
    camera.lookAt(s.aim[0], s.aim[1], s.aim[2])
    if (fog.current) fog.current.far = lerp(24, 38, seg(t, 28, 31.5))

    // ── which month are we in (coins reappear 0.35 s before a month starts) ──
    let m = -1
    for (let i = 0; i < MONTHS.length; i++) if (t >= MONTHS[i] - 0.35) m = i
    const M = m >= 0 ? MONTHS[m] : 0
    const local = t - M

    // ── the treasurer's exit: pot lifted, then both walk out along the treasurer's radial ──
    const lift = seg(t, LIFT[0], LIFT[1])
    const walk = seg(t, WALK[0], WALK[1], (p) => p * p * (2 - p))   // slow first step, then steady
    const dx = Math.sin(ang(TREASURER)), dz = Math.cos(ang(TREASURER))
    const walkOut = walk * 8.5

    // ── pot ──
    const potG = pot.current.g
    if (potG) {
      let glow = 1
      if (t < LIFT[0]) {
        s.v.copy(s.centre)
        if (m >= 0 && RECIPIENT[m] >= 0) {
          const q = seg(local, 2.3, 3.4) - seg(local, 3.9, 4.5)
          s.a.copy(s.spots[RECIPIENT[m]]).setY(POT_Y + 0.02)
          s.v.lerp(s.a, q)
        }
        potG.position.copy(s.v); potG.scale.setScalar(1)
      } else if (t < NEW_POT[0]) {
        s.a.set(dx * 2.45, 1.02, dz * 2.45)                       // held in front of the treasurer
        s.v.copy(s.centre).lerp(s.a, lift)
        s.v.y += (lift * (1 - lift)) * 0.5
        s.v.x += dx * walkOut; s.v.z += dz * walkOut; s.v.y += Math.sin(t * 9) * 0.03 * walk
        potG.position.copy(s.v); potG.scale.setScalar(1)
        glow = 1 - seg(t, 19, 22, easeIn)
      } else {
        // a new, dimmer pot for a circle that carries on without its treasurer
        potG.position.copy(s.centre); potG.scale.setScalar(Math.max(0.0001, seg(t, NEW_POT[0], NEW_POT[1], easeOut)))
        glow = 0.55
      }
      potG.rotation.y = t * 0.12
      let pulseK = 0
      if (m >= 0) pulseK = Math.max(flash(local, 1.95, 1.2), RECIPIENT[m] >= 0 ? pulse(local, 3.0, 1.2) * 0.7 : 0)
      const breath = 0.5 + Math.sin(t * 0.9) * 0.5
      if (pot.current.mat) pot.current.mat.emissiveIntensity = glow * (0.2 + breath * 0.08 + pulseK * 0.6)
      if (pot.current.light) pot.current.light.intensity = glow * (8 + breath * 2 + pulseK * 22)
      if (pot.current.inner) pot.current.inner.opacity = glow * (0.18 + pulseK * 0.3)
    }

    // ── coins ──
    for (let i = 0; i < N; i++) {
      const c = coins.current[i]; const g = c?.g; if (!c || !g) continue
      if (m < 0) { g.position.copy(s.spots[i]); g.scale.setScalar(1); g.visible = true; continue }
      const skip = RECIPIENT[m] < 0 && i === SKIPPER
      const start = local - i * 0.09
      if (local < 0 || skip) {
        g.position.copy(s.spots[i])
        if (skip) { g.position.x += Math.sin(t * 38) * 0.02 * pulse(t, M + 0.3, 2.2); g.position.z += Math.cos(t * 41) * 0.015 * pulse(t, M + 0.3, 2.2) }
        g.scale.setScalar(m === 0 ? 1 : seg(t, M - 0.35, M, easeOut)); g.visible = true; continue
      }
      const p = seg(start, 0, 1.15)
      s.v.copy(s.spots[i]).lerp(s.centre, p); s.v.y += Math.sin(p * Math.PI) * 0.28
      const sc = 1 - seg(start, 0.95, 1.15)
      g.position.copy(s.v); g.rotation.y = p * 3; g.scale.setScalar(Math.max(0.0001, sc)); g.visible = sc > 0.001
    }

    // ── people: recipient brightens, everyone dims after the treasurer leaves, the skipper flickers rose ──
    const dim = seg(t, DIM[0], DIM[1])
    for (let i = 0; i < N; i++) {
      const p = people.current[i]; if (!p || !p.g) continue
      const k = dim * 0.5
      p.body.color.copy(p.base).lerp(s.graphite, k); p.head.color.copy(p.headBase).lerp(s.graphite, k)
      let e = 0
      if (m >= 0 && RECIPIENT[m] === i) e = pulse(local, 2.6, 2.2) * 0.55
      p.body.emissive.copy(p.base).multiplyScalar(e)
      if (i === SKIPPER && t > MONTHS[3] + 0.3 && t < MONTHS[3] + 3.4) { const f = (Math.sin(t * 16) > 0.2 ? 1 : 0.25) * pulse(t, MONTHS[3] + 0.3, 3.1); p.body.emissive.copy(s.rose).multiplyScalar(f * 0.5) }
      if (i === TREASURER) {
        const base = at(i, R_PERSON)
        p.g.position.set(base[0] + dx * walkOut, Math.abs(Math.sin(t * 9)) * 0.04 * walk, base[2] + dz * walkOut)
        p.g.rotation.y = lerp(faceTo(base[0], base[2]), faceTo(base[0], base[2]) + Math.PI, seg(t, WALK[0] - 0.4, WALK[0] + 0.3))
        p.g.rotation.z = Math.sin(t * 9) * 0.03 * walk
      }
    }
    if (treasurerRing.current) treasurerRing.current.opacity = 0.9 * seg(t, 8.4, 9.2) * (1 - seg(t, 17.4, 18.2))
    if (skipRing.current) skipRing.current.opacity = 0.9 * seg(t, MONTHS[3] + 0.6, MONTHS[3] + 1.3) * (1 - seg(t, 28.2, 29.2))
  })

  const tr = at(TREASURER, R_PERSON), sk = at(SKIPPER, R_PERSON)
  return (
    <>
      <fog ref={fog} attach="fog" args={[BG, 8, 24]} />
      <Lights keyPos={[4, 8, 5]} bounds={6} />
      <Floor />

      {/* the table: a lacquered top on a dark pedestal */}
      <mesh position={[0, TABLE_Y - 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.3, 2.3, 0.1, 64]} />
        <meshPhysicalMaterial color="#161F1A" roughness={0.42} metalness={0.2} clearcoat={0.7} clearcoatRoughness={0.3} />
      </mesh>
      <mesh position={[0, (TABLE_Y - 0.1) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.55, TABLE_Y - 0.1, 24]} />
        <meshStandardMaterial color="#0F1613" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* people, coins, pot */}
      {HUES.map((hue, i) => {
        const p = at(i, R_PERSON)
        return <Person key={i} hue={hue} set={(h) => { people.current[i] = h }} position={p} facing={faceTo(p[0], p[2])} />
      })}
      {HUES.map((hue, i) => <Coin key={i} hue={hue} set={(h) => { coins.current[i] = h }} />)}
      <Pot h={pot} />

      {/* the treasurer's mark and the missed payment's mark: thin rings on the floor */}
      <mesh geometry={GEO.ring} position={[tr[0], 0.012, tr[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial ref={treasurerRing} color={AMBER} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh geometry={GEO.ring} position={[sk[0], 0.012, sk[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial ref={skipRing} color={ROSE} transparent opacity={0} depthWrite={false} />
      </mesh>
      <Label position={[tr[0], 1.8, tr[2]]} tone="amber" at={8.6} until={17.2}>treasurer</Label>
      <Label position={[sk[0], 1.8, sk[2]]} tone="rose" at={MONTHS[3] + 0.9} until={28.4}>stopped paying</Label>

      {/* the bank: a dark monolith on the horizon that never lights up */}
      <group position={BANK}>
        <mesh position={[0, 4.6, 0]} castShadow>
          <boxGeometry args={[4.2, 9.2, 3]} />
          <meshStandardMaterial color="#212C27" roughness={0.9} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[5.4, 0.12, 4.2]} />
          <meshStandardMaterial color="#101613" roughness={0.9} metalness={0.15} />
        </mesh>
        <Label position={[0, 9.9, 0]} at={29.6} until={34}>the bank · sees nothing</Label>
      </group>

      <Sparkles count={26} scale={[7, 2.4, 7]} position={[0, 1.6, 0]} size={2} speed={0.16} opacity={0.28} color="#7BE3BE" noise={0.6} />
    </>
  )
}
