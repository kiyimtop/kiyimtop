import { authHeader } from './auth.js'
import { asset } from './base.js'
import { clearCatalogCache } from './catalog.js'

// Кабинет магазина и админка: запросы к серверу (server/seller.js на Cloudflare).
// Кто пришёл — аккаунт (lib/auth.js); админ ли он, решает сервер.
// Ошибка — с кодом (seller.error.<код>).
const ERRORS = [
  'auth', 'forbidden', 'not_found', 'bad_request', 'too_many', 'too_late', 'too_big', 'not_configured',
  'server', 'network', 'need_telegram', 'no_user', 'self', 'owner_admin',
]

async function call(path, method = 'GET', body) {
  const authorization = await authHeader()
  let response
  try {
    response = await fetch(asset(path), {
      method,
      headers: { Authorization: authorization ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const reason = data?.error ?? (response.status === 404 && !data ? 'not_configured' : 'server')
    const code = ERRORS.includes(reason) ? reason : 'server'
    throw Object.assign(new Error(code), { code })
  }
  return data
}

// { user, isAdmin, shops }
export const fetchMe = () => call('/api/me')

// --- Кабинет магазина ---
export const fetchMyShop = (id) => call(`/api/shop?id=${encodeURIComponent(id)}`)
export const applyShop = (shop, lang) => call('/api/shop', 'POST', { action: 'apply', shop, lang }).then((d) => d.shop)
export const updateShop = (shopId, shop) => changed(call('/api/shop', 'POST', { action: 'updateShop', shopId, shop })).then((d) => d.shop)
export const saveProduct = (shopId, product) => changed(call('/api/shop', 'POST', { action: 'saveProduct', shopId, product })).then((d) => d.product)
export const deleteProduct = (shopId, productId) => changed(call('/api/shop', 'POST', { action: 'deleteProduct', shopId, productId }))
export const setBookingStatus = (shopId, bookingId, status) =>
  changed(call('/api/shop', 'POST', { action: 'bookingStatus', shopId, bookingId, status })).then((d) => d.booking)

// --- Админка ---
export const fetchAdmin = () => call('/api/admin').then((d) => d.shops)
export const fetchUsers = (q = '') => call(`/api/admin?list=users&q=${encodeURIComponent(q)}`)
export const fetchCleanup = () => call('/api/admin?list=cleanup').then((d) => d.counts)
export const runCleanup = () => call('/api/admin', 'POST', { action: 'cleanup' }).then((d) => d.counts)
export const setUserAdmin = (uid, on) => call('/api/admin', 'POST', { action: 'setAdmin', uid, on }).then((d) => d.user)
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
