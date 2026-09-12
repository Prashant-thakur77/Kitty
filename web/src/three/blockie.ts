import * as THREE from 'three'

/**
 * The same 5×5 identicon that `Blockie` in components/ui.tsx draws as SVG, rasterised into a CanvasTexture for a coin face.
 * Kept byte-for-byte identical (seed = first 8 hex chars, LCG 1103515245/12345, 15 mirrored cells, hue = seed % 360)
 * so the tokens in the 3D circle are recognisably the same members as the list beside it.
 */
export function blockieCells(address: string): { hue: number; cells: boolean[] } {
  const h = parseInt(address.slice(2, 10), 16)
  const cells: boolean[] = []
  let x = h
  for (let i = 0; i < 15; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; cells.push(x % 3 !== 0) }
  return { hue: h % 360, cells }
}

const SIZE = 80 // 5 cells × 16 px, drawn without smoothing so the pixels stay crisp

/** A coin face: the identicon on its dark hue-tinted ground, with a thin lighter rim so the disc reads as a stamped coin. */
export function blockieTexture(address: string): THREE.CanvasTexture {
  const { hue, cells } = blockieCells(address)
  const c = document.createElement('canvas'); c.width = c.height = SIZE
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = `hsl(${hue} 30% 16%)`; g.fillRect(0, 0, SIZE, SIZE)
  // inset the 5×5 grid by half a cell so the outer cells do not touch the bevel
  const cell = SIZE / 6.4, off = (SIZE - cell * 5) / 2
  g.fillStyle = `hsl(${hue} 70% 62%)`
  cells.forEach((on, i) => {
    if (!on) return
    const r = Math.floor(i / 3), col = i % 3
    g.fillRect(off + col * cell, off + r * cell, cell + 0.5, cell + 0.5)
    g.fillRect(off + (4 - col) * cell, off + r * cell, cell + 0.5, cell + 0.5)
  })
  // rim ring, the coin's milled edge seen from above
  g.strokeStyle = `hsl(${hue} 45% 40%)`; g.lineWidth = 3
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2.5, 0, Math.PI * 2); g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  return t
}
