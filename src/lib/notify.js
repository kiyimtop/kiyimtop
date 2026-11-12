import { authHeader } from './auth.js'
import { asset } from './base.js'

// Сообщения в Telegram-бот (новая бронь — магазину, ответ магазина — покупателю, заявка — админам).
// Сайт только сообщает серверу «случилось вот это» (/api/notify), а сервер сам проверяет по базе,
// правда ли это, и пишет в бот. Если бот на Cloudflare не настроен — ничего не происходит, сайт работает.
// Ошибки здесь никогда не мешают человеку: бронь уже сделана, сообщение — дополнительно.
export async function notify(type, id) {
  try {
    const authorization = await authHeader()
    if (!authorization) return
    await fetch(asset('/api/notify'), {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
      keepalive: true,
    })
  } catch {
    // без сообщения в бот — не страшно
  }
}
