import { useEffect, useState } from 'react'
import { asset } from './base.js'
import { getTelegramInitData } from './platform.js'

// Кто бронирует. Два способа, и оба — это один и тот же человек в Telegram (брони общие):
//   1) KiyimTop открыт в Telegram (Mini App) — Telegram сам сообщает, кто это (initData);
//   2) на сайте вошли через бота («Войти через Telegram» → в боте «Да, войти») — сервер выдал
//      «пропуск» (session) на 30 дней, он хранится на этом устройстве.
// Сервер проверяет подпись в обоих случаях, поэтому подделать вход нельзя.

const STORAGE_KEY = 'kiyimtop-session'
const CHANGED = 'kiyimtop-login-changed'
// Запасной вариант, если браузер не даёт ничего сохранять (например, приватный режим).
let memorySession = null

// Сохранённый вход на сайте { session, name, exp } или null (нет или срок вышел).
export function getSiteSession() {
  let saved = memorySession
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? memorySession
  } catch {
    // Браузер не даёт читать — берём из памяти.
  }
  return saved?.session && saved.exp * 1000 > Date.now() ? saved : null
}

// session — пропуск от сервера (api/login.js), name — как показывать человека.
export function saveSiteSession(session, name) {
  const saved = { session, name: name ?? null, exp: sessionExpiry(session) }
  memorySession = saved
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    localStorage.removeItem('kiyimtop-telegram-login') // старый способ входа больше не используется
  } catch {
    // Не сохранилось — вход будет до закрытия страницы.
  }
  window.dispatchEvent(new Event(CHANGED))
}

export function logout() {
  memorySession = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Нечего удалять.
  }
  window.dispatchEvent(new Event(CHANGED))
}

// До какого времени действует пропуск (секунды) — записано в нём самом.
function sessionExpiry(session) {
  try {
    const payload = session.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).exp ?? 0
  } catch {
    return 0
  }
}

// Заголовок для сервера: «tma …» в Telegram, «kts …» после входа на сайте, null — не вошли.
export function authHeader() {
  const initData = getTelegramInitData()
  if (initData) return `tma ${initData}`
  const saved = getSiteSession()
  return saved ? `kts ${saved.session}` : null
}

export const isLoggedIn = () => authHeader() !== null

// Для экранов: вошёл ли человек и как его зовут; обновляется после входа и выхода.
export function useLogin() {
  const read = () => ({
    loggedIn: isLoggedIn(),
    inTelegram: Boolean(getTelegramInitData()),
    name: getSiteSession()?.name ?? null,
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () => setState(read())
    window.addEventListener(CHANGED, update)
    window.addEventListener('storage', update) // вошли или вышли в другой вкладке
    return () => {
      window.removeEventListener(CHANGED, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return state
}

// --- Вход через бота (запросы к /api/login) ---

// Новый запрос на вход: { token, code }. Ошибка с кодом not_configured / server / network.
export async function startLogin() {
  const response = await fetch(asset('/api/login'), { method: 'POST' }).catch(() => null)
  const data = await response?.json().catch(() => null)
  if (!response?.ok || !data?.token) {
    throw Object.assign(new Error('login'), { code: !response ? 'network' : response.status === 503 || response.status === 404 ? 'not_configured' : 'server' })
  }
  return data
}

// Подтвердили ли вход в боте: 'waiting' — ещё нет, 'expired' — ссылка устарела/отменена,
// 'done' — вошли (пропуск уже сохранён).
export async function checkLogin(token) {
  const response = await fetch(asset(`/api/login?token=${encodeURIComponent(token)}`)).catch(() => null)
  if (!response) return 'waiting' // нет связи — попробуем ещё раз
  if (response.status === 202) return 'waiting'
  if (response.status !== 200) return response.status === 410 ? 'expired' : 'waiting'
  const data = await response.json().catch(() => null)
  if (!data?.session) return 'waiting'
  saveSiteSession(data.session, data.name)
  return 'done'
}
