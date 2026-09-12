import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { chapter, clock, easeIn, easeOut, seg } from '../timeline'

/** Shared vocabulary of the three chapters: the cast (people, coins, pot, packets, slabs), lights, labels and the caption overlay. */

export const BG = '#0B100E'
export const MINT = '#4FD1A3'
export const MINT_2 = '#7BE3BE'
export const SKY = '#7DB6E8'
export const AMBER = '#E2B15C'
export const ROSE = '#F08A97'
export const GRAPHITE = '#2A3630'
export const TWO_PI = Math.PI * 2

/** Eight member hues, spaced the way Blockie spaces them (hue = seed mod 360), so the cast reads like the site's identicons. */
export const HUES = [160, 210, 42, 348, 268, 96, 18, 300]
export const memberColor = (hue: number, l = 0.5) => new THREE.Color().setHSL(hue / 360, 0.42, l)

/* ── geometry singletons: built once per module, shared by every instance ── */
export const GEO = {
  body: new THREE.CapsuleGeometry(0.2, 0.56, 4, 14),
  head: new THREE.SphereGeometry(0.17, 16, 12),
  visor: new THREE.BoxGeometry(0.15, 0.05, 0.06),
  coin: new THREE.CylinderGeometry(0.17, 0.17, 0.05, 32, 1),
  packet: new THREE.OctahedronGeometry(0.1, 0),
  halo: new THREE.SphereGeometry(0.2, 10, 8),
  spark: new THREE.SphereGeometry(0.06, 10, 8),
  ring: new THREE.TorusGeometry(0.42, 0.012, 6, 48),
}

/* ── renderer setup: shadow maps on, before the first frame compiles any program ── */
export function Shadows() {
  const gl = useThree((s) => s.gl)
  useLayoutEffect(() => { gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFShadowMap }, [gl])
  return null
}

/** Key light from front-right (casts the one shadow map), a cool rim from behind, and a low hemisphere fill. */
export function Lights({ keyPos = [4, 7, 4] as [number, number, number], bounds = 7 }: { keyPos?: [number, number, number]; bounds?: number }) {
  return (
    <>
      <hemisphereLight args={['#cfe0d6', '#121a16', 0.42]} />
      <directionalLight position={keyPos} intensity={1.7} color="#f1f6f2" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0006} shadow-normalBias={0.02}
        shadow-camera-left={-bounds} shadow-camera-right={bounds} shadow-camera-top={bounds} shadow-camera-bottom={-bounds} shadow-camera-near={1} shadow-camera-far={24} />
      <directionalLight position={[-6, 3.5, -5]} intensity={0.75} color={SKY} />
    </>
  )
}

export function Floor({ y = 0, size = 80 }: { y?: number; size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#131B17" roughness={0.68} metalness={0.18} />
    </mesh>
  )
}

/* ── people: capsule + head + a dark visor that says which way they face ── */
export type PersonH = { g: THREE.Group | null; body: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; base: THREE.Color; headBase: THREE.Color }
export function Person({ hue, set, position, facing = 0 }: { hue: number; set: (h: PersonH) => void; position: [number, number, number]; facing?: number }) {
  const m = useMemo(() => {
    const base = memberColor(hue, 0.5), headBase = memberColor(hue, 0.62)
    return {
      base, headBase,
      body: new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.55, metalness: 0.12 }),
      head: new THREE.MeshStandardMaterial({ color: headBase.clone(), roughness: 0.62, metalness: 0.08 }),
    }
  }, [hue])
  return (
    <group ref={(g) => { set({ g, ...m }) }} position={position} rotation={[0, facing, 0]}>
      <mesh geometry={GEO.body} material={m.body} position={[0, 0.48, 0]} castShadow />
      <mesh geometry={GEO.head} material={m.head} position={[0, 1.15, 0]} castShadow />
      <mesh geometry={GEO.visor} position={[0, 1.17, 0.15]}><meshStandardMaterial color="#0C1210" roughness={0.3} metalness={0.4} /></mesh>
    </group>
  )
}
/** Angle so a person at (x, z) looks at (cx, cz). */
export const faceTo = (x: number, z: number, cx = 0, cz = 0) => Math.atan2(cx - x, cz - z)

/* ── coins: a hue-tinted disc with a lighter face ── */
export type CoinH = { g: THREE.Group | null; edge: THREE.MeshStandardMaterial }
export function Coin({ hue, set }: { hue: number; set: (h: CoinH) => void }) {
  const mats = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: memberColor(hue, 0.46), metalness: 0.75, roughness: 0.32 })
    const face = new THREE.MeshStandardMaterial({ color: memberColor(hue, 0.6), emissive: memberColor(hue, 0.4), emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.38 })
    return { edge, arr: [edge, face, face] as THREE.Material[] }
  }, [hue])
  return (
    <group ref={(g) => { set({ g, edge: mats.edge }) }}>
      <mesh geometry={GEO.coin} material={mats.arr} castShadow />
    </group>
  )
}

/* ── the pot: lacquered mint torus over a dark dish, with its own light ── */
export type PotH = { g: THREE.Group | null; mat: THREE.MeshPhysicalMaterial | null; light: THREE.PointLight | null; inner: THREE.MeshBasicMaterial | null }
export function Pot({ h, scale = 1 }: { h: RefObject<PotH>; scale?: number }) {
  const hh = h.current
  return (
    <group ref={(g) => { hh.g = g }} scale={scale}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.62, 0.13, 16, 48]} />
        <meshPhysicalMaterial ref={(m) => { hh.mat = m }} color="#1B4A3D" emissive={MINT} emissiveIntensity={0.22} clearcoat={1} clearcoatRoughness={0.15} roughness={0.28} metalness={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <circleGeometry args={[0.55, 40]} />
        <meshPhysicalMaterial color="#0F1713" emissive={MINT} emissiveIntensity={0.12} clearcoat={0.6} clearcoatRoughness={0.3} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
        <ringGeometry args={[0.34, 0.38, 40]} />
        <meshBasicMaterial ref={(m) => { hh.inner = m }} color={MINT_2} transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={(l) => { hh.light = l }} position={[0, 0.35, 0]} color={MINT} intensity={9} distance={6} decay={2} />
    </group>
  )
}
export const potHandle = (): PotH => ({ g: null, mat: null, light: null, inner: null })

/* ── proof packets: a bright octahedron in an additive halo ── */
export function Packet({ set, color = MINT, core = '#C8F5E3' }: { set: (g: THREE.Group | null) => void; color?: string; core?: string }) {
  return (
    <group ref={set} visible={false}>
      <mesh geometry={GEO.packet}><meshBasicMaterial color={core} /></mesh>
      <mesh geometry={GEO.halo}><meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
    </group>
  )
}

/* ── precompile nodes ── */
export type NodeH = { mesh: THREE.Mesh | null; mat: THREE.MeshPhysicalMaterial | null }
export function Node({ h, kind, color, tint, position }: { h: RefObject<NodeH>; kind: 'octa' | 'ico'; color: string; tint: string; position: [number, number, number] }) {
  return (
    <mesh ref={(m) => { h.current.mesh = m }} position={position} scale={0.0001}>
      {kind === 'octa' ? <octahedronGeometry args={[0.28, 0]} /> : <icosahedronGeometry args={[0.22, 0]} />}
      <meshPhysicalMaterial ref={(m) => { h.current.mat = m }} color={tint} emissive={color} emissiveIntensity={0.5} roughness={0.32} metalness={0.4} envMapIntensity={0.35} clearcoat={1} clearcoatRoughness={0.1} flatShading />
    </mesh>
  )
}

/* ── slabs: the vault (glass, sky) and the ledger (lacquer, mint) ── */
export type SlabH = { g: THREE.Group | null; rim: THREE.MeshBasicMaterial | null; top: THREE.MeshPhysicalMaterial | null }
const SLAB_GEO = new THREE.BoxGeometry(3, 0.18, 1.9)
const RIM_GEO = new THREE.BoxGeometry(3.04, 0.024, 1.94)
export function Slab({ h, glass, rimColor, tint, position }: { h: RefObject<SlabH>; glass?: boolean; rimColor: string; tint: string; position: [number, number, number] }) {
  const hh = h.current
  return (
    <group ref={(g) => { hh.g = g }} position={position}>
      <mesh geometry={SLAB_GEO} castShadow receiveShadow>
        {glass
          ? <meshPhysicalMaterial color="#8FB6D6" roughness={0.12} metalness={0.05} clearcoat={1} clearcoatRoughness={0.08} transparent opacity={0.5} envMapIntensity={0.9} />
          : <meshPhysicalMaterial color="#121B16" roughness={0.55} metalness={0.25} clearcoat={0.3} clearcoatRoughness={0.4} />}
      </mesh>
      <mesh geometry={RIM_GEO} position={[0, 0.09, 0]}>
        <meshBasicMaterial ref={(m) => { hh.rim = m }} color={rimColor} transparent opacity={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.104, 0]}>
        <planeGeometry args={[2.6, 1.5]} />
        <meshPhysicalMaterial ref={(m) => { hh.top = m }} color={glass ? '#1A2C3A' : '#14302A'} emissive={tint} emissiveIntensity={0.16} clearcoat={1} clearcoatRoughness={0.15} roughness={0.32} metalness={0.25} />
      </mesh>
    </group>
  )
}
export const slabHandle = (): SlabH => ({ g: null, rim: null, top: null })

/* ── a floating label in the site's eyebrow voice, visible over a window of the chapter clock ── */
export function Label({ position, tone = '', at = 0, until = 1e9, children }: { position: [number, number, number]; tone?: '' | 'mint' | 'sky' | 'amber' | 'rose'; at?: number; until?: number; children: ReactNode }) {
  const span = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const el = span.current; if (!el) return
    const t = clock.t
    const a = seg(t, at, at + 0.5, easeOut) * (1 - seg(t, until - 0.4, until, easeIn))
    el.style.opacity = a.toFixed(3)
    el.style.transform = `translateY(${((1 - a) * 6).toFixed(1)}px)`
  })
  return (
    <Html position={position} center zIndexRange={[10, 2]} style={{ pointerEvents: 'none' }}>
      <span ref={span} className={`t3-label story-label ${tone}`} style={{ opacity: 0 }}>{children}</span>
    </Html>
  )
}

/* ── the caption overlay: a fullscreen Html layer that follows the camera; eyebrow, captions, fade and vignette ── */
const centre = (_o: THREE.Object3D, _c: THREE.Camera, size: { width: number; height: number }) => [size.width / 2, size.height / 2]
export function Overlay() {
  const camera = useThree((s) => s.camera)
  const g = useRef<THREE.Group>(null)
  const fade = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const caps = useRef<(HTMLDivElement | null)[]>([])
  const ch = chapter(clock.chapter)
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (g.current) { camera.getWorldDirection(dir); g.current.position.copy(camera.position).addScaledVector(dir, 2) }
    const t = clock.t
    if (fade.current) fade.current.style.opacity = Math.max(1 - seg(t, 0, 1.3, easeOut), seg(t, ch.duration - 1.1, ch.duration, easeIn)).toFixed(3)
    if (bar.current) bar.current.style.transform = `scaleX(${(t / ch.duration).toFixed(4)})`
    ch.captions.forEach((c, i) => {
      const el = caps.current[i]; if (!el) return
      const a = seg(t, c.at, c.at + 0.7, easeOut) * (1 - seg(t, c.until - 0.5, c.until, easeIn))
      el.style.opacity = a.toFixed(3)
      el.style.transform = `translateY(${((1 - seg(t, c.at, c.at + 0.9, easeOut)) * 18).toFixed(1)}px)`
    })
  })
  return (
    <group ref={g}>
      <Html fullscreen calculatePosition={centre} wrapperClass="story-overlay-wrap" zIndexRange={[30, 30]} style={{ pointerEvents: 'none' }}>
        <div className="story-overlay">
          <div className="story-vignette" />
          <div className="story-eyebrow eyebrow">{ch.eyebrow} <span>·</span> {ch.title}</div>
          <div className="story-captions">
            {ch.captions.map((c, i) => <div key={i} ref={(el) => { caps.current[i] = el }} className="story-caption" style={{ opacity: 0 }}>{c.text}</div>)}
          </div>
          <div className="story-bar"><div ref={bar} className="story-bar-fill" /></div>
          <div ref={fade} className="story-fade" />
        </div>
      </Html>
    </group>
  )
}
