/**
 * The story's clock and its keyframe helpers. One global clock (chapter, t, playing) that the page advances with
 * requestAnimationFrame; every scene is a pure function of `clock.t`, so seeking is exact and nothing is React state
 * per frame. Chapter metadata (durations, caption beats) lives here so the text fallback and the recorder API never
 * need the three.js chunk.
 */

export type Caption = { at: number; until: number; text: string }
export type Chapter = { n: 1 | 2 | 3; title: string; eyebrow: string; duration: number; captions: Caption[] }

export const CHAPTERS: readonly Chapter[] = [
  {
    n: 1, title: 'The problem', eyebrow: 'Chapter 1', duration: 34,
    captions: [
      { at: 0.8, until: 6.8, text: 'Ten friends. One pot a month.' },
      { at: 8.0, until: 13.5, text: 'It runs on trust in a treasurer.' },
      { at: 17.0, until: 22.5, text: 'The treasurer disappears with the pot.' },
      { at: 23.2, until: 28.4, text: 'A member stops paying and nobody outside ever knows.' },
      { at: 28.9, until: 33.6, text: 'Ten years of perfect payments. The bank sees nothing.' },
    ],
  },
  {
    n: 2, title: 'The split', eyebrow: 'Chapter 2', duration: 33,
    captions: [
      { at: 3.6, until: 8.6, text: 'The money stays on Ethereum.' },
      { at: 9.0, until: 13.4, text: 'The rules live on Creditcoin.' },
      { at: 13.8, until: 19.8, text: 'Every payment is proven by the Attestcoin Protocol.' },
      { at: 20.4, until: 25.2, text: 'The only clock is an attested block.' },
      { at: 27.8, until: 32.6, text: 'No treasurer. No oracle. No bridge.' },
    ],
  },
  {
    n: 3, title: 'What Creditcoin makes possible', eyebrow: 'Chapter 3', duration: 26,
    captions: [
      { at: 1.2, until: 8.0, text: 'Every number is a proven transaction or an attested deadline.' },
      { at: 8.6, until: 14.2, text: 'Credit history a lender can underwrite.' },
      { at: 15.2, until: 25.0, text: 'An agent whose only power is proof.' },
    ],
  },
]
export const chapter = (n: number): Chapter => CHAPTERS[Math.min(3, Math.max(1, Math.round(n))) - 1]

/* ── the clock ── */
type Listener = () => void
export const clock = {
  chapter: 1 as 1 | 2 | 3,
  t: 0,
  playing: false,
  /** URL autoplay chains 1 → 2 → 3; the programmatic play() holds on the last frame instead. */
  chain: false,
  waiters: [] as Listener[],
  listeners: new Set<Listener>(),
}
const notify = () => { for (const l of clock.listeners) l() }
export const subscribe = (l: Listener) => { clock.listeners.add(l); return () => { clock.listeners.delete(l) } }

/** Finishes the running chapter: resolves play() promises, then chains into the next chapter when URL autoplay asked for it. */
function finish() {
  clock.t = chapter(clock.chapter).duration
  clock.playing = false
  const w = clock.waiters; clock.waiters = []
  for (const r of w) r()
  if (clock.chain && clock.chapter < 3) { clock.chapter = (clock.chapter + 1) as 2 | 3; clock.t = 0; clock.playing = true }
  notify()
}

export function tick(dt: number) {
  if (!clock.playing) return
  clock.t += dt
  if (clock.t >= chapter(clock.chapter).duration) finish()
}

export function play(n: number): Promise<void> {
  const ch = chapter(n).n
  // switching chapters mid-play resolves the old waiters so a recorder never hangs
  if (ch !== clock.chapter || clock.t >= chapter(ch).duration) { const w = clock.waiters; clock.waiters = []; for (const r of w) r(); clock.t = 0 }
  clock.chapter = ch; clock.playing = true
  notify()
  return new Promise<void>((resolve) => { clock.waiters.push(resolve) })
}
export function seek(n: number, t: number) {
  const ch = chapter(n)
  clock.chapter = ch.n; clock.t = Math.min(ch.duration, Math.max(0, t)); clock.playing = false
  notify()
}
export function pause() { clock.playing = false; notify() }
export function resume() { if (clock.t >= chapter(clock.chapter).duration) clock.t = 0; clock.playing = true; notify() }

/* ── easing + keyframes (pure, allocation-free in the hot path) ── */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (p: number) => p * p * (3 - 2 * p)
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
export const easeIn = (p: number) => p * p * p
export const easeBack = (p: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2) }
/** 0 before `a`, 1 after `b`, eased in between. */
export const seg = (t: number, a: number, b: number, ease: (p: number) => number = easeInOut) => ease(clamp01((t - a) / (b - a)))
/** A bump that rises and falls over [at, at + dur]: 0 → 1 → 0 on a sine. */
export const pulse = (t: number, at: number, dur: number) => (t < at || t > at + dur ? 0 : Math.sin(((t - at) / dur) * Math.PI))
/** A flash that starts at `at` and decays to 0 over `decay` seconds. */
export const flash = (t: number, at: number, decay: number) => (t < at ? 0 : Math.max(0, 1 - (t - at) / decay))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export type Key = { t: number; v: number[]; ease?: (p: number) => number }
/**
 * A vector track: keys sorted by time, each key's `ease` shaping the segment that arrives at it. Holds before the first
 * key and after the last. Writes into `out` so scenes can sample every frame without allocating.
 */
export function track(keys: Key[]) {
  return (t: number, out: number[]) => {
    const n = keys.length
    if (t <= keys[0].t) { for (let i = 0; i < out.length; i++) out[i] = keys[0].v[i]; return out }
    if (t >= keys[n - 1].t) { for (let i = 0; i < out.length; i++) out[i] = keys[n - 1].v[i]; return out }
    let k = 1
    while (keys[k].t < t) k++
    const a = keys[k - 1], b = keys[k]
    const p = (b.ease ?? easeInOut)((t - a.t) / (b.t - a.t))
    for (let i = 0; i < out.length; i++) out[i] = a.v[i] + (b.v[i] - a.v[i]) * p
    return out
  }
}
