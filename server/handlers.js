import { confirmLink, isAdminUser, LINK_TOKEN, openLink, userByTelegram } from './accounts.js'
import { botTexts } from './bot-texts.js'
import { firestoreFromEnv } from './firestore.js'
import { adminAction, bookingButtons, setBookingStatus } from './seller.js'
import { callTelegram, webhookSecret } from './telegram.js'

// Серверная часть KiyimTop — теперь только Telegram-бот (Cloudflare Workers, адреса /api/… — server/worker.js).
// Брони, кабинет магазина и админка работают прямо с сайта через Firebase (как в TheStarth),
// их охраняют правила firebase/firestore.rules. Сервер нужен боту:
//   TELEGRAM_BOT_TOKEN — токен бота @KiyimTopBot;
//   FIREBASE_SERVICE_ACCOUNT — ключ сервисного аккаунта Firebase: бот по нему узнаёт, кому писать
//     (привязанные Telegram в users) и меняет брони по кнопкам в боте. Без него бот только открывает сайт;
//   SITE_HOST — адрес основного сайта без https:// (необязательно, по умолчанию — адрес запроса).

const json = (status, body) => ({ status, json: body })

// Адрес основного сайта: из настроек (SITE_HOST) или тот, на который пришёл запрос.
const siteHost = (req) => req.env.SITE_HOST || req.url.host
const siteUrl = (req) => `https://${siteHost(req)}/`

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
        (db
          ? '✅ Ключ базы есть: бот присылает сообщения о бронях и заявках.'
          : '⚠️ Нет ключа базы (FIREBASE_SERVICE_ACCOUNT): сайт работает, но бот не будет присылать сообщения о бронях.'),
    )
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
