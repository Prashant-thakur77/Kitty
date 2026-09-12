import { Canvas, type RootState } from '@react-three/fiber'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'

export type StageCamera = { position: [number, number, number]; fov: number }

/** The react-three-fiber root. Lives in its own chunk; Canvas3D lazy-loads it only when 3D is worth rendering. */
export default function Stage({ active, camera, children }: { active: boolean; camera: StageCamera; children: ReactNode }) {
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // If the context is lost while this stage is still mounted, ask the driver to give it back (three re-initialises on
  // `webglcontextrestored`). Covers real GPU resets, and React StrictMode's simulated unmount in dev, whose deferred
  // forceContextLoss() lands on the renderer the remount kept. The handle must be taken before any loss: afterwards
  // getExtension returns null.
  const onCreated = useCallback((state: RootState) => {
    const el = state.gl.domElement as HTMLCanvasElement & { __t3restore?: boolean }
    if (el.__t3restore) return
    el.__t3restore = true
    const ext = state.gl.getContext().getExtension('WEBGL_lose_context')
    el.addEventListener('webglcontextlost', () => { setTimeout(() => { if (mounted.current) ext?.restoreContext() }, 60) })
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
