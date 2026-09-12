import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCan3D } from '../three/Canvas3D'
import { CHAPTERS, chapter, clock, pause, play, resume, seek, subscribe, tick } from './timeline'
import './story.css'

const StoryStage = lazy(() => import('./StoryStage'))

declare global {
  interface Window {
    kittyStory?: {
      play(chapter: number): Promise<void>
      seek(chapter: number, t: number): void
      duration(chapter: number): number
      pause(): void
    }
  }
}

const snapshot = () => `${clock.chapter}:${clock.playing}`

/**
 * The story page: one global clock advanced by requestAnimationFrame, a chapter scene that is a pure function of it,
 * and three ways to drive it: URL (?chapter=1|2|3&autoplay=1&hud=0), keyboard (←/→ chapters, space play/pause), and
 * window.kittyStory for a recorder. Without WebGL or under reduced motion the captions play as a text sequence.
 */
export function Story() {
  const [params] = useSearchParams()
  const can3D = useCan3D()
  const hud = params.get('hud') !== '0'
  const key = useSyncExternalStore(subscribe, snapshot)
  const [ch, playing] = useMemo(() => { const [c, p] = key.split(':'); return [Number(c) as 1 | 2 | 3, p === 'true'] }, [key])

  // initial state from the URL: chapter, and whether to autoplay (chaining through the chapters)
  useEffect(() => {
    const n = chapter(Number(params.get('chapter') ?? 1)).n
    clock.chain = params.get('autoplay') === '1'
    if (clock.chain) play(n); else seek(n, 0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the clock: wall-clock deltas, clamped so a hidden tab does not skip a whole chapter on return
  useEffect(() => {
    let raf = 0, last = performance.now()
    const loop = (now: number) => { tick(Math.min(0.25, (now - last) / 1000)); last = now; raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // recorder API
  useEffect(() => {
    window.kittyStory = {
      play: (n) => { clock.chain = false; return play(n) },
      seek: (n, t) => seek(n, t),
      duration: (n) => chapter(n).duration,
      pause,
    }
    return () => { delete window.kittyStory }
  }, [])

  // keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { clock.chain = false; play(Math.min(3, clock.chapter + 1)) }
      else if (e.key === 'ArrowLeft') { clock.chain = false; play(Math.max(1, clock.chapter - 1)) }
      else if (e.key === ' ') { e.preventDefault(); if (clock.playing) pause(); else resume() }
      else return
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const go = useCallback((n: number) => { clock.chain = false; play(n) }, [])

  return (
    <div className="story" data-hud={hud}>
      {can3D ? (
        <Suspense fallback={null}><StoryStage chapter={ch} /></Suspense>
      ) : (
        <TextStory chapter={ch} />
      )}
      {hud && (
        <div className="story-hud">
          <Link to="/" className="story-hud-home">← Kitty</Link>
          <div className="story-hud-chapters">
            {CHAPTERS.map((c) => <button key={c.n} className={`story-hud-ch${c.n === ch ? ' active' : ''}`} onClick={() => go(c.n)}>{c.n} <span>{c.title}</span></button>)}
          </div>
          <button className="story-hud-play" onClick={() => (playing ? pause() : resume())} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <Timecode />
        </div>
      )}
    </div>
  )
}

/** m:ss.s of the running chapter; polled at 10 Hz so the HUD never re-renders per frame. */
function Timecode() {
  const [t, setT] = useState(0)
  useEffect(() => { const id = setInterval(() => setT(clock.t), 100); return () => clearInterval(id) }, [])
  const d = chapter(clock.chapter).duration
  return <span className="story-hud-time mono">{t.toFixed(1)}s / {d}s</span>
}

/** Fallback when the stage cannot render: the chapter's captions as a text sequence that follows the same clock. */
function TextStory({ chapter: n }: { chapter: 1 | 2 | 3 }) {
  const c = chapter(n)
  const [t, setT] = useState(0)
  useEffect(() => { const id = setInterval(() => setT(clock.t), 100); return () => clearInterval(id) }, [])
  return (
    <div className="story-text">
      <div className="eyebrow">{c.eyebrow} · {c.title}</div>
      <ol>
        {c.captions.map((cap, i) => <li key={i} className={t >= cap.at && t < cap.until ? 'now' : t >= cap.until ? 'past' : ''}>{cap.text}</li>)}
      </ol>
    </div>
  )
}
