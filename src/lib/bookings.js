import { authHeader } from './auth.js'
import { asset } from './base.js'

// Брони: запросы к серверу (/api/bookings — server/handlers.js на Cloudflare).
// Сервер узнаёт покупателя по аккаунту (вход через Google или email — lib/auth.js).
// Бронировать можно только с подтверждённым email.

// Сколько держится бронь (так же на сервере: expires_at = сейчас + 2 дня).
export const HOLD_DAYS = 2

// Ошибка с кодом, который сайт показывает понятным текстом (booking.error.<код>):
// sold_out, too_many, already_booked, not_found, not_verified, auth, not_configured, server, network.
const ERRORS = ['sold_out', 'too_many', 'already_booked', 'not_found', 'not_verified', 'auth', 'not_configured', 'server', 'network']

async function call(method, query = '', body) {
  const authorization = await authHeader()
  let response
  try {
    response = await fetch(asset(`/api/bookings${query}`), {
      method,
      headers: {
        Authorization: authorization ?? '',
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
