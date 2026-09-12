import Stage from '../three/Stage'
import { Overlay, Shadows } from './scenes/common'
import Problem from './scenes/Problem'
import Split from './scenes/Split'
import Enable from './scenes/Enable'

/** The three.js side of the story, loaded as one chunk: one canvas, the active chapter's scene, and the caption overlay. */
export default function StoryStage({ chapter }: { chapter: 1 | 2 | 3 }) {
  return (
    <Stage active camera={{ position: [0, 5, 10], fov: 32 }}>
      <Shadows />
      <Overlay key={chapter} />
      {chapter === 1 ? <Problem /> : chapter === 2 ? <Split /> : <Enable />}
    </Stage>
  )
}
