// Всё про Telegram на сервере: проверка подписи Mini App и вызовы бота.
// Ключ для всего — токен бота (TELEGRAM_BOT_TOKEN), его знают только Telegram и наш сервер.
// (Вход на сайт — через аккаунты Firebase, см. server/accounts.js.)
// Шифрование — стандартный WebCrypto (crypto.subtle): он есть и в Cloudflare, и в Node.

const encoder = new TextEncoder()

async function hmacKey(secret) {
  const raw = typeof secret === 'string' ? encoder.encode(secret) : secret
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function hmac(secret, message) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)))
}

// Сравнить подпись без утечки по времени: crypto.subtle.verify сравнивает сам.
async function hmacVerify(secret, message, signature) {
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(message))
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)))

export function toBase64url(bytes) {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- 1. Mini App в Telegram ---
// Mini App получает от Telegram строку initData с подписью токеном бота — подделать нельзя.
// Как проверять — описано Telegram: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const MINI_APP_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // вход действует неделю с открытия Mini App

// { id, name, username } или null, если подпись неверная или устарела.
export async function verifyInitData(initData, botToken, now = Date.now()) {
  if (!initData || !botToken) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null
  params.delete('hash')
  // Все поля, кроме подписи, по алфавиту, «ключ=значение» через перенос строки.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = await hmac('WebAppData', botToken)
  if (!(await hmacVerify(secret, dataCheckString, fromHex(hash)))) return null

  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate) || now / 1000 - authDate > MINI_APP_MAX_AGE_SECONDS) return null
  let user
  try {
    user = JSON.parse(params.get('user'))
  } catch {
    return null
  }
  if (!user || !Number.isSafeInteger(user.id)) return null
  return {
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
    username: user.username ?? null,
    language: user.language_code ?? null,
  }
}

// --- 3. Бот ---
// Секрет, который Telegram присылает с каждым сообщением боту (заголовок X-Telegram-Bot-Api-Secret-Token):
// так мы знаем, что сообщение пришло именно от Telegram. Считается из токена — отдельный ключ не нужен.
export const webhookSecret = async (botToken) => toHex(await hmac(botToken, 'kiyimtop-webhook'))

// Вызвать метод Telegram Bot API (sendMessage, editMessageText, setWebhook …).
export async function callTelegram(botToken, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => null)
  if (!data?.ok) throw new Error(`Telegram ${method}: ${data?.description ?? response.status}`)
  return data.result
}

// Случайный 4-значный код брони.
export function randomCode() {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  return String(1000 + (n % 9000))
}
