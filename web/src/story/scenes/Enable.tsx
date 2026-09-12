import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { clock, easeBack, easeIn, easeOut, flash, pulse, seg, smooth, track } from '../timeline'
import { AMBER, BG, Floor, GEO, HUES, Label, Lights, MINT, MINT_2, Node, Packet, Person, Pot, ROSE, SKY, Slab, potHandle, slabHandle, type PersonH } from './common'

/**
 * Chapter 3 · What Creditcoin makes possible. Into the ledger: proven ticks rise into a score dial; a lender lights up,
 * reads it, and extends a credit line. Then the steward, a drone that only carries proof, reaches for the pot and is
 * refused; a stranger's drone delivers a valid proof and the ledger accepts it. Pure function of clock.t.
 */

const VAULT = new THREE.Vector3(-3.3, 0, 0)
const LEDGER = new THREE.Vector3(3.3, 0, 0)
const POT_ON_VAULT = new THREE.Vector3(-3.3, 0.27, 0)
const PROVER: [number, number, number] = [0, 0.8, 0.4]
const CHAIN: [number, number, number] = [4.9, 1.4, -1.9]
const DIAL = new THREE.Vector3(3.3, 1.6, 0.2)
const LENDER = new THREE.Vector3(8.3, 0, -5.4)
const LENDER_FACE = new THREE.Vector3(8.3, 2.5, -4.38)
const MEMBER = new THREE.Vector3(6.7, 0, 1.3)
const SCORE = 812
const N = 8
const DIAL_TICKS = 40
const DIAL_ARC = Math.PI * 1.5
const SPARK0 = 2.2, SPARK_GAP = 0.42, SPARK_DUR = 0.9
const FILL = [2.6, 6.9]
const LENDER_ON = 7.6
const BEAM = [9.0, 9.8]
const CREDIT = [10.6, 11.9]
const STEW_IN = [14.2, 14.9]
const STEW_FLY = [15.2, 17.2]
const STEW_DIP = [17.2, 17.8]
const REJECT = 17.8
const STEW_BACK = [17.8, 18.8]
const STEW_HOME = [21.6, 23.6]
const STR_IN = [19.2, 19.8]
const STR_FLY = [19.8, 22.6]
const STR_DROP = [22.6, 23.3]
const ACCEPT = 23.3
const WIN_COLS = 4, WIN_ROWS = 9
const TICK_BASE = new THREE.Color('#3A4E45')
const WIN_BASE = new THREE.Color('#0B1210')

const camPos = track([
  { t: 0, v: [2.3, 3.0, 5.4] }, { t: 6.8, v: [4.3, 2.9, 5.2] }, { t: 8.8, v: [5.0, 3.6, 9.4] }, { t: 13.4, v: [5.0, 3.6, 9.4] },
  { t: 16.2, v: [0.2, 4.4, 9.4] }, { t: 26, v: [0.6, 4.1, 8.8] },
])
const camAim = track([
  { t: 0, v: [3.3, 1.15, 0] }, { t: 6.8, v: [3.3, 1.25, 0] }, { t: 8.8, v: [5.4, 1.4, -1.0] }, { t: 13.4, v: [5.4, 1.4, -1.0] },
  { t: 16.2, v: [0, 0.7, 0] }, { t: 26, v: [0, 0.7, 0] },
])

/** A small drone: a tinted body inside a thin rotor ring, carrying a proof packet underneath. */
function Drone({ set, color, tint, children }: { set: (g: THREE.Group | null) => void; color: string; tint: string; children?: React.ReactNode }) {
  return (
    <group ref={set} scale={0.0001}>
      <mesh castShadow><octahedronGeometry args={[0.15, 0]} /><meshPhysicalMaterial color={tint} emissive={color} emissiveIntensity={0.5} roughness={0.3} metalness={0.5} clearcoat={1} clearcoatRoughness={0.1} flatShading /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.3, 0.014, 6, 40]} /><meshBasicMaterial color={color} transparent opacity={0.8} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.4]}><torusGeometry args={[0.36, 0.008, 6, 40]} /><meshBasicMaterial color={color} transparent opacity={0.35} /></mesh>
      {children}
    </group>
  )
}

export default function Enable() {
  const camera = useThree((s) => s.camera)
  const vault = useRef(slabHandle())
  const ledger = useRef(slabHandle())
  const pot = useRef(potHandle())
  const prover = useRef({ mesh: null as THREE.Mesh | null, mat: null as THREE.MeshPhysicalMaterial | null })
  const chain = useRef({ mesh: null as THREE.Mesh | null, mat: null as THREE.MeshPhysicalMaterial | null })
  const member = useRef<PersonH | null>(null)
  const ticks = useRef<THREE.InstancedMesh>(null)
  const dial = useRef<THREE.Group>(null)
  const dialTicks = useRef<THREE.InstancedMesh>(null)
  const needle = useRef<THREE.Group>(null)
  const scoreEl = useRef<HTMLDivElement>(null)
  const scoreWrap = useRef<HTMLDivElement>(null)
  const sparks = useRef<(THREE.Group | null)[]>(Array.from({ length: N }, () => null))
  const windows = useRef<THREE.InstancedMesh>(null)
  const beam = useRef<THREE.Mesh>(null)
  const credit = useRef<THREE.Mesh>(null)
  const creditMat = useRef<THREE.MeshBasicMaterial>(null)
  const steward = useRef<THREE.Group | null>(null)
  const stranger = useRef<THREE.Group | null>(null)
  const stewardPacket = useRef<THREE.Group | null>(null)
  const strangerPacket = useRef<THREE.Group | null>(null)
  const rejectRing = useRef<THREE.Mesh>(null)
  const acceptRing = useRef<THREE.Mesh>(null)
  const paidBar = useRef<THREE.MeshBasicMaterial>(null)

  const s = useMemo(() => {
    const strangerPath = new THREE.CatmullRomCurve3([new THREE.Vector3(-6.4, 2.7, -2.8), new THREE.Vector3(-2.6, 2.2, -0.4), new THREE.Vector3(0, 1.7, 0.7), new THREE.Vector3(3.3, 1.25, 0.4)], false, 'centripetal', 0.6)
    const beamDir = LENDER_FACE.clone().sub(DIAL)
    const creditDir = MEMBER.clone().sub(new THREE.Vector3(LENDER.x, 0, LENDER.z + 1.0))
    return {
      strangerPath, beamLen: beamDir.length(), beamMid: DIAL.clone().add(LENDER_FACE).multiplyScalar(0.5), beamQuat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), beamDir.clone().normalize()),
      creditLen: creditDir.length(), creditFrom: new THREE.Vector3(LENDER.x, 0.05, LENDER.z + 1.0), creditAngle: Math.atan2(creditDir.x, creditDir.z),
      v: new THREE.Vector3(), a: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), pos: [0, 0, 0], aim: [0, 0, 0], col: new THREE.Color(), obj: new THREE.Object3D(),
      mint: new THREE.Color(MINT), sky: new THREE.Color(SKY), rose: new THREE.Color(ROSE), white: new THREE.Color('#E8F0EB'), rimSky: new THREE.Color('#5E8FB8'), rimMint: new THREE.Color(MINT),
      tickPos: Array.from({ length: N }, (_, i) => new THREE.Vector3(LEDGER.x - 1.05 + (i / (N - 1)) * 2.1, 0.14, 0.2)),
    }
  }, [])

  useEffect(() => {
    const l = ticks.current
    if (l) {
      for (let i = 0; i < N; i++) { s.obj.position.set(-1.05 + (i / (N - 1)) * 2.1, 0.125, 0.2); s.obj.rotation.set(0, 0, 0); s.obj.scale.setScalar(1); s.obj.updateMatrix(); l.setMatrixAt(i, s.obj.matrix); l.setColorAt(i, s.mint) }
      l.instanceMatrix.needsUpdate = true; if (l.instanceColor) l.instanceColor.needsUpdate = true
    }
    const d = dialTicks.current
    if (d) {
      for (let i = 0; i < DIAL_TICKS; i++) {
        const a = -DIAL_ARC / 2 + (i / (DIAL_TICKS - 1)) * DIAL_ARC
        s.obj.position.set(Math.sin(a) * 0.66, Math.cos(a) * 0.66, 0); s.obj.rotation.set(0, 0, -a); s.obj.scale.setScalar(i % 10 === 0 || i === DIAL_TICKS - 1 ? 1.5 : 1)
        s.obj.updateMatrix(); d.setMatrixAt(i, s.obj.matrix); d.setColorAt(i, TICK_BASE)
      }
      d.instanceMatrix.needsUpdate = true; if (d.instanceColor) d.instanceColor.needsUpdate = true
    }
    const w = windows.current
    if (w) {
      for (let i = 0; i < WIN_COLS * WIN_ROWS; i++) {
        const c = i % WIN_COLS, r = Math.floor(i / WIN_COLS)
        s.obj.position.set(-0.6 + c * 0.4, 0.45 + r * 0.48, 1.01); s.obj.rotation.set(0, 0, 0); s.obj.scale.setScalar(1)
        s.obj.updateMatrix(); w.setMatrixAt(i, s.obj.matrix); w.setColorAt(i, WIN_BASE)
      }
      w.instanceMatrix.needsUpdate = true; if (w.instanceColor) w.instanceColor.needsUpdate = true
    }
  }, [s])

  useFrame(() => {
    const t = clock.t
    camPos(t, s.pos); camAim(t, s.aim)
    camera.position.set(s.pos[0], s.pos[1], s.pos[2]); camera.lookAt(s.aim[0], s.aim[1], s.aim[2])

    // ambient life: slabs float, nodes turn, pot breathes
    if (vault.current.g) vault.current.g.position.y = Math.sin(t * 0.5) * 0.02
    if (ledger.current.g) ledger.current.g.position.y = Math.sin(t * 0.5 + 1.6) * 0.02
    if (prover.current.mesh) { prover.current.mesh.scale.setScalar(1); prover.current.mesh.rotation.y = t * 0.4; prover.current.mesh.position.y = PROVER[1] + Math.sin(t * 0.9) * 0.04 }
    if (chain.current.mesh) { chain.current.mesh.scale.setScalar(1); chain.current.mesh.rotation.y = -t * 0.3 }
    const reject = flash(t, REJECT, 1.6), accept = flash(t, ACCEPT, 1.6)
    const breath = 0.5 + Math.sin(t * 0.9) * 0.5
    if (pot.current.g) { pot.current.g.position.copy(POT_ON_VAULT); pot.current.g.rotation.y = t * 0.12 }
    if (pot.current.mat) { pot.current.mat.emissiveIntensity = 0.2 + breath * 0.08 + reject * 0.5; pot.current.mat.emissive.copy(s.mint).lerp(s.rose, reject) }
    if (pot.current.light) { pot.current.light.intensity = 8 + breath * 2 + reject * 24; pot.current.light.color.copy(s.mint).lerp(s.rose, reject) }
    if (prover.current.mat) prover.current.mat.emissiveIntensity = 0.5 + flash(t, STR_FLY[0] + (STR_FLY[1] - STR_FLY[0]) * 0.62, 0.8) * 1.1

    // sparks rise from the ledger's ticks into the dial; the dial fills and the number counts
    for (let i = 0; i < N; i++) {
      const g = sparks.current[i]; if (!g) continue
      const st = SPARK0 + i * SPARK_GAP
      const p = seg(t, st, st + SPARK_DUR, smooth)
      if (t < st || p >= 1) { g.visible = false; continue }
      s.v.copy(s.tickPos[i]).lerp(DIAL, p); s.v.x += Math.sin(p * Math.PI) * (i % 2 ? 0.25 : -0.25)
      g.visible = true; g.position.copy(s.v); g.scale.setScalar(0.5 + Math.sin(p * Math.PI) * 0.6)
    }
    const lt = ticks.current
    if (lt) {
      for (let i = 0; i < N; i++) lt.setColorAt(i, s.col.copy(s.mint).lerp(s.white, pulse(t, SPARK0 + i * SPARK_GAP - 0.2, 0.6) * 0.8))
      if (lt.instanceColor) lt.instanceColor.needsUpdate = true
    }
    const fill = seg(t, FILL[0], FILL[1], easeOut) * (SCORE / 1000)
    if (dial.current) { dial.current.lookAt(camera.position); dial.current.scale.setScalar(Math.max(0.0001, seg(t, 1.2, 2.2, easeBack))) }
    const dt = dialTicks.current
    if (dt) {
      const lit = fill * DIAL_TICKS
      for (let i = 0; i < DIAL_TICKS; i++) dt.setColorAt(i, s.col.lerpColors(TICK_BASE, s.mint, i < lit ? Math.min(1, lit - i) : 0))
      if (dt.instanceColor) dt.instanceColor.needsUpdate = true
    }
    if (needle.current) needle.current.rotation.z = -(-DIAL_ARC / 2 + fill * DIAL_ARC)
    if (scoreEl.current) { const n = Math.round(fill * 1000); if (scoreEl.current.textContent !== String(n)) scoreEl.current.textContent = String(n) }
    if (scoreWrap.current) scoreWrap.current.style.opacity = seg(t, 1.6, 2.4).toFixed(3)

    // the lender lights up floor by floor, reads the dial, and extends a credit line to the member
    const w = windows.current
    if (w) {
      for (let i = 0; i < WIN_COLS * WIN_ROWS; i++) {
        const r = Math.floor(i / WIN_COLS)
        const k = seg(t, LENDER_ON + r * 0.14, LENDER_ON + r * 0.14 + 0.35, easeOut)
        w.setColorAt(i, s.col.lerpColors(WIN_BASE, s.sky, k * (0.75 + 0.25 * Math.sin(i * 7.3))))
      }
      if (w.instanceColor) w.instanceColor.needsUpdate = true
    }
    if (beam.current) {
      const k = seg(t, BEAM[0], BEAM[1], easeOut) * (1 - seg(t, 13.2, 14.2, easeIn))
      beam.current.visible = k > 0.001
      beam.current.scale.set(1, Math.max(0.0001, k * s.beamLen), 1)
      s.v.copy(LENDER_FACE).lerp(DIAL, k * 0.5); beam.current.position.copy(s.v)
      ;(beam.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * k
    }
    if (credit.current) {
      const k = seg(t, CREDIT[0], CREDIT[1], easeOut)
      credit.current.scale.set(1, 1, Math.max(0.0001, k * s.creditLen))
      s.v.set(0, 0, k * s.creditLen * 0.5).applyAxisAngle(s.up, s.creditAngle).add(s.creditFrom)
      credit.current.position.copy(s.v)
      if (creditMat.current) creditMat.current.opacity = 0.9 * seg(t, CREDIT[0], CREDIT[0] + 0.3) * (1 - seg(t, 14.4, 15.4))
    }
    const m = member.current
    if (m?.g) { m.body.emissive.copy(m.base).multiplyScalar(pulse(t, CREDIT[1] - 0.3, 2.2) * 0.6); m.g.rotation.y = Math.atan2(LENDER.x - MEMBER.x, LENDER.z - MEMBER.z) }

    // the steward: appears by the ledger, flies to the vault, reaches for the pot, is thrown back, drifts home
    const sg = steward.current
    if (sg) {
      const inK = seg(t, STEW_IN[0], STEW_IN[1], easeBack)
      const fly = seg(t, STEW_FLY[0], STEW_FLY[1])
      const dip = seg(t, STEW_DIP[0], STEW_DIP[1], easeIn)
      const back = seg(t, STEW_BACK[0], STEW_BACK[1], easeOut)
      const home = seg(t, STEW_HOME[0], STEW_HOME[1])
      s.v.set(1.5, 1.9, 1.5).lerp(s.a.set(-3.3, 1.7, 0.6), fly); s.v.y += Math.sin(fly * Math.PI) * 0.8
      if (dip > 0) s.v.lerp(s.a.set(-3.3, 0.78, 0.25), dip)
      if (back > 0) s.v.lerp(s.a.set(-1.3, 2.1, 1.1), back)
      if (home > 0) s.v.lerp(s.a.set(1.5, 1.9, 1.5), home)
      s.v.y += Math.sin(t * 2.2) * 0.05
      sg.position.copy(s.v); sg.scale.setScalar(Math.max(0.0001, inK)); sg.rotation.y = t * 1.6
      sg.rotation.z = Math.sin(t * 22) * 0.35 * reject; sg.rotation.x = -fly * (1 - fly) * 0.6
      if (stewardPacket.current) { stewardPacket.current.visible = true; stewardPacket.current.position.set(0, -0.32, 0); stewardPacket.current.scale.setScalar(0.7) }
    }
    if (rejectRing.current) {
      const k = seg(t, REJECT, REJECT + 1.1, easeOut)
      rejectRing.current.visible = k > 0 && k < 1
      rejectRing.current.scale.setScalar(0.4 + k * 2.6)
      ;(rejectRing.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
    }
    if (vault.current.rim) vault.current.rim.color.copy(s.rimSky).lerp(s.rose, Math.min(1, reject * 1.5))
    if (vault.current.top) { vault.current.top.emissive.copy(s.sky).lerp(s.rose, Math.min(1, reject * 1.5)); vault.current.top.emissiveIntensity = 0.1 + reject * 0.5 }

    // the stranger: arrives from the far left with a proof, hands it to the ledger, and the ledger accepts it
    const tg = stranger.current
    if (tg) {
      const inK = seg(t, STR_IN[0], STR_IN[1], easeBack)
      const p = seg(t, STR_FLY[0], STR_FLY[1], smooth)
      s.strangerPath.getPointAt(p, s.v); s.v.y += Math.sin(t * 2.5 + 1) * 0.05
      tg.position.copy(s.v); tg.scale.setScalar(Math.max(0.0001, inK)); tg.rotation.y = -t * 1.4
      tg.rotation.z = -p * (1 - p) * 0.5
      const drop = seg(t, STR_DROP[0], STR_DROP[1], easeIn)
      const pk = strangerPacket.current
      if (pk) {
        if (drop <= 0) { pk.visible = true; pk.position.set(0, -0.32, 0); pk.scale.setScalar(0.7) }
        else if (drop >= 1) pk.visible = false
        else { pk.visible = true; pk.position.set(0, -0.32 - drop * (s.v.y - 0.36), 0); pk.scale.setScalar(0.7 + Math.sin(drop * Math.PI) * 0.4) }
      }
    }
    if (acceptRing.current) {
      const k = seg(t, ACCEPT, ACCEPT + 1.2, easeOut)
      acceptRing.current.visible = k > 0 && k < 1
      acceptRing.current.scale.setScalar(0.6 + k * 3.2)
      ;(acceptRing.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
    }
    if (ledger.current.rim) ledger.current.rim.color.copy(s.rimMint).lerp(s.white, accept * 0.7)
    if (ledger.current.top) ledger.current.top.emissiveIntensity = 0.16 + accept * 0.6 + pulse(t, SPARK0 - 0.3, 5) * 0.12
    if (paidBar.current) paidBar.current.opacity = 0.55 + accept * 0.45
  })

  return (
    <>
      <fog attach="fog" args={[BG, 8, 24]} />
      <Lights keyPos={[3, 8, 5]} bounds={9} />
      <Floor />

      <Slab h={vault} glass rimColor="#5E8FB8" tint={SKY} position={[VAULT.x, 0, 0]} />
      <Slab h={ledger} rimColor={MINT} tint={MINT} position={[LEDGER.x, 0, 0]} />
      <Pot h={pot} />
      <group position={[LEDGER.x, 0, 0]}>
        <instancedMesh ref={ticks} args={[undefined, undefined, N]}>
          <boxGeometry args={[0.14, 0.02, 0.4]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.118, -0.42]}>
          <planeGeometry args={[2.24, 0.12]} />
          <meshBasicMaterial ref={paidBar} color={MINT} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      </group>
      <Node h={prover} kind="octa" color={SKY} tint="#1A2A3A" position={PROVER} />
      <Node h={chain} kind="ico" color={AMBER} tint="#33291A" position={CHAIN} />

      {/* the score dial: a three-quarter ring of ticks that fills, a needle, and the number */}
      <group ref={dial} position={DIAL}>
        <instancedMesh ref={dialTicks} args={[undefined, undefined, DIAL_TICKS]}>
          <boxGeometry args={[0.03, 0.1, 0.02]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
        <group ref={needle}>
          <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.02, 0.42, 0.02]} /><meshBasicMaterial color={MINT_2} /></mesh>
        </group>
        <mesh><sphereGeometry args={[0.04, 10, 8]} /><meshBasicMaterial color={MINT_2} /></mesh>
        <Html position={[0, -0.34, 0]} center zIndexRange={[10, 2]} style={{ pointerEvents: 'none' }}>
          <div ref={scoreWrap} className="story-score" style={{ opacity: 0 }}><div className="eyebrow">Kitty Score</div><div ref={scoreEl} className="story-score-n mono">0</div></div>
        </Html>
      </group>
      {Array.from({ length: N }, (_, i) => (
        <group key={i} ref={(el) => { sparks.current[i] = el }} visible={false}>
          <mesh geometry={GEO.spark}><meshBasicMaterial color="#C8F5E3" /></mesh>
          <mesh geometry={GEO.halo} scale={0.7}><meshBasicMaterial color={MINT} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
      ))}

      {/* the lender: a monolith whose windows light floor by floor */}
      <group position={LENDER}>
        <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 5.0, 2.0]} />
          <meshStandardMaterial color="#141B18" roughness={0.85} metalness={0.15} />
        </mesh>
        <instancedMesh ref={windows} args={[undefined, undefined, WIN_COLS * WIN_ROWS]}>
          <boxGeometry args={[0.22, 0.2, 0.03]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
        <Label position={[0, 5.5, 0]} tone="sky" at={LENDER_ON + 1.2}>lender</Label>
      </group>
      <mesh ref={beam} quaternion={s.beamQuat} visible={false}>
        <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
        <meshBasicMaterial color={SKY} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={credit} rotation={[0, s.creditAngle, 0]}>
        <boxGeometry args={[0.1, 0.03, 1]} />
        <meshBasicMaterial ref={creditMat} color={MINT} transparent opacity={0} />
      </mesh>
      <Person hue={HUES[3]} set={(h) => { member.current = h }} position={[MEMBER.x, 0, MEMBER.z]} />
      <Label position={[MEMBER.x, 1.8, MEMBER.z]} tone="mint" at={CREDIT[1]} until={14.6}>credit line · 1,200 tUSD</Label>
      <Label position={[5.8, 2.7, -2.2]} tone="sky" at={BEAM[1]} until={13.0}>reads the score</Label>

      {/* the steward and the stranger */}
      <Drone set={(g) => { steward.current = g }} color={MINT} tint="#1B4A3D">
        <Packet set={(g) => { stewardPacket.current = g }} />
        <Label position={[0, 0.62, 0]} tone="mint" at={STEW_IN[1]} until={REJECT}>steward · carries proof only</Label>
        <Label position={[0, 0.62, 0]} tone="rose" at={REJECT + 0.2} until={STEW_HOME[0]}>rejected · no key to the money</Label>
      </Drone>
      <Drone set={(g) => { stranger.current = g }} color={SKY} tint="#22323E">
        <Packet set={(g) => { strangerPacket.current = g }} core="#DDEBF7" color={SKY} />
        <Label position={[0, 0.62, 0]} tone="sky" at={STR_IN[1]} until={ACCEPT}>a stranger · valid proof</Label>
        <Label position={[0, 0.62, 0]} tone="mint" at={ACCEPT + 0.2}>accepted</Label>
      </Drone>
      <mesh ref={rejectRing} geometry={GEO.ring} position={[VAULT.x, 0.32, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <meshBasicMaterial color={ROSE} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={acceptRing} geometry={GEO.ring} position={[LEDGER.x, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <meshBasicMaterial color={MINT} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      <Label position={[VAULT.x, -0.35, 1.1]} tone="sky" at={13.8}><b>Ethereum</b> · KittyVault</Label>
      <Label position={[LEDGER.x, -0.35, 1.1]} tone="mint" at={0.4}><b>Creditcoin</b> · KittyLedger</Label>
      <Label position={[PROVER[0], PROVER[1] - 0.6, PROVER[2] + 0.1]} tone="sky" at={16.5}>0x0FD2 · block prover</Label>
      <Label position={[CHAIN[0], CHAIN[1] + 0.5, CHAIN[2]]} tone="amber" at={0.4} until={13.5}>0x0FD3 · attestation</Label>

      <Sparkles count={26} scale={[10, 2.6, 6]} position={[0, 1.4, 0]} size={2} speed={0.16} opacity={0.26} color="#7BE3BE" noise={0.6} />
    </>
  )
}
