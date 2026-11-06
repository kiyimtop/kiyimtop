import { authHeader, getSiteSession, isLoggedIn, logout } from './auth.js'
import { asset } from './base.js'

// Брони: запросы к серверу (/api/bookings — functions/api на Cloudflare, логика в server/handlers.js).
// Сервер узнаёт покупателя по подписи Telegram: в Mini App — сразу, на сайте — после
// «Войти через Telegram» (lib/auth.js).

// Сколько держится бронь (так же в базе: expires_at = now() + 2 days).
export const HOLD_DAYS = 2

export const canBook = () => isLoggedIn()

// Ошибка с кодом, который сайт показывает понятным текстом (booking.error.<код>):
// sold_out, too_many, already_booked, not_found, auth, not_configured, server, network.
const ERRORS = ['sold_out', 'too_many', 'already_booked', 'not_found', 'auth', 'not_configured', 'server', 'network']

async function call(method, query = '', body) {
  let response
  try {
    response = await fetch(asset(`/api/bookings${query}`), {
      method,
      headers: {
        Authorization: authHeader() ?? '',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    // Нет серверной функции (например, при запуске на своём компьютере) — «скоро заработает».
    const reason = data?.error ?? (response.status === 404 ? 'not_configured' : 'server')
    const code = ERRORS.includes(reason) ? reason : 'server'
    // Вход на сайте устарел (больше 30 дней) — забываем его, сайт снова покажет «Войти через Telegram».
    if (code === 'auth' && getSiteSession()) logout()
    throw Object.assign(new Error(code), { code })
  }
  return data
}

export const fetchMyBookings = () => call('GET').then((data) => data.bookings)

// productId — чтобы сервер сразу нашёл товар (без него ищет вариант по всему каталогу).
export const createBooking = (variantId, productId) => call('POST', '', { variantId, productId }).then((data) => data.booking)

export const cancelBooking = (id) => call('DELETE', `?id=${encodeURIComponent(id)}`)

// Состояние брони для показа: new / confirmed / picked_up / cancelled / unavailable / expired.
// «Истекла» — если срок прошёл, а бронь всё ещё новая или подтверждённая.
export function bookingState(booking, now = Date.now()) {
  const active = booking.status === 'new' || booking.status === 'confirmed'
  return active && new Date(booking.expires_at).getTime() <= now ? 'expired' : booking.status
}

export const isActive = (booking) => ['new', 'confirmed'].includes(bookingState(booking))
