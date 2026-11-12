// Подключение к базе Firebase (Firestore) — напрямую через интернет-адрес Firestore,
// без отдельной библиотеки. Номер проекта и публичный ключ берутся из настроек
// (.env на компьютере или Variables на GitHub) — в коде их нет.
// Если настроек нет, isConfigured = false, и сайт покажет понятное сообщение вместо поломки.
// Какие данные можно читать, решают правила доступа в Firebase (файл firebase/firestore.rules).

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY

export const isConfigured = Boolean(projectId)

const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
const withKey = (url) => (apiKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}` : url)

async function request(path, body) {
  if (!isConfigured) throw new Error('Firebase не настроен: нет VITE_FIREBASE_PROJECT_ID')
  const response = await fetch(withKey(`${BASE}${path}`), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
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
