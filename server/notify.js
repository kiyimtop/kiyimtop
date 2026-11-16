import { fail, isAdminUser, telegramIdsOf, verifyIdToken, wrap } from './accounts.js'
import { botTexts } from './bot-texts.js'
import { firestoreFromEnv } from './firestore.js'
import { groupLines, notifyAdmins, notifyBuyer, notifyShop } from './seller.js'
import { callTelegram } from './telegram.js'

// ---------- /api/notify — сообщения в Telegram-бот ----------
// Брони, заявки и ответы магазинов теперь записывает сам сайт (прямо в Firebase). После этого сайт
// просит сервер: «напиши в бот про бронь <id>». Сервер ничему не верит на слово: сам читает запись
// из базы, проверяет, что просит её участник, и пишет только один раз (отметки notified_* в записи).
//   POST { type, id }:
//     booking_new       — новая бронь (все её строки) → владельцам магазина (с кнопками); просит покупатель;
//     booking_cancelled — покупатель отменил → владельцам;                       просит покупатель или админ;
//     booking_status    — магазин ответил → покупателю;                          просит владелец или админ;
//     shop_applied      — заявка магазина → админам и модераторам (с кнопками);  просит владелец;
//     shop_decision     — заявка одобрена / отклонена → владельцам;              просит админ или модератор.
// Если бот или ключ сервисного аккаунта не настроены — отвечает 200 { skipped: true }: сайт работает и без бота.
const ID = /^[A-Za-z0-9_-]{1,100}$/
const json = (status, body) => ({ status, json: body })

export const notify = wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  const db = firestoreFromEnv(req.env)
  if (!botToken || !db) return json(200, { skipped: true })

  const authorization = req.header('authorization') || ''
  const claims = await verifyIdToken(authorization.replace(/^Bearer /, ''), db.projectId)
  if (!claims) throw fail('auth', 401)
  const { type, id } = req.body ?? {}
  if (!ID.test(id ?? '')) throw fail('bad_request')
  const caller = (await db.get('users', claims.uid)) ?? { id: claims.uid }
  const staff = isAdminUser(req.env, caller)

  // Брони: одна бронь магазина = несколько строк (group_id). Сайт присылает номер любой строки,
  // сервер сам находит всю бронь и пишет одно сообщение про все строки, о которых ещё не писал.
  if (type?.startsWith('booking_')) {
    const booking = await db.get('bookings', id)
    if (!booking) throw fail('not_found', 404)
    const isBuyer = booking.user_id === claims.uid
    const isOwner = (booking.owner_uids ?? []).includes(claims.uid)
    const lines = await groupLines(db, booking) // только строки того же магазина и покупателя

    if (type === 'booking_new') {
      const fresh = lines.filter((l) => l.user_id === booking.user_id && !l.notified_new)
      if (!isBuyer || !fresh.length) return json(200, { ok: true })
      await db.commit(fresh.map((l) => db.update('bookings', l.id, { notified_new: true })))
      await notifyShop(req.env, db, botToken, lines)
      return json(200, { ok: true })
    }

    if (type === 'booking_cancelled') {
      const fresh = lines.filter((l) => l.status === 'cancelled' && !l.notified_cancelled)
      if (!(isBuyer || staff) || !fresh.length) return json(200, { ok: true })
      await db.commit(fresh.map((l) => db.update('bookings', l.id, { notified_cancelled: true })))
      const shop = await db.get('shops', booking.shop_id)
      const t = botTexts(shop?.owner_lang)
      for (const chatId of await telegramIdsOf(db, shop?.owner_uids ?? booking.owner_uids)) {
        await callTelegram(botToken, 'sendMessage', { chat_id: chatId, text: t.shopCancelled(fresh) }).catch((error) =>
          console.error('notify cancel:', error.message),
        )
      }
      return json(200, { ok: true })
    }

    if (type === 'booking_status') {
      const fresh = lines.filter((l) => ['confirmed', 'unavailable', 'picked_up'].includes(l.status) && l.notified_status !== l.status)
      if (!(isOwner || staff) || !fresh.length) return json(200, { ok: true })
      await db.commit(fresh.map((l) => db.update('bookings', l.id, { notified_status: l.status })))
      const othersOpen = lines.some((l) => !fresh.includes(l) && ['new', 'confirmed'].includes(l.status) && Date.parse(l.expires_at) > Date.now())
      for (const status of ['confirmed', 'unavailable', 'picked_up']) {
        const part = fresh.filter((l) => l.status === status)
        if (part.length) await notifyBuyer(db, botToken, part, status, othersOpen)
      }
      return json(200, { ok: true })
    }
  }

  if (type === 'shop_applied' || type === 'shop_decision') {
    const shop = await db.get('shops', id)
    if (!shop) throw fail('not_found', 404)

    if (type === 'shop_applied') {
      if (!(shop.owner_uids ?? []).includes(claims.uid) || shop.status !== 'pending' || shop.notified_apply) return json(200, { ok: true })
      await db.commit([db.update('shops', id, { notified_apply: true })])
      await notifyAdmins({ db, env: req.env, botToken, user: caller }, shop)
      return json(200, { ok: true })
    }

    const decision = shop.status === 'active' ? 'approve' : shop.status === 'rejected' ? 'reject' : null
    if (!staff || !decision || shop.notified_decision === decision) return json(200, { ok: true })
    await db.commit([db.update('shops', id, { notified_decision: decision })])
    const t = botTexts(shop.owner_lang)
    for (const chatId of await telegramIdsOf(db, shop.owner_uids)) {
      await callTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text: decision === 'approve' ? t.approved(shop.name) : t.rejected(shop.name),
      }).catch((error) => console.error('notify owner:', error.message))
    }
    return json(200, { ok: true })
  }

  throw fail('bad_request')
})

