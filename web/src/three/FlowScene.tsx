import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { FeedItem } from '../hooks'
import { usePointer } from './pointer'

/**
 * How a payment becomes a rule: the vault slab on Ethereum, the ledger slab on Creditcoin, and the two precompiles between them.
 * Driven by the chain, not a loop: each ContributionRecorded becomes a proof packet vault → 0x0FD2 → ledger (a batch leaves
 * together), and the amber tick drops from 0x0FD3 onto the ledger only when the attested height moves.
 * All motion is ref-driven; curves are sampled into preallocated vectors.
 */

const BG = '#0E1512' // matches --bg-2, the stage's panel colour, so the fogged floor has no horizon
const MINT = '#4FD1A3'
const SKY = '#7DB6E8'
const AMBER = '#E2B15C'
const FLOW_CAMERA: [number, number, number] = [0, 3.2, 8.0] // keep in sync with Architecture.tsx

const VAULT = new THREE.Vector3(-3.3, 0, 0)
const LEDGER = new THREE.Vector3(3.3, 0, 0)
const VAULT_TOP = new THREE.Vector3(-3.3, 0.22, 0)
const LEDGER_TOP = new THREE.Vector3(3.3, 0.22, 0)
const PROVER = new THREE.Vector3(0, 0.6, 0.5)
const CHAIN = new THREE.Vector3(0.7, 1.25, -1.2)

const PACKETS = 10
const PACKET_DUR = 3.4
const TICK_DUR = 2.6
const REPLAY = 3

const smooth = (p: number) => p * p * (3 - 2 * p)

type Mover = { active: boolean; t: number; lane: number }

type SlabProps = {
  group: React.RefObject<THREE.Group | null>; topRef: React.RefObject<THREE.MeshPhysicalMaterial | null>; rim?: React.RefObject<THREE.MeshBasicMaterial | null>
  at: THREE.Vector3; top: string; tint: string; rimColor: string; geo: THREE.BoxGeometry; rimGeo: THREE.BoxGeometry
}
/** A slab: graphite body, a thin emissive lip in place of the old aliased line outline, a lacquered top face. */
function Slab({ group, topRef, rim, at, top, tint, rimColor, geo, rimGeo }: SlabProps) {
  return (
    <group ref={group} position={at}>
      <mesh geometry={geo}>
        <meshPhysicalMaterial color="#121B16" roughness={0.55} metalness={0.25} clearcoat={0.3} clearcoatRoughness={0.4} />
      </mesh>
      <mesh geometry={rimGeo} position={[0, 0.08, 0]}>
        <meshBasicMaterial ref={rim} color={rimColor} />
      </mesh>
      {/* body-coloured cover over the rim box, so only its 0.02 lip shows around the edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.092, 0]}>
        <planeGeometry args={[3, 1.9]} />
        <meshPhysicalMaterial color="#121B16" roughness={0.55} metalness={0.25} clearcoat={0.3} clearcoatRoughness={0.4} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.097, 0]}>
        <planeGeometry args={[2.6, 1.5]} />
        <meshPhysicalMaterial ref={topRef} color={top} emissive={tint} emissiveIntensity={0.16} clearcoat={1} clearcoatRoughness={0.15} roughness={0.32} metalness={0.25} />
      </mesh>
    </group>
  )
}

export type FlowProps = { attested?: bigint; items: FeedItem[]; proven: number }

export default function FlowScene({ attested, items, proven }: FlowProps) {
  const pointer = usePointer()
  const camera = useThree((s) => s.camera)

  const vault = useRef<THREE.Group>(null)
  const ledger = useRef<THREE.Group>(null)
  const prover = useRef<THREE.Mesh>(null)
  const chain = useRef<THREE.Mesh>(null)
  const proverMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const chainMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const ledgerTop = useRef<THREE.MeshPhysicalMaterial>(null)
  const ledgerRim = useRef<THREE.MeshBasicMaterial>(null)
  const vaultTop = useRef<THREE.MeshPhysicalMaterial>(null)
  const packets = useRef<(THREE.Group | null)[]>([])
  const tick = useRef<THREE.Group>(null)
  const world = useRef<THREE.Group>(null)

  const { proofPath, tickPath, proofLine, tickLine } = useMemo(() => {
    const proofPath = new THREE.CatmullRomCurve3([
      VAULT_TOP.clone(), new THREE.Vector3(-1.7, 0.8, 0.3), PROVER.clone(), new THREE.Vector3(1.7, 0.8, 0.3), LEDGER_TOP.clone(),
    ], false, 'centripetal', 0.6)
    const tickPath = new THREE.CatmullRomCurve3([CHAIN.clone(), new THREE.Vector3(2.1, 1.1, -0.7), LEDGER_TOP.clone()], false, 'centripetal', 0.6)
    const mk = (curve: THREE.Curve<THREE.Vector3>, color: string, opacity: number) =>
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
    return { proofPath, tickPath, proofLine: mk(proofPath, MINT, 0.22), tickLine: mk(tickPath, AMBER, 0.2) }
  }, [])

  const sim = useRef({
    t: 0, proverFlash: 0, chainFlash: 0, ledgerFlash: 0, ledgerAmber: 0, primed: false, lastAttested: undefined as bigint | undefined,
    seen: new Set<string>(),
    queue: [] as { at: number; lane: number }[],
    packets: Array.from({ length: PACKETS }, (): Mover => ({ active: false, t: 0, lane: 0 })),
    tick: { active: false, t: 0, lane: 0 } as Mover,
    v: new THREE.Vector3(), camBase: new THREE.Vector3(...FLOW_CAMERA), camTarget: new THREE.Vector3(),
    rimMint: new THREE.Color(MINT), rimAmber: new THREE.Color(AMBER), rimTmp: new THREE.Color(),
  })

  // Proven payments → packets. Grouped by transaction so a batch proof leaves the vault as one flight, fanned across lanes.
  // First mount replays the last few so the mechanic is visible; afterwards only new events fire.
  useEffect(() => {
    const s = sim.current
    const fresh = items.filter((i) => {
      if (i.kind !== 'ContributionRecorded') return false
      const k = `${i.tx}:${String(i.args.member ?? '')}:${String(i.args.round ?? '')}`
      if (s.seen.has(k)) return false
      s.seen.add(k); return true
    })
    const play = (s.primed ? fresh : fresh.slice(0, REPLAY)).slice().reverse()
    s.primed = true
    let delay = 0.8
    for (let i = 0; i < play.length;) {
      const tx = play[i].tx
      let lane = 0
      while (i < play.length && play[i].tx === tx) { s.queue.push({ at: s.t + delay, lane: lane++ }); i++ }
      delay += 2.4
    }
  }, [items])

  // The attested frontier moving is the only trigger for the amber tick (the first reading counts: it is a real attestation too).
  useEffect(() => {
    const s = sim.current
    if (attested !== undefined && (s.lastAttested === undefined || attested > s.lastAttested)) { s.tick.active = true; s.tick.t = 0; s.chainFlash = 1 }
    s.lastAttested = attested
  }, [attested])

  const packetGeo = useMemo(() => new THREE.OctahedronGeometry(0.09, 0), [])
  const haloGeo = useMemo(() => new THREE.SphereGeometry(0.19, 10, 8), [])
  const slabGeo = useMemo(() => new THREE.BoxGeometry(3, 0.16, 1.9), [])
  const rimGeo = useMemo(() => new THREE.BoxGeometry(3.04, 0.02, 1.94), [])

  useFrame((_, delta) => {
    const s = sim.current
    const dt = Math.min(delta, 0.05)
    s.t += dt

    // slabs float; nodes hover and turn
    if (vault.current) { vault.current.position.y = Math.sin(s.t * 0.5) * 0.04; vault.current.rotation.z = Math.sin(s.t * 0.3) * 0.012 }
    if (ledger.current) { ledger.current.position.y = Math.sin(s.t * 0.5 + 1.6) * 0.04; ledger.current.rotation.z = Math.sin(s.t * 0.3 + 1.2) * 0.012 }
    if (prover.current) { prover.current.rotation.y += dt * 0.35; prover.current.position.y = PROVER.y + Math.sin(s.t * 0.9) * 0.04 }
    if (chain.current) { chain.current.rotation.y -= dt * 0.25; chain.current.rotation.x = Math.sin(s.t * 0.4) * 0.2; chain.current.position.y = CHAIN.y + Math.sin(s.t * 0.7 + 2) * 0.05 }
    if (world.current) world.current.rotation.y = Math.sin(s.t * 0.09) * 0.05

    // queued events → packets
    while (s.queue.length && s.queue[0].at <= s.t) {
      const q = s.queue.shift()!
      const p = s.packets.find((x) => !x.active); if (p) { p.active = true; p.t = 0; p.lane = q.lane }
    }

    // packets
    for (let i = 0; i < PACKETS; i++) {
      const p = s.packets[i]; const g = packets.current[i]; if (!g) continue
      if (!p.active) { g.visible = false; continue }
      const before = p.t
      p.t += dt / PACKET_DUR
      if (before < 0.5 && p.t >= 0.5) s.proverFlash = 1
      if (p.t >= 1) { p.active = false; g.visible = false; s.ledgerFlash = 1; continue }
      proofPath.getPointAt(smooth(p.t), s.v)
      // lanes fan a batch out sideways mid-flight and converge again at both slabs
      const fan = Math.sin(p.t * Math.PI) * ((p.lane % 3) - 1) * 0.22
      s.v.z += fan; s.v.y += Math.floor(p.lane / 3) * 0.12 * Math.sin(p.t * Math.PI)
      g.visible = true; g.position.copy(s.v)
      g.rotation.y += dt * 2
      g.scale.setScalar(0.6 + Math.sin(p.t * Math.PI) * 0.5)
    }
    // attestation tick
    if (tick.current) {
      const k = s.tick
      if (!k.active) tick.current.visible = false
      else {
        k.t += dt / TICK_DUR
        if (k.t >= 1) { k.active = false; tick.current.visible = false; s.ledgerAmber = 1 }
        else { tickPath.getPointAt(smooth(k.t), s.v); tick.current.visible = true; tick.current.position.copy(s.v); tick.current.scale.setScalar(0.7 + Math.sin(k.t * Math.PI) * 0.4) }
      }
    }

    // flashes decay
    s.proverFlash = Math.max(0, s.proverFlash - dt / 0.9)
    s.chainFlash = Math.max(0, s.chainFlash - dt / 1.1)
    s.ledgerFlash = Math.max(0, s.ledgerFlash - dt / 1.2)
    s.ledgerAmber = Math.max(0, s.ledgerAmber - dt / 1.6)
    if (proverMat.current) proverMat.current.emissiveIntensity = 0.5 + s.proverFlash * 1.0
    if (chainMat.current) chainMat.current.emissiveIntensity = 0.4 + s.chainFlash * 0.9
    if (ledgerTop.current) ledgerTop.current.emissiveIntensity = 0.16 + s.ledgerFlash * 0.5 + Math.sin(s.t * 0.8) * 0.03
    if (vaultTop.current) vaultTop.current.emissiveIntensity = 0.06 + Math.sin(s.t * 0.8 + 1) * 0.02
    if (ledgerRim.current) ledgerRim.current.color.copy(s.rimTmp.lerpColors(s.rimMint, s.rimAmber, Math.min(1, s.ledgerAmber)))

    // camera drift + parallax
    const pt = pointer.current
    s.camTarget.set(s.camBase.x + Math.sin(s.t * 0.1) * 0.25 + pt.x * 0.5, s.camBase.y + Math.sin(s.t * 0.07) * 0.1 + pt.y * 0.25, s.camBase.z)
    camera.position.lerp(s.camTarget, 1 - Math.exp(-dt * 2.2))
    camera.lookAt(0, 0.5, 0)
  })

  return (
    <>
      <fog attach="fog" args={[BG, 7, 15]} />
      <hemisphereLight args={['#d7e4dd', '#1a2420', 0.4]} />
      <directionalLight position={[3, 6, 4]} intensity={1.5} color="#eef5f1" />
      <directionalLight position={[-6, 3, -3]} intensity={0.6} color={SKY} />
      <pointLight position={[0, 1.6, 0.6]} color={MINT} intensity={5} distance={7} decay={2} />

      <group ref={world}>
        {/* grounding: one baked contact shadow under the slabs and nodes */}
        <ContactShadows frames={1} resolution={512} opacity={0.6} blur={2.2} scale={[9.5, 5]} far={2.6} position={[0, -0.1, 0]} color="#000000" />
        {/* a floor for the shadow to land on: graphite, faintly lit by the room environment, fading into the fog */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]}>
          <planeGeometry args={[60, 60]} />
          <meshPhysicalMaterial color="#141C18" roughness={0.62} metalness={0.2} clearcoat={0.2} clearcoatRoughness={0.6} />
        </mesh>

        <primitive object={proofLine} />
        <primitive object={tickLine} />

        <Slab group={vault} at={VAULT} top="#0F1713" tint="#8E9F96" rimColor="#4A5A52" topRef={vaultTop} geo={slabGeo} rimGeo={rimGeo} />
        <Slab group={ledger} at={LEDGER} top="#14302A" tint={MINT} rimColor={MINT} rim={ledgerRim} topRef={ledgerTop} geo={slabGeo} rimGeo={rimGeo} />

        {/* 0x0FD2 block prover */}
        <mesh ref={prover} position={PROVER}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshPhysicalMaterial ref={proverMat} color="#1A2A3A" emissive={SKY} emissiveIntensity={0.5} roughness={0.32} metalness={0.4} envMapIntensity={0.35} clearcoat={1} clearcoatRoughness={0.1} flatShading />
        </mesh>
        {/* 0x0FD3 ChainInfo */}
        <mesh ref={chain} position={CHAIN}>
          <icosahedronGeometry args={[0.2, 0]} />
          <meshPhysicalMaterial ref={chainMat} color="#33291A" emissive={AMBER} emissiveIntensity={0.4} roughness={0.32} metalness={0.4} envMapIntensity={0.35} clearcoat={1} clearcoatRoughness={0.1} flatShading />
        </mesh>

        {/* proof packets */}
        {Array.from({ length: PACKETS }, (_, i) => (
          <group key={i} ref={(el) => { packets.current[i] = el }} visible={false}>
            <mesh geometry={packetGeo}><meshBasicMaterial color="#C8F5E3" /></mesh>
            <mesh geometry={haloGeo}><meshBasicMaterial color={MINT} transparent opacity={0.26} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
          </group>
        ))}
        {/* attestation tick */}
        <group ref={tick} visible={false}>
          <mesh><sphereGeometry args={[0.07, 10, 8]} /><meshBasicMaterial color="#F3DFB3" /></mesh>
          <mesh geometry={haloGeo}><meshBasicMaterial color={AMBER} transparent opacity={0.24} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>

        {/* labels */}
        <Html position={[VAULT.x, -0.4, 1.05]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label"><b>Ethereum</b> · KittyVault</span>
        </Html>
        <Html position={[LEDGER.x, -0.4, 1.05]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label mint"><b>Creditcoin</b> · KittyLedger</span>
        </Html>
        <Html position={[LEDGER.x + 0.95, 0.22, 0.5]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label mint"><b>{proven}</b> proven</span>
        </Html>
        <Html position={[PROVER.x, PROVER.y - 0.62, PROVER.z + 0.1]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label sky">0x0FD2 · block prover</span>
        </Html>
        <Html position={[CHAIN.x, CHAIN.y + 0.55, CHAIN.z]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="t3-label amber">0x0FD3 · ChainInfo</span>
        </Html>
      </group>
    </>
  )
}
