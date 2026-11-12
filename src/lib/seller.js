import { adminLogout, getAdminSession } from './adminAuth.js'
import { authHeader, getSiteSession, logout } from './auth.js'
import { asset } from './base.js'
import { clearCatalogCache } from './catalog.js'

// Кабинет магазина и админка: запросы к серверу (server/seller.js на Cloudflare).
// Кто пришёл — тот же вход, что для броней (Telegram Mini App или «Войти через Telegram» на сайте).
// Ошибка — с кодом (seller.error.<код>): auth, forbidden, not_found, bad_request, too_many, too_late,
// too_big, not_configured, server, network.
const ERRORS = ['auth', 'forbidden', 'not_found', 'bad_request', 'too_many', 'too_late', 'too_big', 'not_configured', 'server', 'network']

// Режим админа: запросы идут с пропуском админа (вход по паролю), а не с Telegram-входом.
// Включается в админке и в кабинете магазина, открытом из админки.
let adminMode = false
export const setAdminMode = (on) => {
  adminMode = Boolean(on)
}

async function call(path, method = 'GET', body) {
  const asAdmin = path.startsWith('/api/admin') || adminMode
  const authorization = asAdmin ? `adm ${getAdminSession() ?? ''}` : (authHeader() ?? '')
  let response
  try {
    response = await fetch(asset(path), {
      method,
      headers: { Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const reason = data?.error ?? (response.status === 404 && !data ? 'not_configured' : 'server')
    const code = ERRORS.includes(reason) ? reason : 'server'
    if (code === 'auth' && asAdmin) adminLogout()
    else if (code === 'auth' && getSiteSession()) logout()
    throw Object.assign(new Error(code), { code })
  }
  return data
}

// { user, isAdmin, shops }
export const fetchMe = () => call('/api/me')

// --- Кабинет магазина ---
export const fetchMyShop = (id) => call(`/api/shop?id=${encodeURIComponent(id)}`)
export const applyShop = (shop) => call('/api/shop', 'POST', { action: 'apply', shop }).then((d) => d.shop)
export const updateShop = (shopId, shop) => changed(call('/api/shop', 'POST', { action: 'updateShop', shopId, shop })).then((d) => d.shop)
export const saveProduct = (shopId, product) => changed(call('/api/shop', 'POST', { action: 'saveProduct', shopId, product })).then((d) => d.product)
export const deleteProduct = (shopId, productId) => changed(call('/api/shop', 'POST', { action: 'deleteProduct', shopId, productId }))
export const setBookingStatus = (shopId, bookingId, status) =>
  changed(call('/api/shop', 'POST', { action: 'bookingStatus', shopId, bookingId, status })).then((d) => d.booking)

// --- Админка ---
export const fetchAdmin = () => call('/api/admin').then((d) => d.shops)
export const adminAction = (shopId, action, extra = {}) =>
  changed(call('/api/admin', 'POST', { shopId, action, ...extra })).then((d) => d.shop)

// После изменений каталог на этом устройстве загружается заново (а не через 2 минуты).
function changed(promise) {
  return promise.then((data) => {
    clearCatalogCache()
    return data
  })
}

// --- Фото ---
// Уменьшаем на телефоне до 1280 px по большей стороне (JPEG) — быстро грузится и не тратит интернет.
// Сервер отправляет фото в Telegram и возвращает адрес «/api/photo?id=…».
export async function uploadPhoto(file) {
  const image = await loadImage(file)
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return (await call('/api/photo', 'POST', { image: dataUrl })).url
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(Object.assign(new Error('bad_request'), { code: 'bad_request' }))
    }
    image.src = url
  })
}
