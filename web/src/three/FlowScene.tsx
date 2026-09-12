import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { usePointer } from './pointer'

/**
 * How a payment becomes a rule: the vault slab on Ethereum, the ledger slab on Creditcoin, and the two precompiles between them.
 * Proof packets glide vault → 0x0FD2 → ledger; a slower attestation tick drops from 0x0FD3 onto the ledger.
 * All motion is ref-driven; curves are sampled into preallocated vectors.
 */

const BG = '#0B100E'
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

const PACKETS = 5
const PACKET_EVERY = 2.3
const PACKET_DUR = 3.4
const TICK_EVERY = 6.5
const TICK_DUR = 2.6

const smooth = (p: number) => p * p * (3 - 2 * p)

type Mover = { active: boolean; t: number }

type SlabProps = {
  group: React.RefObject<THREE.Group | null>; topRef: React.RefObject<THREE.MeshStandardMaterial | null>; edge?: React.RefObject<THREE.LineBasicMaterial | null>
  at: THREE.Vector3; top: string; tint: string; edgeColor: string; geo: THREE.BoxGeometry; edges: THREE.EdgesGeometry
}
function Slab({ group, topRef, edge, at, top, tint, edgeColor, geo, edges }: SlabProps) {
  return (
    <group ref={group} position={at}>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#121B16" roughness={0.6} metalness={0.15} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial ref={edge} color={edgeColor} transparent opacity={0.9} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.085, 0]}>
        <planeGeometry args={[2.6, 1.5]} />
        <meshStandardMaterial ref={topRef} color={top} emissive={tint} emissiveIntensity={0.16} roughness={0.75} metalness={0.05} />
      </mesh>
    </group>
  )
}

export default function FlowScene() {
  const pointer = usePointer()
  const camera = useThree((s) => s.camera)

  const vault = useRef<THREE.Group>(null)
  const ledger = useRef<THREE.Group>(null)
  const prover = useRef<THREE.Mesh>(null)
  const chain = useRef<THREE.Mesh>(null)
  const proverMat = useRef<THREE.MeshStandardMaterial>(null)
  const chainMat = useRef<THREE.MeshStandardMaterial>(null)
  const ledgerTop = useRef<THREE.MeshStandardMaterial>(null)
  const ledgerEdge = useRef<THREE.LineBasicMaterial>(null)
  const vaultTop = useRef<THREE.MeshStandardMaterial>(null)
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
    t: 0, nextPacket: 0.8, nextTick: 2.5, proverFlash: 0, chainFlash: 0, ledgerFlash: 0, ledgerAmber: 0,
    packets: Array.from({ length: PACKETS }, (): Mover => ({ active: false, t: 0 })),
    tick: { active: false, t: 0 } as Mover,
    v: new THREE.Vector3(), camBase: new THREE.Vector3(...FLOW_CAMERA), camTarget: new THREE.Vector3(),
    edgeMint: new THREE.Color(MINT), edgeAmber: new THREE.Color(AMBER), edgeTmp: new THREE.Color(),
  })

  const packetGeo = useMemo(() => new THREE.OctahedronGeometry(0.09, 0), [])
  const haloGeo = useMemo(() => new THREE.SphereGeometry(0.19, 10, 8), [])
  const slabGeo = useMemo(() => new THREE.BoxGeometry(3, 0.16, 1.9), [])
  const slabEdges = useMemo(() => new THREE.EdgesGeometry(slabGeo), [slabGeo])

  useFrame((_, delta) => {
    const s = sim.current
    const dt = Math.min(delta, 0.05)
    s.t += dt

    // slabs float; nodes hover and turn
    if (vault.current) { vault.current.position.y = Math.sin(s.t * 0.5) * 0.05; vault.current.rotation.z = Math.sin(s.t * 0.3) * 0.015 }
    if (ledger.current) { ledger.current.position.y = Math.sin(s.t * 0.5 + 1.6) * 0.05; ledger.current.rotation.z = Math.sin(s.t * 0.3 + 1.2) * 0.015 }
    if (prover.current) { prover.current.rotation.y += dt * 0.35; prover.current.position.y = PROVER.y + Math.sin(s.t * 0.9) * 0.04 }
    if (chain.current) { chain.current.rotation.y -= dt * 0.25; chain.current.rotation.x = Math.sin(s.t * 0.4) * 0.2; chain.current.position.y = CHAIN.y + Math.sin(s.t * 0.7 + 2) * 0.05 }
    if (world.current) world.current.rotation.y = Math.sin(s.t * 0.09) * 0.05

    // spawn
    if (s.t >= s.nextPacket) { const p = s.packets.find((x) => !x.active); if (p) { p.active = true; p.t = 0 } s.nextPacket = s.t + PACKET_EVERY }
    if (s.t >= s.nextTick && !s.tick.active) { s.tick.active = true; s.tick.t = 0; s.chainFlash = 1; s.nextTick = s.t + TICK_EVERY }

    // packets
    for (let i = 0; i < PACKETS; i++) {
      const p = s.packets[i]; const g = packets.current[i]; if (!g) continue
      if (!p.active) { g.visible = false; continue }
      const before = p.t
      p.t += dt / PACKET_DUR
      if (before < 0.5 && p.t >= 0.5) s.proverFlash = 1
      if (p.t >= 1) { p.active = false; g.visible = false; s.ledgerFlash = 1; continue }
      proofPath.getPointAt(smooth(p.t), s.v)
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
    if (proverMat.current) proverMat.current.emissiveIntensity = 0.55 + s.proverFlash * 1.0
    if (chainMat.current) chainMat.current.emissiveIntensity = 0.45 + s.chainFlash * 0.9
    if (ledgerTop.current) ledgerTop.current.emissiveIntensity = 0.16 + s.ledgerFlash * 0.5 + Math.sin(s.t * 0.8) * 0.03
    if (vaultTop.current) vaultTop.current.emissiveIntensity = 0.06 + Math.sin(s.t * 0.8 + 1) * 0.02
    if (ledgerEdge.current) ledgerEdge.current.color.copy(s.edgeTmp.lerpColors(s.edgeMint, s.edgeAmber, Math.min(1, s.ledgerAmber)))

    // camera drift + parallax
    const pt = pointer.current
    s.camTarget.set(s.camBase.x + Math.sin(s.t * 0.1) * 0.25 + pt.x * 0.5, s.camBase.y + Math.sin(s.t * 0.07) * 0.1 + pt.y * 0.25, s.camBase.z)
    camera.position.lerp(s.camTarget, 1 - Math.exp(-dt * 2.2))
    camera.lookAt(0, 0.5, 0)
  })

  return (
    <>
      <fog attach="fog" args={[BG, 7, 15]} />
      <hemisphereLight args={['#d7e4dd', '#1a2420', 0.7]} />
      <directionalLight position={[3, 6, 4]} intensity={1.7} color="#eef5f1" />
      <directionalLight position={[-6, 3, -3]} intensity={0.8} color={SKY} />
      <pointLight position={[0, 1.6, 0.6]} color={MINT} intensity={5} distance={7} decay={2} />

      <group ref={world}>
        <primitive object={proofLine} />
        <primitive object={tickLine} />

        <Slab group={vault} at={VAULT} top="#0F1713" tint="#8E9F96" edgeColor="#5E6E66" topRef={vaultTop} geo={slabGeo} edges={slabEdges} />
        <Slab group={ledger} at={LEDGER} top="#14302A" tint={MINT} edgeColor={MINT} edge={ledgerEdge} topRef={ledgerTop} geo={slabGeo} edges={slabEdges} />

        {/* 0x0FD2 block prover */}
        <mesh ref={prover} position={PROVER}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial ref={proverMat} color="#1A2A3A" emissive={SKY} emissiveIntensity={0.55} roughness={0.35} metalness={0.3} flatShading />
        </mesh>
        {/* 0x0FD3 ChainInfo */}
        <mesh ref={chain} position={CHAIN}>
          <icosahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial ref={chainMat} color="#33291A" emissive={AMBER} emissiveIntensity={0.45} roughness={0.4} metalness={0.3} flatShading />
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
