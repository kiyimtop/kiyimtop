import { firestoreFromEnv, signJwt } from './firestore.js'
import { verifyInitData } from './telegram.js'

// Аккаунты KiyimTop — Firebase Authentication (вход через Google или email + пароль).
//
// Как сервер узнаёт, кто пришёл: сайт присылает заголовок «Authorization: Bearer <ID-токен Firebase>».
// ID-токен подписан Google; сервер проверяет подпись открытыми ключами Google — подделать нельзя.
//
// Данные аккаунта — коллекция users (id документа = uid из Firebase). Посетители её не видят
// (в firebase/firestore.rules для неё нет правил), читает и пишет только сервер:
//   email, name, email_verified, role ('admin' или null),
//   telegram_id, telegram_username, telegram_name — привязанный Telegram (для сообщений бота).
//
// Админ — аккаунт с role = 'admin' (выдаётся в админке) или с email из ADMIN_EMAILS
// (настройка на Cloudflare, Text: «главные» админы через запятую — их нельзя снять из админки).
//
// Telegram привязывается только через бота (ссылка t.me/KiyimTopBot?start=link_…), а в Mini App —
// по подписи Telegram. Ввести чужой ID или @username вручную нельзя: бот пишет только тем,
// кто сам нажал «Start», и так никто не выдаст себя за другого.

const json = (status, body) => ({ status, json: body })
export const fail = (reason, status = 400) => Object.assign(new Error(reason), { reason, status })
const LINK_MINUTES = 10
export const LINK_TOKEN = /^[A-Za-z0-9_-]{20,40}$/

// ---------- Проверка ID-токена Firebase ----------
// Открытые ключи Google, которыми подписаны ID-токены. Меняются раз в несколько часов — запоминаем на час.
const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
let keysCache = { until: 0, keys: new Map() }

async function googleKey(kid, fetchImpl = fetch) {
  if (keysCache.until < Date.now() || !keysCache.keys.has(kid)) {
    const response = await fetchImpl(KEYS_URL)
    const data = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(data?.keys)) throw new Error(`Google keys: ${response.status}`)
    const keys = new Map()
    for (const jwk of data.keys) {
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    keysCache = { until: Date.now() + 60 * 60 * 1000, keys }
  }
  return keysCache.keys.get(kid) ?? null
}

// Только для теста: подставить свои ключи вместо ключей Google.
export function setTestKeys(keys) {
  keysCache = { until: Date.now() + 60 * 60 * 1000, keys }
}

const decodePart = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

// { uid, email, emailVerified, name, provider } или null (подпись не та, срок вышел, чужой проект).
export async function verifyIdToken(token, projectId, now = Date.now()) {
  if (!token || !projectId) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header, payload
  try {
    header = decodePart(parts[0])
    payload = decodePart(parts[1])
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || !header.kid) return null
  const key = await googleKey(header.kid)
  if (!key) return null
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) return null
  const seconds = now / 1000
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) return null
  if (!(payload.exp > seconds) || !(payload.iat <= seconds + 300) || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) return null
  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : null,
    provider: payload.firebase?.sign_in_provider ?? null,
  }
}

// Пропуск для входа в Firebase «от имени» аккаунта (custom token). Нужен Mini App: Telegram уже
// подтвердил, кто это, и если этот Telegram привязан к аккаунту — входим в него без пароля.
export function createCustomToken(account, uid, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  return signJwt(
    {
      iss: account.client_email,
      sub: account.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat,
      exp: iat + 3600,
      uid,
    },
    account.private_key,
  )
}

// ---------- Админы ----------
export const adminEmails = (env) =>
  String(env.ADMIN_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'))

// «Главный» админ (из ADMIN_EMAILS) — только с подтверждённым email, иначе любой мог бы зарегистрироваться с чужой почтой.
export const isOwnerAdmin = (env, user) => Boolean(user?.email && user.email_verified && adminEmails(env).includes(user.email))
// Модератор в боте может то же, что и в админке: отвечать на заявки магазинов.
export const isAdminUser = (env, user) => Boolean(user && (['admin', 'moderator'].includes(user.role) || isOwnerAdmin(env, user)))

// Все админы, у которых привязан Telegram (кому бот шлёт заявки магазинов).
export async function adminTelegramIds(db, env) {
  const byRole = [...(await db.where('users', 'role', 'EQUAL', 'admin')), ...(await db.where('users', 'role', 'EQUAL', 'moderator'))]
  const byEmail = (await Promise.all(adminEmails(env).map((email) => db.where('users', 'email', 'EQUAL', email)))).flat()
  const ids = [...byRole, ...byEmail.filter((u) => isOwnerAdmin(env, u))].map((u) => u.telegram_id).filter(Number.isSafeInteger)
  return [...new Set(ids)]
}

// Аккаунт, к которому привязан этот Telegram (или null).
export async function userByTelegram(db, telegramId) {
  if (!Number.isSafeInteger(telegramId)) return null
  const [user] = await db.where('users', 'telegram_id', 'EQUAL', telegramId, { limit: 1 })
  return user ?? null
}

// Telegram ID для сообщений бота по uid аккаунтов (у кого Telegram не привязан — пропускаем).
export async function telegramIdsOf(db, uids = []) {
  const users = await Promise.all([...new Set(uids)].map((uid) => db.get('users', uid)))
  return users.map((u) => u?.telegram_id).filter(Number.isSafeInteger)
}

// ---------- Кто пришёл ----------
// Аккаунт из базы (создаётся при первом обращении). Имя и email обновляются из токена,
// кроме входа через Telegram (custom token): там Google ничего нового про почту не сообщает.
async function loadUser(db, claims) {
  const existing = await db.get('users', claims.uid)
  const fromToken = claims.provider === 'custom' ? {} : { email: claims.email, email_verified: claims.emailVerified }
  if (!existing) {
    const user = {
      email: claims.email,
      email_verified: claims.emailVerified,
      name: claims.name ?? (claims.email ? claims.email.split('@')[0] : null),
      role: null,
      telegram_id: null,
      telegram_username: null,
      telegram_name: null,
      created_at: new Date(),
      ...fromToken,
    }
    await db.commit([db.set('users', claims.uid, user)])
    return { id: claims.uid, ...user, created_at: user.created_at.toISOString() }
  }
  const change = Object.fromEntries(Object.entries(fromToken).filter(([key, value]) => value !== undefined && existing[key] !== value))
  if (!existing.name && claims.name) change.name = claims.name
  if (Object.keys(change).length) await db.commit([db.update('users', claims.uid, change)])
  return { ...existing, ...change }
}

// Общая подготовка для всех запросов от аккаунта: база, бот, кто пришёл и админ ли он.
// needBot — запросу нужен бот (брони, кабинет); профиль работает и без него.
export async function accountContext(req, { needBot = true } = {}) {
  const botToken = req.env.TELEGRAM_BOT_TOKEN
  const db = firestoreFromEnv(req.env)
  if (!db || (needBot && !botToken)) throw fail('not_configured', 503)
  const authorization = req.header('authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw fail('auth', 401)
  const claims = await verifyIdToken(authorization.slice(7), db.projectId)
  if (!claims) throw fail('auth', 401)
  const user = await loadUser(db, claims)
  return { db, botToken, user, uid: claims.uid, admin: isAdminUser(req.env, user), env: req.env }
}

export function wrap(handler) {
  return async (req) => {
    try {
      return await handler(req)
    } catch (error) {
      if (error.reason) return json(error.status ?? 400, { error: error.reason })
      throw error
    }
  }
}

// Что сайт видит про аккаунт.
export const userOut = (user, env) => ({
  uid: user.id,
  email: user.email ?? null,
  name: user.name ?? null,
  emailVerified: user.email_verified === true,
  telegram: Number.isSafeInteger(user.telegram_id)
    ? { id: user.telegram_id, username: user.telegram_username ?? null, name: user.telegram_name ?? null }
    : null,
  isAdmin: isAdminUser(env, user),
  isOwnerAdmin: isOwnerAdmin(env, user),
})

// ---------- Привязка Telegram ----------
// Привязать Telegram к аккаунту. У одного Telegram — один аккаунт: со старого аккаунта он отвязывается.
export async function linkTelegram(db, uid, telegramUser) {
  const others = (await db.where('users', 'telegram_id', 'EQUAL', telegramUser.id)).filter((u) => u.id !== uid)
  const clear = { telegram_id: null, telegram_username: null, telegram_name: null }
  await db.commit([
    ...others.map((u) => db.update('users', u.id, clear)),
    db.update('users', uid, {
      telegram_id: telegramUser.id,
      telegram_username: telegramUser.username ?? null,
      telegram_name: telegramUser.name ?? null,
      telegram_lang: telegramUser.language ?? null,
    }),
  ])
}

// Ссылка на бота для привязки: tg_links/<token> живёт 10 минут.
async function startLink(db, uid, email) {
  const old = await db.where('tg_links', 'uid', 'EQUAL', uid, { limit: 20 })
  const token = randomLinkToken()
  const now = Date.now()
  await db.commit([
    ...old.map((l) => db.remove('tg_links', l.id)),
    db.set('tg_links', token, { uid, email: email ?? null, created_at: new Date(now), expires_at: new Date(now + LINK_MINUTES * 60 * 1000), done_at: null }, { mustNotExist: true }),
  ])
  return token
}

function randomLinkToken() {
  let text = ''
  for (const b of crypto.getRandomValues(new Uint8Array(16))) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Открытый запрос на привязку (не просрочен и не использован) или null.
export async function openLink(db, token) {
  if (!LINK_TOKEN.test(token ?? '')) return null
  const link = await db.get('tg_links', token)
  return link && !link.done_at && Date.parse(link.expires_at) > Date.now() ? link : null
}

// Бот: человек нажал «Да, привязать». Возвращает email аккаунта или null (ссылка устарела).
export async function confirmLink(db, token, telegramUser) {
  const link = await db.transaction(async (tx) => {
    const fresh = await db.get('tg_links', token, tx)
    if (!fresh || fresh.done_at || Date.parse(fresh.expires_at) <= Date.now()) return { writes: [], result: null }
    return { writes: [db.update('tg_links', token, { done_at: new Date() })], result: fresh }
  })
  if (!link) return null
  await linkTelegram(db, link.uid, telegramUser)
  return link.email ?? ''
}

// ---------- /api/account ----------
//   GET — мой аккаунт { user };
//   POST { action }:
//     updateProfile { name }   — поменять имя;
//     linkStart                — ссылка на бота для привязки Telegram → { token };
//     linkMiniApp { initData } — привязать Telegram, в котором открыт Mini App (подпись Telegram);
//     unlinkTelegram           — отвязать.
export const account = wrap(async (req) => {
  const ctx = await accountContext(req, { needBot: false })
  const { db, uid, user } = ctx

  if (req.method === 'GET') return json(200, { user: userOut(user, req.env) })
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const body = req.body ?? {}

  if (body.action === 'updateProfile') {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) throw fail('bad_request')
    await db.commit([db.update('users', uid, { name })])
    return json(200, { user: userOut({ ...user, name }, req.env) })
  }

  if (body.action === 'linkStart') {
    if (!req.env.TELEGRAM_BOT_TOKEN) throw fail('not_configured', 503)
    return json(200, { token: await startLink(db, uid, user.email) })
  }

  if (body.action === 'linkMiniApp') {
    const telegramUser = await verifyInitData(body.initData, req.env.TELEGRAM_BOT_TOKEN)
    if (!telegramUser) throw fail('auth', 401)
    await linkTelegram(db, uid, telegramUser)
    return json(200, { user: userOut({ ...user, telegram_id: telegramUser.id, telegram_username: telegramUser.username, telegram_name: telegramUser.name }, req.env) })
  }

  if (body.action === 'unlinkTelegram') {
    const clear = { telegram_id: null, telegram_username: null, telegram_name: null }
    await db.commit([db.update('users', uid, clear)])
    return json(200, { user: userOut({ ...user, ...clear }, req.env) })
  }

  throw fail('bad_request')
})

// ---------- /api/tg-signin — вход в Mini App по привязанному Telegram ----------
//   POST { initData } → { token } (custom token для Firebase) или 404 not_linked.
export const tgSignin = wrap(async (req) => {
  const db = firestoreFromEnv(req.env)
  if (!db?.account?.private_key || !req.env.TELEGRAM_BOT_TOKEN) throw fail('not_configured', 503)
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const telegramUser = await verifyInitData(req.body?.initData, req.env.TELEGRAM_BOT_TOKEN)
  if (!telegramUser) throw fail('auth', 401)
  const user = await userByTelegram(db, telegramUser.id)
  if (!user) throw fail('not_linked', 404)
  return json(200, { token: await createCustomToken(db.account, user.id) })
})
