// Подключение к базе Firebase (Firestore) — напрямую через интернет-адрес Firestore,
// без отдельной библиотеки. Номер проекта и публичный ключ берутся из настроек
// (.env на компьютере или Variables на GitHub) — в коде их нет.
// Если настроек нет, isConfigured = false, и сайт покажет понятное сообщение вместо поломки.
// Какие данные можно читать, решают правила доступа в Firebase (файл firebase/firestore.rules).

import { appCheckConfigured, appCheckToken } from './fb.js'

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY

export const isConfigured = Boolean(projectId)

const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const withKey = (url) => (apiKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}` : url)

// token — пропуск App Check («запрос с настоящего сайта», см. lib/fb.js); без него — обычный запрос.
function send(path, body, token) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Firebase-AppCheck': token } : {}) }
  return fetch(withKey(`${BASE}${path}`), {
    method: body ? 'POST' : 'GET',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function request(path, body) {
  if (!isConfigured) throw new Error('Firebase не настроен: нет VITE_FIREBASE_PROJECT_ID')
  // Если App Check настроен — недолго ждём пропуск (после первого раза он запомнен и приходит сразу).
  let token = await appCheckToken(2500)
  let response
  try {
    response = await send(path, body, token)
  } catch (error) {
    // Запрос с пропуском не ушёл совсем — пробуем без него (пока проверка в Firebase не обязательная, этого хватит).
    if (!token) throw error
    token = null
    response = await send(path, body, null)
  }
  // База отказала, а пропуска не было (не успел) — дожидаемся его и повторяем один раз.
  if (!token && appCheckConfigured && (response.status === 401 || response.status === 403)) {
    token = await appCheckToken(15000)
    if (token) response = await send(path, body, token)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `Firestore ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

// Все документы коллекции, у которых поле field = value (например, is_active = true).
// Без условия — все документы (правила доступа должны это разрешать).
export async function readCollection(collection, field, value) {
  const structuredQuery = { from: [{ collectionId: collection }], limit: 10000 }
  if (field) {
    structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } }
  }
  const rows = await request(':runQuery', { structuredQuery })
  return rows.filter((row) => row.document).map((row) => fromDocument(row.document))
}

// Один документ по номеру. null — такого документа нет.
export async function readDocument(collection, id) {
  try {
    return fromDocument(await request(`/${collection}/${encodeURIComponent(id)}`))
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// --- Перевод из формата Firestore ({ stringValue: … }) в обычные данные (и значение для условия where) ---

function fromDocument(document) {
  const data = fromFields(document.fields ?? {})
  return { id: data.id ?? document.name.split('/').pop(), ...data }
}

function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]))
}

function fromValue(value) {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromValue)
  if ('mapValue' in value) return fromFields(value.mapValue.fields ?? {})
  return null
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  return { mapValue: { fields: toFields(value) } }
}
