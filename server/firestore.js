// Сервер ↔ база Firebase (Firestore) — напрямую по интернет-адресу Firestore, без библиотек.
// Сервер входит в базу как «сервисный аккаунт» (служебный пользователь Firebase с полным доступом):
// правила firebase/firestore.rules его не ограничивают, поэтому он видит брони и запросы на вход,
// закрытые для посетителей сайта.
//
// Ключ сервисного аккаунта — секрет FIREBASE_SERVICE_ACCOUNT на Cloudflare: всё содержимое
// JSON-файла из Firebase → Project settings → Service accounts → Generate new private key.
// Никогда не писать его в код, в чат и на GitHub.
//
// Шифрование — стандартный WebCrypto (crypto.subtle): он есть и в Cloudflare, и в Node.

const SCOPE = 'https://www.googleapis.com/auth/datastore'
const encoder = new TextEncoder()

// null — ключа нет или он испорчен (тогда сервер отвечает «скоро заработает»).
export function firestoreFromEnv(env) {
  let account
  try {
    account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT ?? '')
  } catch {
    return null
  }
  if (!account?.client_email || !account?.private_key || !(account.project_id || env.VITE_FIREBASE_PROJECT_ID)) return null
  return new Firestore(account, account.project_id || env.VITE_FIREBASE_PROJECT_ID)
}

// Пропуск Google (access token) живёт час — запоминаем и берём новый за 5 минут до конца.
const tokenCache = new Map()

export class Firestore {
  constructor(account, projectId, fetchImpl = (...args) => fetch(...args)) {
    this.account = account
    this.projectId = projectId
    this.fetch = fetchImpl
    this.root = `projects/${projectId}/databases/(default)/documents`
    this.base = `https://firestore.googleapis.com/v1/${this.root}`
  }

  async token() {
    const cached = tokenCache.get(this.account.client_email)
    if (cached && cached.until > Date.now()) return cached.token
    const now = Math.floor(Date.now() / 1000)
    const assertion = await signJwt(
      { iss: this.account.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
      this.account.private_key,
    )
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.access_token) throw new Error(`Google token: ${data?.error_description ?? response.status}`)
    tokenCache.set(this.account.client_email, { token: data.access_token, until: Date.now() + (data.expires_in - 300) * 1000 })
    return data.access_token
  }

  async request(path, { method = 'POST', body, query = '' } = {}) {
    const response = await this.fetch(`${this.base}${path}${query}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => null)
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) {
      const error = new Error(`Firestore ${response.status}: ${data?.error?.message ?? ''}`)
      error.status = response.status
      throw error
    }
    return data
  }

  // Один документ { id, ...поля } или null. transaction — читать внутри транзакции.
  async get(collection, id, transaction) {
    const query = transaction ? `?transaction=${encodeURIComponent(transaction)}` : ''
    const doc = await this.request(`/${collection}/${encodeURIComponent(id)}`, { method: 'GET', query })
    return doc ? fromDocument(doc) : null
  }

  // Документы, где field <op> value. op: EQUAL, LESS_THAN, GREATER_THAN …
  // Только по одному полю — для этого Firestore не нужны дополнительные индексы.
  async where(collection, field, op, value, { limit = 500, transaction } = {}) {
    const structuredQuery = {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } },
      limit,
    }
    const rows = await this.request(':runQuery', { body: { structuredQuery, ...(transaction ? { transaction } : {}) } })
    return rows.filter((row) => row.document).map((row) => fromDocument(row.document))
  }

  // Записи для commit:
  //   set(collection, id, data, { mustNotExist })      — записать документ целиком;
  //   update(collection, id, data)                     — поменять только эти поля (документ должен быть);
  //   remove(collection, id)                           — удалить.
  set(collection, id, data, { mustNotExist = false } = {}) {
    return {
      update: { name: `${this.root}/${collection}/${id}`, fields: toFields(data) },
      ...(mustNotExist ? { currentDocument: { exists: false } } : {}),
    }
  }

  update(collection, id, data) {
    return {
      update: { name: `${this.root}/${collection}/${id}`, fields: toFields(data) },
      updateMask: { fieldPaths: Object.keys(data).map(quoteField) },
      currentDocument: { exists: true },
    }
  }

  remove(collection, id) {
    return { delete: `${this.root}/${collection}/${id}` }
  }

  commit(writes, transaction) {
    if (!writes.length && !transaction) return null
    return this.request(':commit', { body: { writes, ...(transaction ? { transaction } : {}) } })
  }

  // Транзакция: всё, что прочитано внутри, проверяется при записи. Если за это время кто-то
  // поменял те же документы (два человека бронируют последнюю вещь), Firestore отказывает —
  // и мы повторяем заново. work(tx) читает через tx и возвращает { writes, result }.
  async transaction(work, attempts = 5) {
    for (let attempt = 1; ; attempt++) {
      const { transaction } = await this.request(':beginTransaction', { body: {} })
      try {
        const { writes, result } = await work(transaction)
        await this.commit(writes, transaction)
        return result
      } catch (error) {
        // Отменяем транзакцию (если она уже закончилась — Firestore просто ответит ошибкой, это не страшно).
        await this.request(':rollback', { body: { transaction } }).catch(() => {})
        // 409 — кто-то успел поменять те же документы: пробуем ещё раз. Остальное — настоящая ошибка.
        if (error.status !== 409 || error.reason || attempt >= attempts) throw error
      }
    }
  }
}

// Имена полей с необычными знаками надо брать в `кавычки`. Наши — обычные, но на всякий случай.
const quoteField = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/[`\\]/g, '\\$&')}\``)

// --- Подпись для Google (JWT, RS256) ---
async function signJwt(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const unsigned = `${b64url(encoder.encode(JSON.stringify(header)))}.${b64url(encoder.encode(JSON.stringify(payload)))}`
  const der = Uint8Array.from(
    atob(
      privateKeyPem
        .replace(/\\n/g, '\n')
        .replace(/-----[^-]+-----/g, '')
        .replace(/\s+/g, ''),
    ),
    (c) => c.charCodeAt(0),
  )
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))
  return `${unsigned}.${b64url(signature)}`
}

function b64url(bytes) {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- Перевод из формата Firestore ({ stringValue: … }) в обычные данные и обратно ---
// Даты (Date) хранятся как настоящие даты Firestore, а читаются строкой ISO («2026-11-06T12:00:00Z»).

function fromDocument(document) {
  return { id: document.name.split('/').pop(), ...fromFields(document.fields ?? {}) }
}

function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]))
}

function fromValue(value) {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return new Date(value.timestampValue).toISOString()
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromValue)
  if ('mapValue' in value) return fromFields(value.mapValue.fields ?? {})
  return null
}

export function toFields(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toValue(value)]),
  )
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  return { mapValue: { fields: toFields(value) } }
}
