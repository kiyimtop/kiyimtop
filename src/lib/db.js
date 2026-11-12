import { loadFirebase } from './fb.js'

// Короткие помощники для базы Firestore (вместо прежних запросов к серверу).
// Всё, что приходит из базы, переводится в обычные данные: даты — в текст ISO ('2026-11-12T10:00:00.000Z'),
// как раньше отдавал сервер, поэтому экраны работают по-старому.
// Ошибки — с кодом для экрана: forbidden (правила не пустили), network, server.

export async function fire() {
  const loaded = await loadFirebase()
  if (!loaded) throw codeError('not_configured')
  return loaded
}

export const codeError = (code) => Object.assign(new Error(code), { code })

// Ошибка Firebase → наш код.
export function toCode(error) {
  // Наши коды — слова через «_» (sold_out); у Firebase — через «-» (permission-denied).
  if (/^[a-z_]+$/.test(String(error?.code ?? '')) && !['unavailable', 'aborted', 'cancelled'].includes(error.code)) return error
  const raw = String(error?.code ?? '').replace(/^firestore\//, '')
  const map = { 'permission-denied': 'forbidden', unavailable: 'network', 'not-found': 'not_found', aborted: 'busy', 'resource-exhausted': 'too_many' }
  if (!(raw in map)) console.error('Ошибка базы:', error)
  return codeError(map[raw] ?? 'server')
}

// Любое значение из базы → обычное (Timestamp → ISO-текст, вложенные объекты и списки — тоже).
export function plain(value) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  return value
}

export const fromSnap = (snap) => (snap.exists() ? { id: snap.id, ...plain(snap.data()) } : null)

// Выполнить работу с базой; ошибки — в наши коды.
export async function withDb(work) {
  const f = await fire()
  try {
    return await work(f.db, f.fs, f.auth)
  } catch (error) {
    throw toCode(error)
  }
}

// Один документ или null.
export const getOne = (collection, id) => withDb(async (db, fs) => fromSnap(await fs.getDoc(fs.doc(db, collection, id))))

// Документы по условиям: list('products', ['shop_id', '==', id]). Без условий — вся коллекция (до max).
export const list = (collection, ...conditions) =>
  withDb(async (db, fs) => {
    const max = typeof conditions[conditions.length - 1] === 'number' ? conditions.pop() : 5000
    const q = fs.query(fs.collection(db, collection), ...conditions.map(([f, op, v]) => fs.where(f, op, v)), fs.limit(max))
    return (await fs.getDocs(q)).docs.map(fromSnap)
  })

// Новый номер документа (как у Firestore: 20 букв и цифр).
export const newId = () => withDb(async (db, fs) => fs.doc(fs.collection(db, '_')).id)
