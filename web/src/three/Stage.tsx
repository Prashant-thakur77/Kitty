import { Canvas, type RootState } from '@react-three/fiber'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type StageCamera = { position: [number, number, number]; fov: number }

/** Reflections without a network fetch: a RoomEnvironment (procedural studio box) baked through PMREM once per renderer. */
function installEnvironment(state: RootState) {
  const gl = state.gl as THREE.WebGLRenderer & { __t3env?: THREE.Texture }
  if (!gl.__t3env) {
    const pmrem = new THREE.PMREMGenerator(gl)
    gl.__t3env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
  }
  state.scene.environment = gl.__t3env
  state.scene.environmentIntensity = 0.42
}

// @react-three/fiber 9.7 (its latest release) still constructs THREE.Clock, which r183+ flags as deprecated on every mount.
// Route three's logger through a filter that drops only that line and forwards everything else untouched.
let consoleFiltered = false
function filterClockWarning() {
  if (consoleFiltered) return
  consoleFiltered = true
  const prev = THREE.getConsoleFunction()
  THREE.setConsoleFunction((level: string, message: string, ...rest: unknown[]) => {
    if (level === 'warn' && typeof message === 'string' && message.includes('Clock: This module has been deprecated')) return
    if (prev) prev(level as 'log' | 'warn' | 'error', message, ...rest)
    else (console as unknown as Record<string, (...a: unknown[]) => void>)[level]?.(message, ...rest)
  })
}
filterClockWarning()

/** The react-three-fiber root. Lives in its own chunk; Canvas3D lazy-loads it only when 3D is worth rendering. */
export default function Stage({ active, camera, children }: { active: boolean; camera: StageCamera; children: ReactNode }) {
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // If the context is lost while this stage is still mounted, ask the driver to give it back (three re-initialises on
  // `webglcontextrestored`). Covers real GPU resets, and React StrictMode's simulated unmount in dev, whose deferred
  // forceContextLoss() lands on the renderer the remount kept. The handle must be taken before any loss: afterwards
  // getExtension returns null.
  const onCreated = useCallback((state: RootState) => {
    installEnvironment(state)
    const el = state.gl.domElement as HTMLCanvasElement & { __t3restore?: boolean }
    if (el.__t3restore) return
    el.__t3restore = true
    const ext = state.gl.getContext().getExtension('WEBGL_lose_context')
    el.addEventListener('webglcontextlost', () => { setTimeout(() => { if (mounted.current) ext?.restoreContext() }, 60) })
    // the PMREM texture is a render target and does not survive a context loss: bake it again on restore
    el.addEventListener('webglcontextrestored', () => { (state.gl as THREE.WebGLRenderer & { __t3env?: THREE.Texture }).__t3env = undefined; installEnvironment(state) })
  }, [])

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: camera.position, fov: camera.fov, near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false, depth: true }}
      resize={{ debounce: 120 }}
      style={{ position: 'absolute', inset: 0 }}
      onCreated={onCreated}
    >
      {children}
    </Canvas>
  )
}
