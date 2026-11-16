import { adminTelegramIds, fail, telegramIdsOf, verifyIdToken, wrap } from './accounts.js'
import { botTexts, shortLine } from './bot-texts.js'
import { firestoreFromEnv, UserFirestore } from './firestore.js'
import { callTelegram } from './telegram.js'

// Сервер для магазинов — только то, что требует Telegram-бота:
//   кнопки в боте («Подтвердить бронь», «Разрешить заявку») и сообщения владельцам/покупателям;
//   /api/photo — фото товаров: хранятся в Telegram (бот отправляет их в служебный чат), сайт берёт их отсюда.
// Сам кабинет магазина и админка работают с сайта прямо через Firebase (src/lib/seller.js, src/lib/admin.js).
// Куда бот складывает фото — TELEGRAM_STORAGE_CHAT_ID (лучше указать; иначе — Telegram самого
// продавца, иначе — Telegram первого админа, если есть ключ сервисного аккаунта).

const ID = /^[A-Za-z0-9_-]{1,100}$/
const UID = /^[A-Za-z0-9_-]{1,128}$/
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/
const json = (status, body) => ({ status, json: body })
const DAY = 24 * 60 * 60 * 1000

export const TRIAL_DAYS = 30 // пробный срок после одобрения заявки

// Брони из корзины: одна бронь магазина = несколько строк (документов bookings) с общим group_id и кодом.
// Старые брони (без group_id) — группа из одной строки.
const ACTIVE = ['new', 'confirmed']
const isOpenLine = (b, now = Date.now()) => ACTIVE.includes(b.status) && Date.parse(b.expires_at) > now

// Все строки брони, в которую входит эта строка (или все строки группы по её номеру).
// group_id придумывает сайт покупателя, поэтому ему одному верить нельзя: если передана строка брони,
// берём только строки того же магазина и того же покупателя — чужую бронь так не «подмешать».
export async function groupLines(db, bookingOrGroupId) {
  const anchor = typeof bookingOrGroupId === 'string' ? null : bookingOrGroupId
  const groupId = anchor ? anchor.group_id : bookingOrGroupId
  if (groupId) {
    const all = await db.where('bookings', 'group_id', 'EQUAL', groupId, { limit: 50 })
    const lines = anchor ? all.filter((l) => l.shop_id === anchor.shop_id && l.user_id === anchor.user_id) : all
    if (lines.length) return lines.sort((a, b) => String(a.product_name_ru ?? '').localeCompare(String(b.product_name_ru ?? '')))
  }
  if (typeof bookingOrGroupId !== 'string') return [bookingOrGroupId]
  const single = await db.get('bookings', bookingOrGroupId)
  return single ? [single] : []
}

// Магазин отвечает на строку: confirmed (подтвердил), unavailable (нет в наличии), picked_up (выдал).
// Из «новой» — любое; из «подтверждённой» — выдан или нет в наличии. Возвращает строку после изменения.
// Вызывается из кнопок в боте. shopId — проверка, что бронь этого магазина.
export async function setBookingStatus(ctx, bookingId, status, shopId) {
  const { db } = ctx
  if (!['confirmed', 'unavailable', 'picked_up'].includes(status) || !ID.test(bookingId ?? '')) throw fail('bad_request')
  const allowedFrom = status === 'confirmed' ? ['new'] : ACTIVE
  const updated = await db.transaction(async (tx) => {
    const booking = await db.get('bookings', bookingId, tx)
    if (!booking || (shopId && booking.shop_id !== shopId)) throw fail('not_found', 404)
    if (!allowedFrom.includes(booking.status) || Date.parse(booking.expires_at) <= Date.now()) throw fail('too_late', 409)
    const now = new Date()
    return {
      writes: [db.update('bookings', booking.id, { status, updated_at: now, notified_status: status })],
      result: { ...booking, status, updated_at: now.toISOString() },
    }
  })
  const lines = await groupLines(db, updated)
  await notifyBuyer(db, ctx.botToken, [updated], status, lines.some((l) => l.id !== updated.id && isOpenLine(l)))
  return updated
}

// Ответ на всю бронь из бота: «Подтвердить всё» (новые строки) или «Выдано» (все открытые).
// anchor — строка этой брони, права на магазин которой уже проверены: меняются только строки
// того же магазина и того же покупателя.
export async function setGroupStatus(ctx, anchor, status) {
  const { db } = ctx
  if (!['confirmed', 'picked_up'].includes(status)) throw fail('bad_request')
  const from = status === 'confirmed' ? ['new'] : ACTIVE
  const lines = await groupLines(db, anchor)
  const targets = lines.filter((l) => from.includes(l.status) && Date.parse(l.expires_at) > Date.now())
  if (!targets.length) throw fail('too_late', 409)
  const now = new Date()
  await db.commit(targets.map((l) => db.update('bookings', l.id, { status, updated_at: now, notified_status: status })))
  await notifyBuyer(db, ctx.botToken, targets.map((l) => ({ ...l, status })), status, false)
  return lines.map((l) => (targets.some((x) => x.id === l.id) ? { ...l, status } : l))
}

// Покупателю — в его привязанный Telegram (если привязан): одно сообщение на изменение брони.
export async function notifyBuyer(db, botToken, lines, status, othersOpen = false) {
  if (!lines.length) return
  const t = botTexts(lines[0].buyer_lang)
  const [chatId] = lines[0].user_id ? await telegramIdsOf(db, [lines[0].user_id]) : []
  if (!chatId) return
  const text = t.buyerUpdate(lines, status, othersOpen)
  if (!text) return
  await callTelegram(botToken, 'sendMessage', { chat_id: chatId, text }).catch((error) => console.error('notify buyer:', error.message))
}

// ---------- Сообщения в бот ----------

// Новая бронь → всем владельцам магазина: все позиции, сумма, код и кнопки ответа.
export async function notifyShop(env, db, botToken, lines) {
  const shop = await db.get('shops', lines[0].shop_id)
  if (!shop?.owner_uids?.length) return
  const t = botTexts(shop.owner_lang)
  for (const chatId of await telegramIdsOf(db, shop.owner_uids)) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: t.newOrder(lines),
      reply_markup: orderButtons(t, lines),
    }).catch((error) => console.error('notify shop:', error.message))
  }
}

// Кнопки под сообщением о брони (по текущему состоянию строк):
//   есть новые — «Подтвердить всё»; есть открытые — «Выдано»;
//   у каждой открытой строки — «❌ Нет: …» (если строк больше одной), иначе общая «❌ Нет в наличии».
export function orderButtons(t, lines) {
  const open = lines.filter((l) => isOpenLine(l))
  if (!open.length) return { inline_keyboard: [] }
  const groupId = lines[0].group_id ?? lines[0].id
  const rows = []
  if (open.some((l) => l.status === 'new')) rows.push([{ text: t.btnConfirmAll, callback_data: `og:confirmed:${groupId}` }])
  rows.push([{ text: t.btnPickedUpAll, callback_data: `og:picked_up:${groupId}` }])
  if (lines.length === 1) rows.push([{ text: t.btnUnavailable, callback_data: `bk:unavailable:${open[0].id}` }])
  else for (const l of open) rows.push([{ text: t.btnLineUnavailable(shortLine(l, t.lang)), callback_data: `bk:unavailable:${l.id}` }])
  return { inline_keyboard: rows }
}

export async function notifyAdmins(ctx, shop) {
  for (const chatId of await adminTelegramIds(ctx.db, ctx.env)) {
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
  } else if (action === 'addOwner') {
    // Владелец — по email его аккаунта (человек должен сначала зарегистрироваться на сайте).
    const email = String(options.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) throw fail('bad_request')
    const [user] = await db.where('users', 'email', 'EQUAL', email, { limit: 1 })
    if (!user) throw fail('no_user', 404)
    change = { owner_uids: [...new Set([...(shop.owner_uids ?? []), user.id])] }
  } else if (action === 'removeOwner') {
    if (!UID.test(options.uid ?? '')) throw fail('bad_request')
    change = { owner_uids: (shop.owner_uids ?? []).filter((uid) => uid !== options.uid) }
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
    for (const chatId of await telegramIdsOf(db, shop.owner_uids)) {
      await callTelegram(ctx.botToken, 'sendMessage', {
        chat_id: chatId,
        text: action === 'approve' ? t.approved(shop.name) : t.rejected(shop.name),
      }).catch((error) => console.error('notify owner:', error.message))
    }
  }
  return updated
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
          'Content-Type': /^image\/(jpeg|png|webp|gif)$/.test(upstream.headers.get('content-type') ?? '') ? upstream.headers.get('content-type') : 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
          // Браузер показывает ответ только как картинку и не пытается «угадать» в нём страницу или скрипт.
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      }),
    }
  }

  if (req.method !== 'POST') return json(405, { error: 'method' })
  return wrap(async () => {
    // Кто загружает: проверяем вход Firebase (подпись Google) и по базе — от имени самого человека
    // (правила базы пускают его к своему профилю и своим магазинам). Ключ сервисного аккаунта не нужен.
    const projectId = req.env.FIREBASE_PROJECT_ID || firestoreFromEnv(req.env)?.projectId
    if (!projectId) throw fail('not_configured', 503)
    const idToken = (req.header('authorization') || '').replace(/^Bearer /, '')
    const claims = await verifyIdToken(idToken, projectId)
    if (!claims) throw fail('auth', 401)
    const asUser = new UserFirestore(projectId, idToken, undefined, req.header('x-firebase-appcheck') || null)
    const me = (await asUser.get('users', claims.uid)) ?? {}
    if (me.blocked === true) throw fail('forbidden', 403)
    const staff = ['admin', 'moderator'].includes(me.role)
    if (!staff) {
      const mine = await asUser.where('shops', 'owner_uids', 'ARRAY_CONTAINS', claims.uid)
      if (!mine.some((s) => statusOf(s) === 'active')) throw fail('forbidden', 403)
    }
    const match = String(req.body?.image ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!match) throw fail('bad_request')
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
    if (bytes.length > 5 * 1024 * 1024) throw fail('too_big')
    // Куда сохранить фото: служебный чат → Telegram продавца → Telegram первого админа.
    const serviceDb = firestoreFromEnv(req.env)
    const chatId =
      req.env.TELEGRAM_STORAGE_CHAT_ID ||
      (Number.isSafeInteger(me.telegram_id) ? me.telegram_id : null) ||
      (serviceDb ? (await adminTelegramIds(serviceDb, req.env))[0] : null) ||
      null
    if (!chatId) throw fail('need_telegram', 409)
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('disable_notification', 'true')
    form.append('caption', `KiyimTop · ${claims.email ?? claims.uid}`)
    form.append('photo', new Blob([bytes], { type: match[1] }), 'photo.jpg')
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: form })
    const data = await response.json().catch(() => null)
    const sizes = data?.result?.photo
    if (!data?.ok || !sizes?.length) throw new Error(`Telegram sendPhoto: ${data?.description ?? response.status}`)
    return json(201, { url: `/api/photo?id=${sizes[sizes.length - 1].file_id}` })
  })(req)
}
