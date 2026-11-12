import { authHeader, currentAccount } from './auth.js'
import { asset } from './base.js'
import { releaseExpired } from './bookings.js'
import { clearCatalogCache, fetchCategories } from './catalog.js'
import { codeError, fire, plain, toCode } from './db.js'
import { notify } from './notify.js'

// Кабинет магазина — прямо в базе Firestore (как в TheStarth). Кто что может менять, решают правила
// firebase/firestore.rules: владельцы магазина (owner_uids) меняют свой магазин и свои товары,
// отвечают на брони; админ и модератор — всё. Ошибка — с кодом (seller.error.<код>).
//
// Магазин: status pending (заявка) → active (админ разрешил) / rejected / blocked.
// Покупатели видят магазин, только если is_active = true: статус active и подписка не закончилась.

const MAX_PRODUCTS = 500
const MAX_PENDING = 2
const ACTIVE_BOOKING = ['new', 'confirmed']

function me() {
  const { status, user, profile } = currentAccount()
  if (status !== 'in' || !user) throw codeError('auth')
  return { user, profile }
}

// Магазины без поля status (старые тестовые) считаем одобренными.
export const statusOf = (shop) => shop.status ?? (shop.is_active ? 'active' : 'blocked')
export const shopOut = (shop) => ({ ...shop, status: statusOf(shop) })

// Подписка закончилась → магазин скрывается (is_active = false). Будильника нет — проверяем,
// когда открывают кабинет или админку. Правила разрешают это любому вошедшему, но только для
// магазинов с закончившейся подпиской.
export async function syncSubscriptions(shops) {
  const { db, fs } = await fire()
  const now = Date.now()
  for (const shop of shops) {
    if (shop.is_active && shop.subscription_until && Date.parse(shop.subscription_until) <= now) {
      await fs.updateDoc(fs.doc(db, 'shops', shop.id), { is_active: false }).catch(() => {})
      shop.is_active = false
    }
  }
}

// { user, isAdmin, shops } — кто я и какие магазины мои.
export async function fetchMe() {
  const { user, profile } = me()
  const { db, fs } = await fire()
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'shops'), fs.where('owner_uids', 'array-contains', user.uid)))
    const shops = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
    await syncSubscriptions(shops)
    return { user: profile ?? { uid: user.uid, email: user.email }, isAdmin: Boolean(profile?.isStaff), shops: shops.map(shopOut) }
  } catch (error) {
    throw toCode(error)
  }
}

// Магазин, все его товары (и скрытые) и брони (сначала новые).
export async function fetchMyShop(id) {
  const { user, profile } = me()
  const { db, fs } = await fire()
  try {
    const shopSnap = await fs.getDoc(fs.doc(db, 'shops', id))
    if (!shopSnap.exists()) throw codeError('not_found')
    const shop = { id: shopSnap.id, ...plain(shopSnap.data()) }
    if (!profile?.isStaff && !(shop.owner_uids ?? []).includes(user.uid)) throw codeError('not_found')
    // Владелец видит брони по своему uid (так разрешают правила), админ — по магазину.
    const bookingsQuery = profile?.isStaff
      ? fs.query(fs.collection(db, 'bookings'), fs.where('shop_id', '==', id), fs.limit(1000))
      : fs.query(fs.collection(db, 'bookings'), fs.where('owner_uids', 'array-contains', user.uid), fs.limit(1000))
    const [productsSnap, bookingsSnap] = await Promise.all([
      fs.getDocs(fs.query(fs.collection(db, 'products'), fs.where('shop_id', '==', id), fs.limit(MAX_PRODUCTS))),
      fs.getDocs(bookingsQuery),
    ])
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
    const bookings = bookingsSnap.docs.map((d) => ({ id: d.id, ...plain(d.data()) })).filter((b) => b.shop_id === id)
    await syncSubscriptions([shop])
    await releaseExpired(bookings).catch(() => {})
    products.sort((a, b) => String(a.name_ru ?? '').localeCompare(String(b.name_ru ?? '')))
    bookings.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return { shop: shopOut(shop), products, bookings: bookings.slice(0, 200) }
  } catch (error) {
    throw toCode(error)
  }
}

// Заявка «Добавить магазин»: магазин со статусом pending, админы получают сообщение в боте.
export async function applyShop(input, lang) {
  const { user, profile } = me()
  if (profile?.blocked) throw codeError('blocked')
  const { db, fs } = await fire()
  try {
    const mine = await fs.getDocs(fs.query(fs.collection(db, 'shops'), fs.where('owner_uids', 'array-contains', user.uid)))
    if (mine.docs.filter((d) => d.data().status === 'pending').length >= MAX_PENDING) throw codeError('too_many')
    const ref = fs.doc(fs.collection(db, 'shops'))
    const data = {
      ...cleanShop(input, { required: true }),
      owner_uids: [user.uid],
      owner_lang: lang === 'ru' ? 'ru' : 'uz',
      status: 'pending',
      is_active: false,
      subscription_until: null,
      created_at: fs.serverTimestamp(),
    }
    await fs.setDoc(ref, data)
    notify('shop_applied', ref.id)
    return shopOut({ id: ref.id, ...data, created_at: new Date().toISOString() })
  } catch (error) {
    throw toCode(error)
  }
}

export async function updateShop(shopId, input) {
  me()
  const { db, fs } = await fire()
  try {
    const data = cleanShop(input, { required: true })
    await fs.updateDoc(fs.doc(db, 'shops', shopId), data)
    clearCatalogCache()
    return { id: shopId, ...data }
  } catch (error) {
    throw toCode(error)
  }
}

// Новый товар или изменения (весь товар целиком, как присылает редактор).
export async function saveProduct(shopId, input) {
  me()
  const { db, fs } = await fire()
  try {
    const categories = await fetchCategories()
    const isNew = !input?.id
    const id = isNew ? fs.doc(fs.collection(db, 'products')).id : input.id
    const newVariantId = () => fs.doc(fs.collection(db, 'products')).id
    const product = cleanProduct({ ...input, id }, shopId, categories, newVariantId)
    if (isNew) {
      const count = await fs.getCountFromServer(fs.query(fs.collection(db, 'products'), fs.where('shop_id', '==', shopId)))
      if (count.data().count >= MAX_PRODUCTS) throw codeError('too_many')
    } else {
      const existing = await fs.getDoc(fs.doc(db, 'products', id))
      if (!existing.exists() || existing.data().shop_id !== shopId) throw codeError('not_found')
    }
    const { id: _id, ...data } = product
    await fs.setDoc(fs.doc(db, 'products', id), { ...data, updated_at: fs.serverTimestamp() })
    clearCatalogCache()
    return product
  } catch (error) {
    throw toCode(error)
  }
}

export async function deleteProduct(shopId, productId) {
  me()
  const { db, fs } = await fire()
  try {
    const ref = fs.doc(db, 'products', productId)
    const existing = await fs.getDoc(ref)
    if (!existing.exists() || existing.data().shop_id !== shopId) throw codeError('not_found')
    await fs.deleteDoc(ref)
    clearCatalogCache()
    return { ok: true }
  } catch (error) {
    throw toCode(error)
  }
}

// Магазин отвечает на бронь: confirmed (подтвердил), unavailable (нет в наличии), picked_up (выдал).
// Из «новой» — любое; из «подтверждённой» — выдан или нет в наличии. Покупателю — сообщение в боте.
export async function setBookingStatus(shopId, bookingId, status) {
  me()
  if (!['confirmed', 'unavailable', 'picked_up'].includes(status)) throw codeError('bad_request')
  const allowedFrom = status === 'confirmed' ? ['new'] : ACTIVE_BOOKING
  const { db, fs } = await fire()
  try {
    const ref = fs.doc(db, 'bookings', bookingId)
    const updated = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const booking = snap.exists() ? plain(snap.data()) : null
      if (!booking || (shopId && booking.shop_id !== shopId)) throw codeError('not_found')
      if (!allowedFrom.includes(booking.status) || Date.parse(booking.expires_at) <= Date.now()) throw codeError('too_late')
      tx.update(ref, { status, updated_at: fs.serverTimestamp() })
      return { id: bookingId, ...booking, status, updated_at: new Date().toISOString() }
    })
    notify('booking_status', bookingId)
    return updated
  } catch (error) {
    throw toCode(error)
  }
}

// ---------- Фото ----------
// Уменьшаем на телефоне до 1280 px по большей стороне (JPEG) — быстро грузится и не тратит интернет.
// Фото хранятся в Telegram: сервер отправляет фото боту и возвращает адрес «/api/photo?id=…»
// (нужен TELEGRAM_BOT_TOKEN на Cloudflare).
export async function uploadPhoto(file) {
  const image = await loadImage(file)
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const authorization = await authHeader()
  let response
  try {
    response = await fetch(asset('/api/photo'), {
      method: 'POST',
      headers: { Authorization: authorization ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    })
  } catch {
    throw codeError('network')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const known = ['auth', 'forbidden', 'bad_request', 'too_big', 'need_telegram', 'not_configured']
    throw codeError(known.includes(data?.error) ? data.error : response.status === 404 ? 'not_configured' : 'server')
  }
  return data.url
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
      reject(codeError('bad_request'))
    }
    image.src = url
  })
}

// ---------- Проверка данных перед записью (то же проверяют правила базы) ----------

const ID = /^[A-Za-z0-9_-]{1,100}$/
const text = (value, max, { required = false } = {}) => {
  const clean = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (required && !clean) throw codeError('bad_request')
  return clean || null
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const DISTRICTS = [
  'bektemir', 'chilonzor', 'mirobod', 'mirzo-ulugbek', 'olmazor', 'sergeli',
  'shayxontohur', 'uchtepa', 'yakkasaroy', 'yangihayot', 'yashnobod', 'yunusobod',
]

export function cleanShop(input = {}, { required }) {
  const time = (value) => (TIME.test(value ?? '') ? (value.length === 5 ? `${value}:00` : value) : null)
  const coordinate = (value, min, max) =>
    value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null
  return {
    name: text(input.name, 80, { required }),
    description_uz: text(input.description_uz, 500),
    description_ru: text(input.description_ru, 500),
    address_uz: text(input.address_uz, 200, { required }),
    address_ru: text(input.address_ru, 200),
    landmark_uz: text(input.landmark_uz, 200),
    landmark_ru: text(input.landmark_ru, 200),
    district: DISTRICTS.includes(input.district) ? input.district : null,
    latitude: coordinate(input.latitude, 40.9, 41.6),
    longitude: coordinate(input.longitude, 68.9, 69.7),
    phone: text(input.phone, 30, { required }),
    telegram_username: text(String(input.telegram_username ?? '').replace(/^@/, ''), 40),
    opens_at: time(input.opens_at),
    closes_at: time(input.closes_at),
  }
}

const GENDERS = ['men', 'women', 'kids', 'unisex']
const PHOTO_URL = /^(\/api\/photo\?id=[A-Za-z0-9_-]{10,200}|https:\/\/[^\s"'<>]{1,500})$/

export function cleanProduct(input = {}, shopId, categories, newVariantId) {
  const category = categories.find((c) => c.id === input.category_id)
  if (!category) throw codeError('bad_request')
  const price = Number(input.price)
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000_000) throw codeError('bad_request')
  const variants = Array.isArray(input.variants) ? input.variants.slice(0, 80) : []
  if (!variants.length) throw codeError('bad_request')
  const nameUz = text(input.name_uz, 120)
  const nameRu = text(input.name_ru, 120)
  if (!nameUz && !nameRu) throw codeError('bad_request')
  return {
    id: input.id,
    shop_id: shopId,
    // Один и тот же товар в разных магазинах — общий model_id: на странице товара видно, где он ещё есть и почём.
    model_id: ID.test(input.model_id ?? '') ? input.model_id : input.id,
    category_id: category.id,
    name_uz: nameUz ?? nameRu,
    name_ru: nameRu ?? nameUz,
    description_uz: text(input.description_uz, 1000),
    description_ru: text(input.description_ru, 1000),
    brand: text(input.brand, 60),
    gender: GENDERS.includes(input.gender) ? input.gender : 'unisex',
    price,
    photo_urls: (Array.isArray(input.photo_urls) ? input.photo_urls : []).filter((u) => PHOTO_URL.test(u)).slice(0, 8),
    is_active: input.is_active !== false,
    variants: variants.map((v) => {
      const quantity = Number(v?.quantity)
      return {
        id: ID.test(v?.id ?? '') ? v.id : newVariantId(),
        size: text(v?.size, 20),
        color_uz: text(v?.color_uz, 40),
        color_ru: text(v?.color_ru, 40) ?? text(v?.color_uz, 40),
        quantity: Number.isInteger(quantity) && quantity >= 0 ? Math.min(quantity, 99999) : 0,
      }
    }),
  }
}
