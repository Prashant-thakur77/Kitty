import { createContext, useContext, type RefObject } from 'react'

/** Normalised pointer position over the host element, -1..1 on both axes (y up). Written by Canvas3D, read by scenes in useFrame. */
export type PointerRef = RefObject<{ x: number; y: number }>
export const PointerContext = createContext<PointerRef>({ current: { x: 0, y: 0 } })
export const usePointer = () => useContext(PointerContext)
