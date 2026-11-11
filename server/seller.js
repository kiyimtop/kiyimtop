import { botTexts } from './bot-texts.js'
import { firestoreFromEnv } from './firestore.js'
import { callTelegram, userFromAuthorization } from './telegram.js'

// Сторона магазина и администратора:
//   /api/me     — кто я: админ ли, какие магазины мои (и их статус);
//   /api/shop   — кабинет магазина: заявка, данные магазина, товары, брони;
//   /api/admin  — админка: заявки, разрешение/блокировка, подписка, владельцы;
//   /api/photo  — фото товаров: хранятся в Telegram (бот отправляет их в служебный чат), сайт берёт их отсюда.
//
// Кто админ — настройка ADMIN_TELEGRAM_IDS на Cloudflare (номера Telegram через запятую).
// Куда бот складывает фото — TELEGRAM_STORAGE_CHAT_ID (необязательно; по умолчанию — чат первого админа).
//
// Магазин: status pending (заявка) → active (админ разрешил) / rejected / blocked.
// Покупатели видят магазин, только если is_active = true: статус active и подписка не закончилась
// (subscription_until; пустое — без срока, например у тестовых магазинов).

const ID = /^[A-Za-z0-9_-]{1,100}$/
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/
const json = (status, body) => ({ status, json: body })
const fail = (reason, status = 400) => Object.assign(new Error(reason), { reason, status })
const DAY = 24 * 60 * 60 * 1000

export const TRIAL_DAYS = 30 // пробный срок после одобрения заявки
const MAX_PRODUCTS = 500
const MAX_PENDING = 2

export const adminIds = (env) =>
  String(env.ADMIN_TELEGRAM_IDS ?? '')
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isSafeInteger)
export const isAdmin = (env, userId) => adminIds(env).includes(userId)

// Общая подготовка: база, бот, кто пришёл. Ошибка → готовый ответ.
async function context(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  const db = firestoreFromEnv(req.env)
  if (!botToken || !db) throw fail('not_configured', 503)
  const user = await userFromAuthorization(req.header('authorization') || '', botToken)
  if (!user) throw fail('auth', 401)
  return { db, botToken, user, admin: isAdmin(req.env, user.id), env: req.env }
}

function wrap(handler) {
  return async (req) => {
    try {
      return await handler(req)
    } catch (error) {
      if (error.reason) return json(error.status ?? 400, { error: error.reason })
      throw error
    }
  }
}

// ---------- /api/me ----------
export const me = wrap(async (req) => {
  const { db, user, admin } = await context(req)
  await syncSubscriptions(db).catch((error) => console.error('syncSubscriptions:', error))
  const shops = await db.where('shops', 'owner_ids', 'ARRAY_CONTAINS', user.id)
  return json(200, { user, isAdmin: admin, shops: shops.map(shopOut) })
})

// ---------- /api/shop ----------
//   GET ?id= — магазин, все его товары (и скрытые) и брони;
//   POST { action, … }: apply, updateShop, saveProduct, deleteProduct, bookingStatus.
export const shop = wrap(async (req) => {
  const ctx = await context(req)
  const { db, user } = ctx

  if (req.method === 'GET') {
    const id = req.url.searchParams.get('id')
    const found = ID.test(id ?? '') ? await db.get('shops', id) : null
    if (!found || !(ctx.admin || found.owner_ids?.includes(user.id))) throw fail('not_found', 404)
    const [products, bookings] = await Promise.all([
      db.where('products', 'shop_id', 'EQUAL', id, { limit: MAX_PRODUCTS }),
      db.where('bookings', 'shop_id', 'EQUAL', id, { limit: 1000 }),
    ])
    products.sort((a, b) => String(a.name_ru ?? '').localeCompare(String(b.name_ru ?? '')))
    bookings.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return json(200, { shop: shopOut(found), products, bookings: bookings.slice(0, 200) })
  }

  if (req.method !== 'POST') return json(405, { error: 'method' })
  const body = req.body ?? {}

  if (body.action === 'apply') {
    const mine = await db.where('shops', 'owner_ids', 'ARRAY_CONTAINS', user.id)
    if (mine.filter((s) => s.status === 'pending').length >= MAX_PENDING) throw fail('too_many')
    const id = crypto.randomUUID()
    const data = {
      ...cleanShop(body.shop, { required: true }),
      id,
      owner_ids: [user.id],
      owner_lang: user.language ?? null,
      status: 'pending',
      is_active: false,
      subscription_until: null,
      created_at: new Date(),
    }
    await db.commit([db.set('shops', id, data, { mustNotExist: true })])
    await notifyAdmins(ctx, data).catch((error) => console.error('notifyAdmins:', error))
    return json(201, { shop: shopOut({ ...data, created_at: data.created_at.toISOString() }) })
  }

  // Остальное — только для одобренного магазина (или админа).
  const current = ID.test(body.shopId ?? '') ? await db.get('shops', body.shopId) : null
  if (!current) throw fail('not_found', 404)
  if (!canManage(ctx, current)) throw fail('forbidden', 403)

  if (body.action === 'updateShop') {
    const data = cleanShop(body.shop, { required: true })
    await db.commit([db.update('shops', current.id, data)])
    return json(200, { shop: shopOut({ ...current, ...data }) })
  }

  if (body.action === 'saveProduct') {
    const categories = await db.all('categories')
    const product = cleanProduct(body.product, current.id, categories)
    if (body.product?.id) {
      const existing = await db.get('products', product.id)
      if (!existing || existing.shop_id !== current.id) throw fail('not_found', 404)
    } else {
      const count = (await db.where('products', 'shop_id', 'EQUAL', current.id, { limit: MAX_PRODUCTS + 1 })).length
      if (count >= MAX_PRODUCTS) throw fail('too_many')
    }
    await db.commit([db.set('products', product.id, { ...product, updated_at: new Date() })])
    return json(200, { product })
  }

  if (body.action === 'deleteProduct') {
    const existing = ID.test(body.productId ?? '') ? await db.get('products', body.productId) : null
    if (!existing || existing.shop_id !== current.id) throw fail('not_found', 404)
    await db.commit([db.remove('products', existing.id)])
    return json(200, { ok: true })
  }

  if (body.action === 'bookingStatus') {
    const booking = await setBookingStatus(ctx, body.bookingId, body.status, current.id)
    return json(200, { booking })
  }

  throw fail('bad_request')
})

const canManage = (ctx, shop) => ctx.admin || (shop.owner_ids?.includes(ctx.user.id) && shop.status === 'active')

// Магазин отвечает на бронь: confirmed (подтвердил), unavailable (нет в наличии), picked_up (выдал).
// Из «новой» — любое; из «подтверждённой» — выдан или нет в наличии. Покупателю приходит сообщение в боте.
// Вызывается из кабинета и из кнопок в боте. shopId — проверка, что бронь этого магазина.
export async function setBookingStatus(ctx, bookingId, status, shopId) {
  const { db } = ctx
  if (!['confirmed', 'unavailable', 'picked_up'].includes(status) || !ID.test(bookingId ?? '')) throw fail('bad_request')
  const allowedFrom = status === 'confirmed' ? ['new'] : ['new', 'confirmed']
  const updated = await db.transaction(async (tx) => {
    const booking = await db.get('bookings', bookingId, tx)
    if (!booking || (shopId && booking.shop_id !== shopId)) throw fail('not_found', 404)
    if (!allowedFrom.includes(booking.status) || Date.parse(booking.expires_at) <= Date.now()) throw fail('too_late', 409)
    const now = new Date()
    return {
      writes: [db.update('bookings', booking.id, { status, updated_at: now })],
      result: { ...booking, status, updated_at: now.toISOString() },
    }
  })
  const t = botTexts(updated.buyer_lang)
  await callTelegram(ctx.botToken, 'sendMessage', { chat_id: updated.telegram_user_id, text: t.buyerStatus(updated, status) }).catch(
    (error) => console.error('notify buyer:', error.message),
  )
  return updated
}

// ---------- Сообщения в бот ----------

// Новая бронь → всем владельцам магазина: что, какой размер, код и кнопки ответа.
export async function notifyShop(env, db, botToken, booking) {
  const shop = await db.get('shops', booking.shop_id)
  if (!shop?.owner_ids?.length) return
  const t = botTexts(shop.owner_lang)
  for (const chatId of shop.owner_ids) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: t.newBooking(booking),
      reply_markup: bookingButtons(t, booking.id, 'new'),
    }).catch((error) => console.error('notify shop:', error.message))
  }
}

export function bookingButtons(t, id, status) {
  if (status === 'new') {
    return {
      inline_keyboard: [
        [{ text: t.btnConfirm, callback_data: `bk:confirmed:${id}` }],
        [{ text: t.btnUnavailable, callback_data: `bk:unavailable:${id}` }],
      ],
    }
  }
  if (status === 'confirmed') {
    return {
      inline_keyboard: [
        [{ text: t.btnPickedUp, callback_data: `bk:picked_up:${id}` }],
        [{ text: t.btnUnavailable, callback_data: `bk:unavailable:${id}` }],
      ],
    }
  }
  return { inline_keyboard: [] }
}

async function notifyAdmins(ctx, shop) {
  for (const chatId of adminIds(ctx.env)) {
    const t = botTexts('ru')
    await callTelegram(ctx.botToken, 'sendMessage', {
      chat_id: chatId,
      text: t.application(shop, ctx.user),
      reply_markup: {
        inline_keyboard: [
          [{ text: t.btnApprove, callback_data: `ap:approve:${shop.id}` }],
          [{ text: t.btnReject, callback_data: `ap:reject:${shop.id}` }],
        ],
      },
    }).catch((error) => console.error('notify admin:', error.message))
  }
}

// ---------- /api/admin ----------
//   GET — все магазины (сначала заявки);
//   POST { action, shopId, … }: approve, reject, block, unblock, extend {days}, addOwner {telegramId}, removeOwner {telegramId}.
export const admin = wrap(async (req) => {
  const ctx = await context(req)
  if (!ctx.admin) throw fail('forbidden', 403)
  const { db } = ctx
  await syncSubscriptions(db).catch((error) => console.error('syncSubscriptions:', error))

  if (req.method === 'GET') {
    const [shops, products] = await Promise.all([db.all('shops'), db.all('products', { limit: 5000 })])
    const counts = new Map()
    for (const p of products) counts.set(p.shop_id, (counts.get(p.shop_id) ?? 0) + 1)
    const order = { pending: 0, active: 1, blocked: 2, rejected: 3 }
    shops.sort((a, b) => (order[statusOf(a)] ?? 9) - (order[statusOf(b)] ?? 9) || String(a.name).localeCompare(String(b.name)))
    return json(200, { shops: shops.map((s) => ({ ...shopOut(s), productCount: counts.get(s.id) ?? 0 })) })
  }

  if (req.method !== 'POST') return json(405, { error: 'method' })
  const body = req.body ?? {}
  const result = await adminAction(ctx, body.action, body.shopId, body)
  return json(200, { shop: shopOut(result) })
})

// Действие админа над магазином (из админки и из кнопок в боте). Возвращает магазин после изменения.
export async function adminAction(ctx, action, shopId, options = {}) {
  const { db } = ctx
  const shop = ID.test(shopId ?? '') ? await db.get('shops', shopId) : null
  if (!shop) throw fail('not_found', 404)
  const now = Date.now()
  const subscriptionOk = (until) => !until || Date.parse(until) > now
  let change

  if (action === 'approve') {
    const until = shop.subscription_until && Date.parse(shop.subscription_until) > now ? shop.subscription_until : new Date(now + TRIAL_DAYS * DAY)
    change = { status: 'active', is_active: true, subscription_until: new Date(until) }
  } else if (action === 'reject') {
    change = { status: 'rejected', is_active: false }
  } else if (action === 'block') {
    change = { status: 'blocked', is_active: false }
  } else if (action === 'unblock') {
    change = { status: 'active', is_active: subscriptionOk(shop.subscription_until) }
  } else if (action === 'extend') {
    const days = Number(options.days)
    if (!Number.isInteger(days) || days < 1 || days > 400) throw fail('bad_request')
    const from = Math.max(now, shop.subscription_until ? Date.parse(shop.subscription_until) : now)
    change = { subscription_until: new Date(from + days * DAY), is_active: statusOf(shop) === 'active' }
  } else if (action === 'addOwner' || action === 'removeOwner') {
    const telegramId = Number(options.telegramId)
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw fail('bad_request')
    const owners = new Set(shop.owner_ids ?? [])
    if (action === 'addOwner') owners.add(telegramId)
    else owners.delete(telegramId)
    change = { owner_ids: [...owners] }
  } else {
    throw fail('bad_request')
  }

  await db.commit([db.update('shops', shop.id, change)])
  const updated = {
    ...shop,
    ...Object.fromEntries(Object.entries(change).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
  }
  if (action === 'approve' || action === 'reject') {
    const t = botTexts(shop.owner_lang)
    for (const chatId of shop.owner_ids ?? []) {
      await callTelegram(ctx.botToken, 'sendMessage', {
        chat_id: chatId,
        text: action === 'approve' ? t.approved(shop.name) : t.rejected(shop.name),
      }).catch((error) => console.error('notify owner:', error.message))
    }
  }
  return updated
}

// Подписка закончилась → магазин скрывается от покупателей (is_active = false).
// Отдельного «будильника» нет — проверяем при обращениях к кабинету, админке и броням.
export async function syncSubscriptions(db) {
  const now = Date.now()
  const active = await db.where('shops', 'is_active', 'EQUAL', true)
  const expired = active.filter((s) => s.subscription_until && Date.parse(s.subscription_until) <= now)
  if (expired.length) await db.commit(expired.map((s) => db.update('shops', s.id, { is_active: false })))
}

// Магазины без поля status (тестовые) считаем одобренными.
const statusOf = (shop) => shop.status ?? (shop.is_active ? 'active' : 'blocked')

const shopOut = (shop) => ({ ...shop, status: statusOf(shop) })

// ---------- /api/photo ----------
//   GET ?id=<file_id> — само фото (берём у Telegram, браузер и Cloudflare запоминают надолго);
//   POST { image: 'data:image/jpeg;base64,…' } — загрузить (только магазинам и админу) → { url }.
export async function photo(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return json(503, { error: 'not_configured' })

  if (req.method === 'GET') {
    const fileId = req.url.searchParams.get('id')
    if (!FILE_ID.test(fileId ?? '')) return json(404, { error: 'not_found' })
    let file
    try {
      file = await callTelegram(botToken, 'getFile', { file_id: fileId })
    } catch {
      return json(404, { error: 'not_found' })
    }
    const upstream = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`)
    if (!upstream.ok) return json(404, { error: 'not_found' })
    return {
      response: new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('content-type')?.startsWith('image/') ? upstream.headers.get('content-type') : 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }),
    }
  }

  if (req.method !== 'POST') return json(405, { error: 'method' })
  return wrap(async () => {
    const ctx = await context(req)
    if (!ctx.admin) {
      const mine = await ctx.db.where('shops', 'owner_ids', 'ARRAY_CONTAINS', ctx.user.id)
      if (!mine.some((s) => statusOf(s) === 'active')) throw fail('forbidden', 403)
    }
    const match = String(req.body?.image ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!match) throw fail('bad_request')
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
    if (bytes.length > 5 * 1024 * 1024) throw fail('too_big')
    const chatId = req.env.TELEGRAM_STORAGE_CHAT_ID || adminIds(req.env)[0]
    if (!chatId) throw fail('not_configured', 503)
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('disable_notification', 'true')
    form.append('caption', `KiyimTop · ${ctx.user.id}`)
    form.append('photo', new Blob([bytes], { type: match[1] }), 'photo.jpg')
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: form })
    const data = await response.json().catch(() => null)
    const sizes = data?.result?.photo
    if (!data?.ok || !sizes?.length) throw new Error(`Telegram sendPhoto: ${data?.description ?? response.status}`)
    return json(201, { url: `/api/photo?id=${sizes[sizes.length - 1].file_id}` })
  })(req)
}

// ---------- Проверка того, что прислал кабинет ----------

const text = (value, max, { required = false } = {}) => {
  const clean = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (required && !clean) throw fail('bad_request')
  return clean || null
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const DISTRICTS = [
  'bektemir', 'chilonzor', 'mirobod', 'mirzo-ulugbek', 'olmazor', 'sergeli',
  'shayxontohur', 'uchtepa', 'yakkasaroy', 'yangihayot', 'yashnobod', 'yunusobod',
]

function cleanShop(input = {}, { required }) {
  const time = (value) => (TIME.test(value ?? '') ? (value.length === 5 ? `${value}:00` : value) : null)
  const coordinate = (value, min, max) => (Number.isFinite(Number(value)) && value !== '' && value !== null && Number(value) >= min && Number(value) <= max ? Number(value) : null)
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

function cleanProduct(input = {}, shopId, categories) {
  const id = ID.test(input.id ?? '') ? input.id : crypto.randomUUID()
  const category = categories.find((c) => c.id === input.category_id)
  if (!category) throw fail('bad_request')
  const price = Number(input.price)
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000_000) throw fail('bad_request')
  const variants = Array.isArray(input.variants) ? input.variants.slice(0, 80) : []
  if (!variants.length) throw fail('bad_request')
  const nameUz = text(input.name_uz, 120)
  const nameRu = text(input.name_ru, 120)
  if (!nameUz && !nameRu) throw fail('bad_request')
  return {
    id,
    shop_id: shopId,
    // Один и тот же товар в разных магазинах — общий model_id: на странице товара видно, где он ещё есть и почём.
    model_id: ID.test(input.model_id ?? '') ? input.model_id : id,
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
        id: ID.test(v?.id ?? '') ? v.id : crypto.randomUUID(),
        size: text(v?.size, 20),
        color_uz: text(v?.color_uz, 40),
        color_ru: text(v?.color_ru, 40) ?? text(v?.color_uz, 40),
        quantity: Number.isInteger(quantity) && quantity >= 0 ? Math.min(quantity, 99999) : 0,
      }
    }),
  }
}
