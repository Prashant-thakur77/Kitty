import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { clock, easeBack, easeOut, flash, lerp, pulse, seg, smooth, track } from '../timeline'
import { AMBER, BG, Coin, Floor, GEO, HUES, Label, Lights, MINT, Node, Packet, Person, Pot, SKY, Slab, TWO_PI, faceTo, potHandle, slabHandle, type CoinH, type PersonH } from './common'

/**
 * Chapter 2 · The split. The circle opens along its seam: the pot settles onto a glass vault on Ethereum, a ledger rises on
 * Creditcoin. Coins pay into the vault; each payment becomes a proof packet through 0x0FD2 that draws a tick on the ledger;
 * the attested clock closes the round; the vault pays out and the payout is proven back. Pure function of clock.t.
 */

const N = 8
const R0 = 3.0
const VAULT = new THREE.Vector3(-3.3, 0, 0)
const LEDGER = new THREE.Vector3(3.3, 0, 0)
const POT_ON_VAULT = new THREE.Vector3(-3.3, 0.27, 0)
const PROVER: [number, number, number] = [0, 0.8, 0.4]
const CHAIN: [number, number, number] = [3.5, 1.9, -1.3]
const RECIPIENT = 3
const SEAM = [2.0, 3.2]
const SPLIT = [3.4, 6.4]
const LEDGER_RISE = [8.2, 10.2]
const PROVER_IN = [10.8, 11.6]
const PAY0 = 11.6, PAY_GAP = 0.72, PAY_DUR = 1.3
const PROOF_DELAY = 0.25, PROOF_DUR = 2.0
const CHAIN_IN = [19.4, 20.2]
const CLOCK = [20.3, 23.9]
const DROP = [24.0, 24.9]
const PAYOUT = [25.3, 27.1]
const PAYBACK = [27.3, 29.3]
const CLOCK_TICKS = 36
const TICK_BASE = new THREE.Color('#1F2D27')
const TICK_MINT = new THREE.Color(MINT)
const TICK_AMBER = new THREE.Color(AMBER)

const ang = (i: number) => ((i + 0.5) / N) * TWO_PI
const circleAt = (i: number) => new THREE.Vector3(Math.sin(ang(i)) * R0, 0, Math.cos(ang(i)) * R0)
const arcAt = (i: number) => { const a = Math.PI * (0.6 + (i / (N - 1)) * 0.8); return new THREE.Vector3(VAULT.x + Math.cos(a) * 2.15, 0, Math.sin(a) * 2.3) }
const payStart = (i: number) => PAY0 + i * PAY_GAP
const proofStart = (i: number) => payStart(i) + PAY_DUR + PROOF_DELAY

const camPos = track([
  { t: 0, v: [0, 5.0, 9.4] }, { t: 3.2, v: [0, 5.0, 9.4] }, { t: 7.5, v: [-0.5, 4.6, 10.6] }, { t: 12, v: [-0.5, 4.6, 10.6] },
  { t: 19.5, v: [1.6, 3.7, 8.8] }, { t: 24.8, v: [2.0, 3.7, 8.8] }, { t: 27, v: [-0.6, 4.3, 9.8] }, { t: 29.5, v: [-0.6, 4.3, 9.8] }, { t: 33, v: [0, 3.5, 7.8] },
])
const camAim = track([
  { t: 0, v: [0, 0.4, 0] }, { t: 3.2, v: [0, 0.4, 0] }, { t: 7.5, v: [-0.4, 0.5, 0] }, { t: 12, v: [-0.4, 0.5, 0] },
  { t: 19.5, v: [1.6, 0.9, -0.4] }, { t: 24.8, v: [1.8, 0.9, -0.4] }, { t: 27, v: [-1.0, 0.6, 0.2] }, { t: 29.5, v: [-1.0, 0.6, 0.2] }, { t: 33, v: [0, 0.6, 0] },
])

export default function Split() {
  const camera = useThree((s) => s.camera)
  const people = useRef<(PersonH | null)[]>(Array.from({ length: N }, () => null))
  const coins = useRef<(CoinH | null)[]>(Array.from({ length: N }, () => null))
  const packets = useRef<(THREE.Group | null)[]>(Array.from({ length: N + 1 }, () => null))
  const pot = useRef(potHandle())
  const vault = useRef(slabHandle())
  const ledger = useRef(slabHandle())
  const prover = useRef({ mesh: null as THREE.Mesh | null, mat: null as THREE.MeshPhysicalMaterial | null })
  const chain = useRef({ mesh: null as THREE.Mesh | null, mat: null as THREE.MeshPhysicalMaterial | null })
  const seam = useRef<THREE.MeshBasicMaterial>(null)
  const ticks = useRef<THREE.InstancedMesh>(null)
  const ledgerDeck = useRef<THREE.Group>(null)
  const clockRing = useRef<THREE.Group>(null)
  const clockTicks = useRef<THREE.InstancedMesh>(null)
  const drop = useRef<THREE.Group>(null)
  const paidBar = useRef<THREE.MeshBasicMaterial>(null)
  const recipientRing = useRef<THREE.MeshBasicMaterial>(null)

  const s = useMemo(() => {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.3, 0.34, 0), new THREE.Vector3(-1.7, 1.0, 0.3), new THREE.Vector3(...PROVER), new THREE.Vector3(1.7, 1.0, 0.3), new THREE.Vector3(3.3, 0.34, 0),
    ], false, 'centripetal', 0.6)
    const dropPath = new THREE.CatmullRomCurve3([new THREE.Vector3(...CHAIN), new THREE.Vector3(3.9, 1.2, -0.7), new THREE.Vector3(3.3, 0.34, 0)], false, 'centripetal', 0.6)
    return {
      path, dropPath, proofLineObj: new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.getPoints(64)), new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0, depthWrite: false })),
      v: new THREE.Vector3(), a: new THREE.Vector3(), pos: [0, 0, 0], aim: [0, 0, 0], col: new THREE.Color(), obj: new THREE.Object3D(),
      circle: Array.from({ length: N }, (_, i) => circleAt(i)), arc: Array.from({ length: N }, (_, i) => arcAt(i)),
      rimSky: new THREE.Color('#5E8FB8'), rimMint: new THREE.Color(MINT), rimAmber: new THREE.Color(AMBER), white: new THREE.Color('#E8F0EB'),
    }
  }, [])

  // static layout of the clock's 36 ticks (a vertical ring round the 0x0FD3 node) and the ledger's 8 tick slots
  useEffect(() => {
    const m = clockTicks.current
    if (m) {
      for (let i = 0; i < CLOCK_TICKS; i++) {
        const a = (i / CLOCK_TICKS) * TWO_PI
        s.obj.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.62, 0); s.obj.rotation.set(0, 0, -a); s.obj.scale.setScalar(i % 9 === 0 ? 1.5 : 1)
        s.obj.updateMatrix(); m.setMatrixAt(i, s.obj.matrix); m.setColorAt(i, TICK_BASE)
      }
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    const l = ticks.current
    if (l) {
      for (let i = 0; i < N; i++) {
        s.obj.position.set(-1.05 + (i / (N - 1)) * 2.1, 0.125, 0.2); s.obj.rotation.set(0, 0, 0); s.obj.scale.setScalar(1)
        s.obj.updateMatrix(); l.setMatrixAt(i, s.obj.matrix); l.setColorAt(i, TICK_BASE)
      }
      l.instanceMatrix.needsUpdate = true; if (l.instanceColor) l.instanceColor.needsUpdate = true
    }
  }, [s])

  useFrame(() => {
    const t = clock.t
    camPos(t, s.pos); camAim(t, s.aim)
    camera.position.set(s.pos[0], s.pos[1], s.pos[2]); camera.lookAt(s.aim[0], s.aim[1], s.aim[2])

    const split = seg(t, SPLIT[0], SPLIT[1])
    if (seam.current) seam.current.opacity = 0.8 * seg(t, SEAM[0], SEAM[1], easeOut) * (1 - seg(t, 6.5, 8))

    // slabs rise out of the floor
    if (vault.current.g) vault.current.g.position.y = lerp(-0.6, 0, seg(t, SPLIT[0], SPLIT[0] + 2.2, easeOut)) + Math.sin(t * 0.5) * 0.02
    if (ledger.current.g) ledger.current.g.position.y = lerp(-0.6, 0, seg(t, LEDGER_RISE[0], LEDGER_RISE[1], easeOut)) + Math.sin(t * 0.5 + 1.6) * 0.02
    if (ledgerDeck.current && ledger.current.g) { ledgerDeck.current.position.y = ledger.current.g.position.y; ledgerDeck.current.visible = ledger.current.g.position.y > -0.05 }

    // the pot: centre → onto the vault → out to the recipient at payout
    const potG = pot.current.g
    if (potG) {
      const toVault = seg(t, SPLIT[0] + 0.6, SPLIT[0] + 2.6)
      s.v.set(0, 0.2, 0).lerp(POT_ON_VAULT, toVault); s.v.y += toVault * (1 - toVault) * 1.2
      const out = seg(t, PAYOUT[0], PAYOUT[1])
      if (out > 0) { s.a.copy(s.arc[RECIPIENT]); s.a.lerp(VAULT, 0.22); s.a.y = 0.2; s.v.lerp(s.a, out); s.v.y += out * (1 - out) * 1.6 }
      potG.position.copy(s.v); potG.rotation.y = t * 0.12
      let k = flash(t, PAYOUT[1], 1.4)
      for (let i = 0; i < N; i++) k = Math.max(k, flash(t, payStart(i) + PAY_DUR, 0.8) * 0.5)
      const breath = 0.5 + Math.sin(t * 0.9) * 0.5
      if (pot.current.mat) pot.current.mat.emissiveIntensity = 0.2 + breath * 0.08 + k * 0.6
      if (pot.current.light) pot.current.light.intensity = 8 + breath * 2 + k * 20
      if (pot.current.inner) pot.current.inner.opacity = 0.18 + k * 0.3
    }

    // people slide from the circle to an arc round the vault
    for (let i = 0; i < N; i++) {
      const p = people.current[i]; if (!p?.g) continue
      s.v.copy(s.circle[i]).lerp(s.arc[i], split)
      p.g.position.copy(s.v)
      p.g.rotation.y = lerp(faceTo(s.circle[i].x, s.circle[i].z), faceTo(s.arc[i].x, s.arc[i].z, VAULT.x, VAULT.z), split)
      const e = i === RECIPIENT ? pulse(t, PAYOUT[1] - 0.4, 2.4) * 0.6 : 0
      p.body.emissive.copy(p.base).multiplyScalar(e)
    }
    if (recipientRing.current) recipientRing.current.opacity = 0.9 * seg(t, PAYOUT[1], PAYOUT[1] + 0.6)

    // coins: each member's coin lifts from their chest and arcs onto the vault
    for (let i = 0; i < N; i++) {
      const c = coins.current[i]; const g = c?.g; if (!g) continue
      const st = payStart(i)
      const p = seg(t, st, st + PAY_DUR)
      const appear = seg(t, st - 0.5, st, easeBack)
      if (t < st - 0.5 || p >= 1) { g.visible = false; continue }
      s.v.copy(s.arc[i]); s.v.y = 0.95; s.a.copy(POT_ON_VAULT); s.a.y = 0.4
      // start a little in front of the person, toward the vault
      s.v.lerp(VAULT, 0.16); s.v.y = 0.95
      s.v.lerp(s.a, p); s.v.y += Math.sin(p * Math.PI) * 0.9
      g.visible = true; g.position.copy(s.v); g.rotation.set(p * 4, 0, p * 2)
      g.scale.setScalar(Math.max(0.0001, appear * (1 - seg(t, st + PAY_DUR - 0.15, st + PAY_DUR))))
    }

    // proof packets: vault → 0x0FD2 → ledger, one per payment, plus the payout proof
    let proverFlash = 0, ledgerFlash = 0
    for (let i = 0; i <= N; i++) {
      const g = packets.current[i]; if (!g) continue
      const st = i < N ? proofStart(i) : PAYBACK[0]
      const p = seg(t, st, st + PROOF_DUR, smooth)
      if (t < st || p >= 1) { g.visible = false } else {
        s.path.getPointAt(p, s.v)
        g.visible = true; g.position.copy(s.v); g.rotation.y = t * 2 + i; g.scale.setScalar(0.6 + Math.sin(p * Math.PI) * 0.5)
      }
      proverFlash = Math.max(proverFlash, flash(t, st + PROOF_DUR * 0.5, 0.8))
      ledgerFlash = Math.max(ledgerFlash, flash(t, st + PROOF_DUR, 1.0))
    }
    (s.proofLineObj.material as THREE.LineBasicMaterial).opacity = 0.22 * seg(t, PROVER_IN[0], PROVER_IN[1] + 0.8)

    // nodes appear with a small overshoot, then hover and turn
    const pm = prover.current.mesh
    if (pm) { pm.scale.setScalar(Math.max(0.0001, seg(t, PROVER_IN[0], PROVER_IN[1], easeBack))); pm.rotation.y = t * 0.4; pm.position.y = PROVER[1] + Math.sin(t * 0.9) * 0.04 }
    if (prover.current.mat) prover.current.mat.emissiveIntensity = 0.5 + proverFlash * 1.1
    const cm = chain.current.mesh
    if (cm) { cm.scale.setScalar(Math.max(0.0001, seg(t, CHAIN_IN[0], CHAIN_IN[1], easeBack))); cm.rotation.y = -t * 0.3; cm.rotation.x = Math.sin(t * 0.4) * 0.2 }
    const dropK = seg(t, DROP[0], DROP[1], smooth)
    if (chain.current.mat) chain.current.mat.emissiveIntensity = 0.45 + flash(t, CLOCK[1], 1.0) * 0.9
    if (clockRing.current) { clockRing.current.lookAt(camera.position); clockRing.current.scale.setScalar(Math.max(0.0001, seg(t, CHAIN_IN[0] + 0.3, CHAIN_IN[1] + 0.4, easeOut))) }

    // the attested clock: 36 ticks light in order, then a single tick drops onto the ledger and closes the round
    const ct = clockTicks.current
    if (ct) {
      const lit = seg(t, CLOCK[0], CLOCK[1], (p) => p) * CLOCK_TICKS
      for (let i = 0; i < CLOCK_TICKS; i++) {
        const k = i < lit ? Math.min(1, lit - i) : 0
        ct.setColorAt(i, s.col.lerpColors(TICK_BASE, TICK_AMBER, k))
      }
      if (ct.instanceColor) ct.instanceColor.needsUpdate = true
    }
    if (drop.current) {
      if (t < DROP[0] || t > DROP[1]) drop.current.visible = false
      else { s.dropPath.getPointAt(dropK, s.v); drop.current.visible = true; drop.current.position.copy(s.v); drop.current.scale.setScalar(0.7 + Math.sin(dropK * Math.PI) * 0.4) }
    }

    // the ledger draws a tick per proven payment, glows amber as the round closes, and a mint bar once the payout is proven back
    const lt = ticks.current
    if (lt) {
      for (let i = 0; i < N; i++) {
        const k = seg(t, proofStart(i) + PROOF_DUR, proofStart(i) + PROOF_DUR + 0.35, easeOut)
        lt.setColorAt(i, s.col.lerpColors(TICK_BASE, TICK_MINT, k).lerp(s.white, flash(t, proofStart(i) + PROOF_DUR, 0.5) * 0.6))
      }
      if (lt.instanceColor) lt.instanceColor.needsUpdate = true
    }
    const closed = flash(t, DROP[1], 2.2)
    if (ledger.current.top) ledger.current.top.emissiveIntensity = 0.16 + ledgerFlash * 0.5 + closed * 0.3
    if (ledger.current.rim) ledger.current.rim.color.copy(s.rimMint).lerp(s.rimAmber, Math.min(1, closed * 1.5))
    if (paidBar.current) paidBar.current.opacity = 0.95 * seg(t, PAYBACK[1], PAYBACK[1] + 0.5, easeOut)
    let landed = 0
    for (let i = 0; i < N; i++) landed = Math.max(landed, flash(t, payStart(i) + PAY_DUR, 0.7))
    if (vault.current.top) vault.current.top.emissiveIntensity = 0.1 + landed * 0.5 + flash(t, PAYOUT[0], 1.0) * 0.4
    if (vault.current.rim) vault.current.rim.color.copy(s.rimSky).lerp(s.white, landed * 0.5)
  })

  const recipientRingPos = s.arc[RECIPIENT].clone().lerp(VAULT, 0.22)
  return (
    <>
      <fog attach="fog" args={[BG, 8, 22]} />
      <Lights keyPos={[3, 8, 5]} bounds={8} />
      <Floor />

      {/* the seam the circle splits along */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <planeGeometry args={[0.03, 9]} />
        <meshBasicMaterial ref={seam} color={MINT} transparent opacity={0} depthWrite={false} />
      </mesh>

      {HUES.map((hue, i) => <Person key={i} hue={hue} set={(h) => { people.current[i] = h }} position={[0, 0, 0]} />)}
      {HUES.map((hue, i) => <Coin key={i} hue={hue} set={(h) => { coins.current[i] = h }} />)}
      <Pot h={pot} />

      <Slab h={vault} glass rimColor="#5E8FB8" tint={SKY} position={[VAULT.x, -0.6, 0]} />
      <Slab h={ledger} rimColor={MINT} tint={MINT} position={[LEDGER.x, -0.6, 0]} />
      {/* ledger tick slots + the payout bar */}
      <group ref={ledgerDeck} position={[LEDGER.x, -0.6, 0]}>
        <instancedMesh ref={ticks} args={[undefined, undefined, N]}>
          <boxGeometry args={[0.14, 0.02, 0.4]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.118, -0.42]}>
          <planeGeometry args={[2.24, 0.12]} />
          <meshBasicMaterial ref={paidBar} color={MINT} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      <Node h={prover} kind="octa" color={SKY} tint="#1A2A3A" position={PROVER} />
      <Node h={chain} kind="ico" color={AMBER} tint="#33291A" position={CHAIN} />
      <group ref={clockRing} position={CHAIN}>
        <instancedMesh ref={clockTicks} args={[undefined, undefined, CLOCK_TICKS]}>
          <boxGeometry args={[0.028, 0.09, 0.02]} />
          <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
      </group>
      <group ref={drop} visible={false}>
        <mesh><sphereGeometry args={[0.07, 10, 8]} /><meshBasicMaterial color="#F3DFB3" /></mesh>
        <mesh geometry={GEO.halo}><meshBasicMaterial color={AMBER} transparent opacity={0.26} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      </group>

      <primitive object={s.proofLineObj} />
      {Array.from({ length: N + 1 }, (_, i) => <Packet key={i} set={(g) => { packets.current[i] = g }} core={i === N ? '#F3DFB3' : '#C8F5E3'} />)}

      <mesh geometry={GEO.ring} position={[recipientRingPos.x, 0.012, recipientRingPos.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial ref={recipientRing} color={MINT} transparent opacity={0} depthWrite={false} />
      </mesh>

      <Label position={[VAULT.x, -0.35, 1.1]} tone="sky" at={5.4}><b>Ethereum</b> · KittyVault</Label>
      <Label position={[LEDGER.x, -0.35, 1.1]} tone="mint" at={9.6}><b>Creditcoin</b> · KittyLedger</Label>
      <Label position={[PROVER[0], PROVER[1] - 0.6, PROVER[2] + 0.1]} tone="sky" at={PROVER_IN[1]}>0x0FD2 · block prover</Label>
      <Label position={[CHAIN[0], CHAIN[1] + 0.95, CHAIN[2]]} tone="amber" at={CHAIN_IN[1]}>0x0FD3 · attestation</Label>
      <Label position={[LEDGER.x, 0.7, 0.9]} tone="amber" at={DROP[1] + 0.2} until={PAYBACK[1] + 0.2}>round closed · deadline attested</Label>
      <Label position={[LEDGER.x, 0.7, 0.9]} tone="mint" at={PAYBACK[1] + 0.4}>payout proven back</Label>

      <Sparkles count={26} scale={[10, 2.4, 6]} position={[0, 1.4, 0]} size={2} speed={0.16} opacity={0.26} color="#7BE3BE" noise={0.6} />
    </>
  )
}
