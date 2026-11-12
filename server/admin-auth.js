import { firestoreFromEnv } from './firestore.js'
import { createAdminSession, sameText } from './telegram.js'

// ---------- /api/admin-login — вход в админку на сайте по логину и паролю ----------
// Логин и пароль — настройки на Cloudflare: ADMIN_LOGIN (Text) и ADMIN_PASSWORD (Secret). В коде их нет.
// POST { login, password } → { session } (пропуск на 12 часов) или ошибка:
//   wrong — неверный логин/пароль; locked — слишком много ошибок, подождите 15 минут.
// Защита от подбора: после 10 неверных попыток за 15 минут вход закрывается на 15 минут (счётчик — в базе,
// коллекция admin_login; посетители её не видят).
const MAX_FAILS = 10
const WINDOW = 15 * 60 * 1000
const json = (status, body) => ({ status, json: body })

export async function adminLogin(req) {
  const { TELEGRAM_BOT_TOKEN: botToken, ADMIN_LOGIN: login, ADMIN_PASSWORD: password } = req.env
  const db = firestoreFromEnv(req.env)
  if (!botToken || !db || !login || !password) return json(503, { error: 'not_configured' })
  if (req.method !== 'POST') return json(405, { error: 'method' })

  const now = Date.now()
  const counter = (await db.get('admin_login', 'attempts')) ?? { fails: 0, since: new Date(now).toISOString() }
  const fresh = now - Date.parse(counter.since) < WINDOW
  if (fresh && counter.fails >= MAX_FAILS) return json(429, { error: 'locked' })

  const okLogin = await sameText(String(req.body?.login ?? '').trim(), login, botToken)
  const okPassword = await sameText(String(req.body?.password ?? ''), password, botToken)
  if (!(okLogin && okPassword)) {
    const fails = fresh ? counter.fails + 1 : 1
    await db.commit([db.set('admin_login', 'attempts', { fails, since: fresh ? new Date(counter.since) : new Date(now) })])
    // Небольшая пауза — подбирать пароль медленнее.
    await new Promise((resolve) => setTimeout(resolve, 800))
    return json(401, { error: 'wrong' })
  }
  if (counter.fails) await db.commit([db.set('admin_login', 'attempts', { fails: 0, since: new Date(now) })])
  return json(200, { session: await createAdminSession(login, botToken, password) })
}
