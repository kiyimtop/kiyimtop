import { accountContext, confirmLink, isAdminUser, LINK_TOKEN, openLink, telegramIdsOf, userByTelegram, wrap } from './accounts.js'
import { botTexts } from './bot-texts.js'
import { firestoreFromEnv } from './firestore.js'
import { adminAction, bookingButtons, notifyShop, setBookingStatus } from './seller.js'
import { callTelegram, randomCode, webhookSecret } from './telegram.js'

// Серверная часть KiyimTop: работает на Cloudflare Workers (адреса /api/… — server/worker.js).
// Каждый обработчик получает запрос { method, url (URL), header(name), body, env } и возвращает
// { status, json } или { status, html }. env — ключи из настроек площадки (не из кода):
//   TELEGRAM_BOT_TOKEN — токен бота @KiyimTopBot;
//   FIREBASE_SERVICE_ACCOUNT — весь JSON-ключ сервисного аккаунта Firebase (см. server/firestore.js);
//   SITE_HOST — адрес основного сайта без https:// (необязательно, по умолчанию — адрес запроса).
//
// Кто пришёл — аккаунт Firebase (вход через Google или email), см. server/accounts.js.
// База — Firebase (Firestore). Коллекции сервера (посетители сайта их не видят — см. firebase/firestore.rules):
//   bookings — брони: чей аккаунт (user_id), какой вариант товара, код, статус, до какого времени;
//   users    — аккаунты; tg_links — ссылки для привязки Telegram (10 минут).

const ID = /^[A-Za-z0-9_-]{1,100}$/
const json = (status, body) => ({ status, json: body })

// Сколько держится бронь и сколько действующих броней может быть у одного человека.
const HOLD_DAYS = 2
const MAX_ACTIVE = 3

const DAY = 24 * 60 * 60 * 1000
const ACTIVE = ['new', 'confirmed']
const isActive = (booking, now = Date.now()) => ACTIVE.includes(booking.status) && Date.parse(booking.expires_at) > now
// Ошибка, которую сайт показывает понятным текстом (booking.error.<код>).
const fail = (code) => Object.assign(new Error(code), { reason: code })

// Адрес основного сайта: из настроек (SITE_HOST) или тот, на который пришёл запрос.
const siteHost = (req) => req.env.SITE_HOST || req.url.host
const siteUrl = (req) => `https://${siteHost(req)}/`

// ---------- /api/bookings — брони покупателя ----------
//   GET — мои брони (последние 50); POST {variantId, productId} — забронировать на 2 дня;
//   DELETE ?id= — отменить свою.
// Бронировать можно только с подтверждённым email (у входа через Google он подтверждён сразу).
export const bookings = wrap(async (req) => {
  const ctx = await accountContext(req)
  const { db, botToken, user } = ctx

  // Просроченные брони возвращают вещь в наличие (заодно при каждом обращении к броням).
  await releaseExpired(db).catch((error) => console.error('releaseExpired:', error))

  if (req.method === 'GET') {
    const mine = await db.where('bookings', 'user_id', 'EQUAL', user.id)
    mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return json(200, { bookings: mine.slice(0, 50).map(bookingOut) })
  }

  if (req.method === 'POST') {
    if (!user.email_verified) return json(403, { error: 'not_verified' })
    const variantId = req.body?.variantId
    const productId = req.body?.productId
    if (!ID.test(variantId ?? '') || (productId != null && !ID.test(productId))) return json(400, { error: 'not_found' })
    try {
      const booking = await createBooking(db, user, variantId, productId)
      // Магазину — сообщение в боте с кнопками «Подтвердить» / «Нет в наличии».
      await notifyShop(req.env, db, botToken, booking).catch((error) => console.error('notifyShop:', error))
      return json(201, { booking: bookingOut(booking) })
    } catch (error) {
      if (error.reason) return json(409, { error: error.reason })
      throw error
    }
  }

  if (req.method === 'DELETE') {
    const id = req.url.searchParams.get('id')
    if (!ID.test(id ?? '')) return json(404, { error: 'not_found' })
    try {
      const cancelled = await cancelBooking(db, user, id)
      await notifyCancelled(db, botToken, cancelled).catch((error) => console.error('notifyCancelled:', error))
      return json(200, { ok: true })
    } catch (error) {
      if (error.reason) return json(404, { error: error.reason })
      throw error
    }
  }

  return json(405, { error: 'method' })
})

// Бронь одной транзакцией: проверить правила, уменьшить количество варианта на 1 и записать бронь.
// Если двое одновременно бронируют последнюю вещь — второй получит «sold_out».
async function createBooking(db, user, variantId, productId) {
  const id = crypto.randomUUID()
  return db.transaction(async (tx) => {
    let product = productId ? await db.get('products', productId, tx) : null
    if (!product?.variants?.some((v) => v.id === variantId)) product = await findProductByVariant(db, variantId, tx)
    if (!product || product.is_active !== true) throw fail('not_found')
    const [shop, category] = await Promise.all([db.get('shops', product.shop_id, tx), db.get('categories', product.category_id, tx)])
    if (!shop || shop.is_active !== true) throw fail('not_found')

    const now = Date.now()
    const active = (await db.where('bookings', 'user_id', 'EQUAL', user.id, { transaction: tx })).filter((b) =>
      isActive(b, now),
    )
    if (active.some((b) => b.variant_id === variantId)) throw fail('already_booked')
    if (active.length >= MAX_ACTIVE) throw fail('too_many')

    const variants = product.variants.map((v) => ({ ...v }))
    const variant = variants.find((v) => v.id === variantId)
    if (!(variant.quantity > 0)) throw fail('sold_out')
    variant.quantity -= 1

    const booking = {
      id,
      code: randomCode(),
      status: 'new',
      created_at: new Date(now),
      updated_at: new Date(now),
      expires_at: new Date(now + HOLD_DAYS * DAY),
      user_id: user.id,
      buyer_name: user.name ?? null,
      buyer_email: user.email ?? null,
      buyer_username: user.telegram_username ?? null,
      buyer_lang: user.telegram_lang ?? null,
      product_id: product.id,
      variant_id: variantId,
      shop_id: shop.id,
      product_name_uz: product.name_uz ?? null,
      product_name_ru: product.name_ru ?? null,
      size: variant.size ?? null,
      color_uz: variant.color_uz ?? null,
      color_ru: variant.color_ru ?? null,
      price: product.price ?? null,
      // Копия данных магазина и категории на момент брони — «Мои брони» показывают их без лишних запросов.
      shop: pick(shop, SHOP_FIELDS),
      product: { category: category ? { slug: category.slug ?? category.id, emoji: category.emoji ?? null } : null },
    }
    return {
      writes: [db.update('products', product.id, { variants }), db.set('bookings', id, booking, { mustNotExist: true })],
      result: { ...booking, created_at: booking.created_at.toISOString(), updated_at: booking.updated_at.toISOString(), expires_at: booking.expires_at.toISOString() },
    }
  })
}

// Если сайт не прислал номер товара — ищем вариант по всем активным товарам (их пока немного).
async function findProductByVariant(db, variantId, transaction) {
  const products = await db.where('products', 'is_active', 'EQUAL', true, { limit: 5000, transaction })
  return products.find((p) => p.variants?.some((v) => v.id === variantId)) ?? null
}

// Отменить свою действующую бронь и вернуть вещь в наличие.
async function cancelBooking(db, user, id) {
  return db.transaction(async (tx) => {
    const booking = await db.get('bookings', id, tx)
    if (!booking || booking.user_id !== user.id || !ACTIVE.includes(booking.status)) throw fail('not_found')
    const product = await db.get('products', booking.product_id, tx)
    const writes = [db.update('bookings', id, { status: 'cancelled', updated_at: new Date() })]
    // Просроченная бронь уже не держит вещь (или скоро отпустит её сама) — тогда количество не трогаем.
    if (product && Date.parse(booking.expires_at) > Date.now()) writes.push(restock(db, product, [booking]))
    return { writes, result: booking }
  })
}

// Покупатель отменил — магазину сообщение (чтобы не искал вещь зря).
async function notifyCancelled(db, botToken, booking) {
  const shop = await db.get('shops', booking.shop_id)
  const t = botTexts(shop?.owner_lang)
  for (const chatId of await telegramIdsOf(db, shop?.owner_uids)) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `${t.statusLine.cancelled}\n${booking.product_name_ru ?? booking.product_name_uz} · ${[booking.size, booking.color_ru].filter(Boolean).join(' · ')}\n${booking.code}`,
    }).catch((error) => console.error('notify cancel:', error.message))
  }
}

// Вернуть по одной штуке за каждую бронь (запись для commit).
function restock(db, product, released) {
  const variants = (product.variants ?? []).map((v) => ({ ...v }))
  for (const booking of released) {
    const variant = variants.find((v) => v.id === booking.variant_id)
    if (variant) variant.quantity = (variant.quantity ?? 0) + 1
  }
  return db.update('products', product.id, { variants })
}

// Брони, у которых вышел срок: статус «expired», вещь — обратно в наличие.
// Отдельного «будильника» у Cloudflare Pages нет, поэтому проверяем при обращениях к броням.
async function releaseExpired(db) {
  const now = Date.now()
  const lists = await Promise.all(ACTIVE.map((status) => db.where('bookings', 'status', 'EQUAL', status, { limit: 1000 })))
  const stale = lists.flat().filter((b) => Date.parse(b.expires_at) <= now)
  const byProduct = new Map()
  for (const booking of stale) byProduct.set(booking.product_id, [...(byProduct.get(booking.product_id) ?? []), booking])
  for (const [productId, list] of byProduct) {
    await db.transaction(async (tx) => {
      // Перепроверяем внутри транзакции: кто-то мог уже отпустить эти брони.
      const fresh = (await Promise.all(list.map((b) => db.get('bookings', b.id, tx)))).filter(
        (b) => b && ACTIVE.includes(b.status) && Date.parse(b.expires_at) <= Date.now(),
      )
      if (!fresh.length) return { writes: [], result: null }
      const product = await db.get('products', productId, tx)
      const writes = fresh.map((b) => db.update('bookings', b.id, { status: 'expired', updated_at: new Date() }))
      if (product) writes.push(restock(db, product, fresh))
      return { writes, result: null }
    })
  }
}

const SHOP_FIELDS = [
  'id', 'name', 'address_uz', 'address_ru', 'landmark_uz', 'landmark_ru',
  'latitude', 'longitude', 'phone', 'telegram_username', 'opens_at', 'closes_at',
]
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key] ?? null]))

// Что отдаём сайту: без служебных полей покупателя.
function bookingOut(booking) {
  const { user_id, telegram_user_id, buyer_name, buyer_email, buyer_username, ...rest } = booking
  return rest
}

// ---------- /api/bot-webhook — сюда Telegram присылает всё, что пишут боту ----------
//   «Start» по ссылке привязки (из профиля) → «Привязать к аккаунту …?» и кнопки «Да» / «Отмена»;
//   /shop, /bookings, /account, /admin — кнопки, которые открывают нужную страницу внутри Telegram;
//   обычный «Start» (и любое другое сообщение) → приветствие с кнопкой, которая открывает KiyimTop внутри Telegram.
// Отвечаем Telegram всегда 200, иначе он будет присылать то же сообщение снова.
export async function botWebhook(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  if (req.method !== 'POST' || !botToken) return json(200, { ok: true })
  // Только Telegram знает секрет (мы передали его ему в /api/bot-setup).
  if (req.header('x-telegram-bot-api-secret-token') !== (await webhookSecret(botToken))) return json(401, { error: 'auth' })
  const db = firestoreFromEnv(req.env)
  try {
    if (req.body?.message) await onMessage(req, db, req.body.message, botToken)
    else if (req.body?.callback_query) await onButton(req, db, req.body.callback_query, botToken)
  } catch (error) {
    console.error('bot-webhook:', error)
  }
  return json(200, { ok: true })
}

// Кнопка под сообщением, которая открывает KiyimTop прямо в Telegram (Mini App).
const openButton = (req, t, path = '', label = t.open) => ({
  inline_keyboard: [[{ text: label, web_app: { url: siteUrl(req) + path } }]],
})

async function onMessage(req, db, message, botToken) {
  const text = message.text ?? ''
  const t = botTexts(message.from?.language_code)
  const chatId = message.chat.id
  if (message.chat.type !== 'private') return
  const from = telegramFrom(message.from)

  // Привязка Telegram к аккаунту: ссылка t.me/KiyimTopBot?start=link_<token> из профиля на сайте.
  const link = text.match(/^\/start link_([A-Za-z0-9_-]{20,40})$/)
  if (link) {
    const request = db && (await openLink(db, link[1]))
    if (!request) return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.linkExpired })
    return callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: t.linkAsk(request.email),
      reply_markup: {
        inline_keyboard: [
          [{ text: t.linkYes, callback_data: `ln:${link[1]}` }],
          [{ text: t.linkNo, callback_data: `nl:${link[1]}` }],
        ],
      },
    })
  }

  if (text === '/shop') {
    return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.shopIntro, reply_markup: openButton(req, t, 'my-shop', t.shopOpen) })
  }
  if (text === '/admin' && db) {
    const account = await userByTelegram(db, from.id)
    if (isAdminUser(req.env, account)) {
      return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.adminIntro, reply_markup: openButton(req, t, 'admin', t.adminOpen) })
    }
  }
  if (text === '/bookings') {
    return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.bookings, reply_markup: openButton(req, t, 'bookings') })
  }
  if (text === '/account') {
    return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.accountIntro, reply_markup: openButton(req, t, 'account', t.accountOpen) })
  }
  return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.welcome, reply_markup: openButton(req, t) })
}

const telegramFrom = (from = {}) => ({
  id: from.id,
  name: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
  username: from.username ?? null,
  language: from.language_code ?? null,
})

async function onButton(req, db, query, botToken) {
  const t = botTexts(query.from?.language_code)
  const [action, token, extra] = String(query.data ?? '').split(':')
  const edit = (text, reply_markup) =>
    query.message &&
    callTelegram(botToken, 'editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text,
      ...(reply_markup ? { reply_markup } : {}),
    })
  const answer = (text) => callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: query.id, ...(text ? { text, show_alert: true } : {}) })
  if (!db) return answer()
  const from = telegramFrom(query.from)

  // Привязка Telegram: ln:<token> — да, nl:<token> — отмена.
  if ((action === 'ln' || action === 'nl') && LINK_TOKEN.test(token ?? '')) {
    if (action === 'nl') {
      await answer()
      return edit(t.linkCancelled)
    }
    const email = await confirmLink(db, token, from)
    await answer()
    return edit(email === null ? t.linkExpired : t.linkDone(email))
  }

  // Кто нажал: аккаунт, к которому привязан этот Telegram.
  const account = await userByTelegram(db, from.id)
  const ctx = { db, botToken, user: account ?? {}, admin: isAdminUser(req.env, account), env: req.env }

  // Ответ магазина на бронь: bk:<статус>:<номер брони>. Нажать может владелец этого магазина или админ.
  if (action === 'bk') {
    const booking = await db.get('bookings', extra ?? '')
    const shop = booking && (await db.get('shops', booking.shop_id))
    if (!booking || !(ctx.admin || (account && shop?.owner_uids?.includes(account.id)))) return answer(t.notAllowed)
    try {
      const updated = await setBookingStatus(ctx, booking.id, token, booking.shop_id)
      await answer()
      return edit(`${query.message?.text ?? ''}\n\n${t.statusLine[updated.status]}`, bookingButtons(t, updated.id, updated.status))
    } catch (error) {
      if (!error.reason) throw error
      const fresh = await db.get('bookings', booking.id)
      const state = fresh && Date.parse(fresh.expires_at) <= Date.now() && ['new', 'confirmed'].includes(fresh.status) ? 'expired' : fresh?.status
      await answer(t.statusLine[state] ?? t.notAllowed)
      return edit(`${query.message?.text ?? ''}\n\n${t.statusLine[state] ?? ''}`, { inline_keyboard: [] })
    }
  }

  // Заявка магазина: ap:approve|reject:<номер магазина>. Только админ.
  if (action === 'ap') {
    if (!ctx.admin) return answer(t.notAllowed)
    try {
      await adminAction(ctx, token, extra)
      await answer()
      return edit(`${query.message?.text ?? ''}\n\n${token === 'approve' ? t.btnApprove : t.btnReject}`, { inline_keyboard: [] })
    } catch (error) {
      if (!error.reason) throw error
      return answer(t.notAllowed)
    }
  }
  return answer()
}

// ---------- /api/bot-setup — подключить бота к сайту ----------
// Владелец один раз открывает в браузере https://<адрес сайта>/api/bot-setup — и:
//   1) Telegram начинает присылать сообщения боту на /api/bot-webhook этого адреса;
//   2) у бота слева от поля ввода появляется кнопка «Ochish» — она открывает KiyimTop внутри Telegram;
//   3) у бота появляются команды /start, /bookings, /account и /shop.
// Открыть повторно не страшно. Открывать на основном адресе.
export async function botSetup(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return page(503, '❌ Не настроено: нет TELEGRAM_BOT_TOKEN в настройках сайта.')
  const db = firestoreFromEnv(req.env)
  try {
    await callTelegram(botToken, 'setWebhook', {
      url: `https://${siteHost(req)}/api/bot-webhook`,
      secret_token: await webhookSecret(botToken),
      allowed_updates: ['message', 'callback_query'],
    })
    await callTelegram(botToken, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Ochish', web_app: { url: siteUrl(req) } },
    })
    for (const [language, t] of [['', botTexts('uz')], ['ru', botTexts('ru')]]) {
      await callTelegram(botToken, 'setMyCommands', {
        commands: [
          { command: 'start', description: t.commandStart },
          { command: 'bookings', description: t.commandBookings },
          { command: 'account', description: t.commandAccount },
          { command: 'shop', description: t.commandShop },
        ],
        ...(language ? { language_code: language } : {}),
      })
    }
    const info = await callTelegram(botToken, 'getWebhookInfo', {})
    return page(
      200,
      `✅ Бот подключён к сайту. Telegram присылает сообщения на ${escapeHtml(info.url)}.<br>` +
        `✅ Кнопка «Ochish» открывает ${escapeHtml(siteUrl(req))}.<br>` +
        (db ? '✅ База Firebase подключена.' : '❌ Нет ключа базы: впишите FIREBASE_SERVICE_ACCOUNT в настройках Cloudflare.') +
        '<br>' +
        (adminEmailsSet(req.env) ? '✅ Главный админ указан (ADMIN_EMAILS).' : '⚠️ Не указан главный админ: впишите свой email в ADMIN_EMAILS (Text) на Cloudflare.'),
    )
  } catch (error) {
    console.error('bot-setup:', error)
    return page(500, `❌ Не получилось подключить бота: ${escapeHtml(String(error.message).replaceAll(botToken, '…'))}`)
  }
}

const adminEmailsSet = (env) => /@/.test(String(env.ADMIN_EMAILS ?? ''))

function page(status, text) {
  return {
    status,
    html:
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>KiyimTop — бот</title><p style="font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px">${text}</p>`,
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
