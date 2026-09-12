/**
 * Telegram Mini App integration.
 *
 * The SDK script is injected only when the page is actually opened from Telegram (`?tg=1`, the
 * Telegram user agent, or the `tgWebAppData` init data Telegram puts in the URL hash), never on a
 * plain page load. Once it is up we call ready()/expand(), mirror the Telegram theme into CSS
 * variables (`--tg-bg`, `--tg-text`, `--tg-button`, `--tg-link`, `data-tg-scheme` on <html>), and
 * drive the native BackButton from the router. `useTelegram()` exposes the state to components.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export const TELEGRAM_BOT_URL: string = import.meta.env.VITE_TELEGRAM_BOT_URL ?? 'https://t.me/KittyCirclesBot'
const SDK = 'https://telegram.org/js/telegram-web-app.js'

type ThemeParams = Partial<Record<'bg_color' | 'text_color' | 'hint_color' | 'link_color' | 'button_color' | 'button_text_color' | 'secondary_bg_color', string>>
interface BackButton { isVisible: boolean; show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
export interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name: string; username?: string } }
  colorScheme: 'light' | 'dark'
  themeParams: ThemeParams
  platform: string
  ready(): void
  expand(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  onEvent(event: string, cb: () => void): void
  BackButton: BackButton
  openLink(url: string, opts?: { try_instant_view?: boolean }): void
}
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export interface TelegramState {
  /** True when the page was opened from Telegram (before or after the SDK loads). */
  inTelegram: boolean
  /** The SDK object once it is loaded and ready(); undefined outside Telegram or while loading. */
  webApp: TelegramWebApp | undefined
  scheme: 'light' | 'dark' | undefined
  user: { id: number; first_name: string; username?: string } | undefined
}

let state: TelegramState = { inTelegram: false, webApp: undefined, scheme: undefined, user: undefined }
const listeners = new Set<() => void>()
const set = (next: Partial<TelegramState>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const get = () => state

export function isTelegramContext(): boolean {
  if (typeof window === 'undefined') return false
  if (window.Telegram?.WebApp?.initData) return true
  if (new URLSearchParams(window.location.search).get('tg') === '1') return true
  if (/tgWebAppData|tgWebAppPlatform/.test(window.location.hash)) return true
  return /Telegram/i.test(navigator.userAgent)
}

function applyTheme(wa: TelegramWebApp) {
  const root = document.documentElement
  const t = wa.themeParams ?? {}
  const vars: Record<string, string | undefined> = { '--tg-bg': t.bg_color, '--tg-text': t.text_color, '--tg-hint': t.hint_color, '--tg-link': t.link_color, '--tg-button': t.button_color, '--tg-button-text': t.button_text_color, '--tg-bg-2': t.secondary_bg_color }
  for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v)
  root.dataset.tgScheme = wa.colorScheme
  // Kitty is a dark design; paint Telegram's chrome to match the page rather than the other way round.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#0B100E'
  try { wa.setHeaderColor(bg); wa.setBackgroundColor(bg) } catch { /* older clients */ }
  set({ scheme: wa.colorScheme })
}

/** Call once from main.tsx. Idempotent; a no-op outside Telegram. */
export function initTelegram() {
  if (!isTelegramContext() || state.inTelegram) return
  set({ inTelegram: true })
  document.documentElement.dataset.telegram = '1'
  const onReady = () => {
    const wa = window.Telegram?.WebApp
    if (!wa) return
    wa.ready()
    wa.expand()
    applyTheme(wa)
    wa.onEvent('themeChanged', () => applyTheme(wa))
    wa.BackButton.onClick(onBack)
    set({ webApp: wa, user: wa.initDataUnsafe?.user })
    syncBackButton()
  }
  if (window.Telegram?.WebApp) { onReady(); return }
  const s = document.createElement('script')
  s.src = SDK
  s.async = true
  s.onload = onReady
  document.head.appendChild(s)
}

// BackButton ↔ router. The handler is registered once; the latest navigate/pathname come from whichever
// component last rendered useTelegram(), so any number of callers is fine.
let navigateRef: ((delta: number) => void) | undefined
let pathnameRef = '/'
const onBack = () => { if (navigateRef) navigateRef(-1); else window.history.back() }
function syncBackButton() {
  const bb = state.webApp?.BackButton
  if (!bb) return
  if (pathnameRef !== '/' && window.history.length > 1) bb.show(); else bb.hide()
}

/** Telegram state for components. Also keeps the native BackButton in step with the router. Must render inside the router. */
export function useTelegram(): TelegramState {
  const s = useSyncExternalStore(subscribe, get, get)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    navigateRef = (d) => navigate(d)
    pathnameRef = pathname
    syncBackButton()
  }, [pathname, navigate, s.webApp])
  return s
}
