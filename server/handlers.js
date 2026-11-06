import { createClient } from '@supabase/supabase-js'
import { botTexts } from './bot-texts.js'
import { callTelegram, createSession, randomCode, randomToken, userFromAuthorization, webhookSecret } from './telegram.js'

// Серверная часть KiyimTop. Подключается к площадке через переходники functions/api/*.js (Cloudflare Pages).
// Каждый обработчик получает запрос { method, url (URL), header(name), body, env } и возвращает
// { status, json } или { status, html }. env — ключи из настроек площадки (не из кода):
//   TELEGRAM_BOT_TOKEN, SUPABASE_SECRET_KEY, VITE_SUPABASE_URL (или SUPABASE_URL), SITE_HOST (необязательно).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOGIN_TOKEN = /^[A-Za-z0-9_-]{20,40}$/
const json = (status, body) => ({ status, json: body })

// Подключение к Supabase с секретным ключом (видит таблицы, закрытые для посетителей). null — ключей нет.
function database(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  if (!url || !env.SUPABASE_SECRET_KEY) return null
  return createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Адрес основного сайта: из настроек (SITE_HOST) или тот, на который пришёл запрос.
const siteHost = (req) => req.env.SITE_HOST || req.url.host

// ---------- /api/bookings — брони покупателя ----------
//   GET — мои брони (последние 50); POST {variantId} — забронировать на 2 дня; DELETE ?id= — отменить свою.
const KNOWN_ERRORS = ['not_found', 'too_many', 'already_booked', 'sold_out'] // из функции create_booking в базе
const BOOKING_FIELDS = `id, code, status, created_at, expires_at, product_id,
  product_name_uz, product_name_ru, size, color_uz, color_ru, price,
  shop:shops (id, name, address_uz, address_ru, landmark_uz, landmark_ru,
              latitude, longitude, phone, telegram_username, opens_at, closes_at),
  product:products (category:categories (slug, emoji))`

export async function bookings(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  const db = database(req.env)
  if (!botToken || !db) return json(503, { error: 'not_configured' })
  const user = await userFromAuthorization(req.header('authorization') || '', botToken)
  if (!user) return json(401, { error: 'auth' })

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('bookings')
      .select(BOOKING_FIELDS)
      .eq('telegram_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return json(200, { bookings: data })
  }

  if (req.method === 'POST') {
    const variantId = req.body?.variantId
    if (!UUID.test(variantId ?? '')) return json(400, { error: 'not_found' })
    const { data: created, error } = await db.rpc('create_booking', {
      p_variant_id: variantId,
      p_telegram_user_id: user.id,
      p_buyer_name: user.name,
      p_buyer_username: user.username,
    })
    if (error) {
      if (KNOWN_ERRORS.includes(error.message)) return json(409, { error: error.message })
      throw error
    }
    const { data: booking, error: readError } = await db.from('bookings').select(BOOKING_FIELDS).eq('id', created.id).single()
    if (readError) throw readError
    return json(201, { booking })
  }

  if (req.method === 'DELETE') {
    const id = req.url.searchParams.get('id')
    if (!UUID.test(id ?? '')) return json(404, { error: 'not_found' })
    // Отменить можно только свою бронь и только пока она действует (новая или подтверждённая).
    const { data, error } = await db
      .from('bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('telegram_user_id', user.id)
      .in('status', ['new', 'confirmed'])
      .select('id')
    if (error) throw error
    if (!data.length) return json(404, { error: 'not_found' })
    return json(200, { ok: true })
  }

  return json(405, { error: 'method' })
}

// ---------- /api/login — вход на сайте через бота ----------
//   POST — новый запрос на вход { token, code } (ссылка t.me/KiyimTopBot?start=login_<token>);
//   GET ?token= — 202 «ждём», 200 { session, name } — вошли (выдаётся один раз), 410 — устарела/отменена/использована.
export async function login(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  const db = database(req.env)
  if (!botToken || !db) return json(503, { error: 'not_configured' })

  if (req.method === 'POST') {
    // Заодно убираем совсем старые запросы (старше суток).
    await db.from('login_requests').delete().lt('expires_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    const token = randomToken()
    const code = randomCode()
    const { error } = await db.from('login_requests').insert({ token, code })
    if (error) throw error
    return json(201, { token, code })
  }

  if (req.method === 'GET') {
    const token = req.url.searchParams.get('token')
    if (!LOGIN_TOKEN.test(token ?? '')) return json(410, { error: 'expired' })
    const { data: request, error } = await db
      .from('login_requests')
      .select('token, telegram_user_id, first_name, last_name, username, confirmed_at, cancelled_at, used_at, expires_at')
      .eq('token', token)
      .maybeSingle()
    if (error) throw error
    if (!request || request.cancelled_at || request.used_at) return json(410, { error: 'expired' })
    if (!request.confirmed_at) {
      return new Date(request.expires_at) > new Date() ? json(202, { status: 'waiting' }) : json(410, { error: 'expired' })
    }
    // Подтвердили — отдаём пропуск один раз (второй браузер с той же ссылкой его не получит).
    const { data: taken, error: takeError } = await db
      .from('login_requests')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
      .is('used_at', null)
      .select('token')
    if (takeError) throw takeError
    if (!taken.length) return json(410, { error: 'expired' })
    const user = {
      id: Number(request.telegram_user_id),
      name: [request.first_name, request.last_name].filter(Boolean).join(' ') || null,
      username: request.username,
    }
    return json(200, { session: await createSession(user, botToken), name: user.name ?? user.username })
  }

  return json(405, { error: 'method' })
}

// ---------- /api/bot-webhook — сюда Telegram присылает всё, что пишут боту ----------
//   «Start» по ссылке входа → «Войти на сайт? Код …» и кнопки; «Да, войти» / «Отмена»; обычный «Start» → приветствие.
// Отвечаем Telegram всегда 200, иначе он будет присылать то же сообщение снова.
export async function botWebhook(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  if (req.method !== 'POST' || !botToken) return json(200, { ok: true })
  // Только Telegram знает секрет (мы передали его ему в /api/bot-setup).
  if (req.header('x-telegram-bot-api-secret-token') !== (await webhookSecret(botToken))) return json(401, { error: 'auth' })
  const db = database(req.env)
  try {
    if (req.body?.message) await onMessage(req, db, req.body.message, botToken)
    else if (req.body?.callback_query) await onButton(db, req.body.callback_query, botToken)
  } catch (error) {
    console.error('bot-webhook:', error)
  }
  return json(200, { ok: true })
}

async function onMessage(req, db, message, botToken) {
  const text = message.text ?? ''
  const t = botTexts(message.from?.language_code)
  const chatId = message.chat.id
  if (message.chat.type !== 'private' || !text.startsWith('/start')) return

  const login = text.match(/^\/start login_([A-Za-z0-9_-]{20,40})$/)
  if (!login) return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.welcome })
  const request = db && (await openRequest(db, login[1]))
  if (!request) return callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.loginExpired })
  return callTelegram(botToken, 'sendMessage', {
    chat_id: chatId,
    text: t.loginAsk(request.code, siteHost(req)),
    reply_markup: {
      inline_keyboard: [
        [{ text: t.loginYes, callback_data: `login:${request.token}` }],
        [{ text: t.loginNo, callback_data: `nologin:${request.token}` }],
      ],
    },
  })
}

async function onButton(db, query, botToken) {
  const t = botTexts(query.from?.language_code)
  const [action, token] = String(query.data ?? '').split(':')
  const edit = (text) =>
    query.message &&
    callTelegram(botToken, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text })

  if ((action === 'login' || action === 'nologin') && db) {
    const now = new Date().toISOString()
    const change =
      action === 'login'
        ? {
            confirmed_at: now,
            telegram_user_id: query.from.id,
            first_name: query.from.first_name ?? null,
            last_name: query.from.last_name ?? null,
            username: query.from.username ?? null,
          }
        : { cancelled_at: now }
    // Только если запрос ещё открыт: не просрочен, не подтверждён и не отменён.
    const { data, error } = await db
      .from('login_requests')
      .update(change)
      .eq('token', token)
      .is('confirmed_at', null)
      .is('cancelled_at', null)
      .gt('expires_at', now)
      .select('token')
    if (error) throw error
    await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: query.id })
    if (!data.length) return edit(t.loginExpired)
    return edit(action === 'login' ? t.loginDone : t.loginCancelled)
  }
  return callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: query.id })
}

// Открытый запрос на вход (не просрочен, не подтверждён, не отменён) или null.
async function openRequest(db, token) {
  const { data, error } = await db
    .from('login_requests')
    .select('token, code')
    .eq('token', token)
    .is('confirmed_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------- /api/bot-setup — подключить бота к сайту ----------
// Владелец один раз открывает в браузере https://<адрес сайта>/api/bot-setup — и Telegram начинает присылать
// сообщения боту на /api/bot-webhook этого адреса. Открыть повторно не страшно. Открывать на основном адресе.
export async function botSetup(req) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return page(503, '❌ Не настроено: нет TELEGRAM_BOT_TOKEN в настройках сайта.')
  try {
    await callTelegram(botToken, 'setWebhook', {
      url: `https://${siteHost(req)}/api/bot-webhook`,
      secret_token: await webhookSecret(botToken),
      allowed_updates: ['message', 'callback_query'],
    })
    const info = await callTelegram(botToken, 'getWebhookInfo', {})
    return page(200, `✅ Бот подключён к сайту. Telegram присылает сообщения на ${escapeHtml(info.url)}.`)
  } catch (error) {
    console.error('bot-setup:', error)
    return page(500, `❌ Не получилось подключить бота: ${escapeHtml(String(error.message).replaceAll(botToken, '…'))}`)
  }
}

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
