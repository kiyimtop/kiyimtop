// Общая копия каталога для всех посетителей: GET /api/catalog.
//
// Зачем. Раньше каждый посетитель сам читал из Firebase все категории, магазины и товары — 300 товаров
// = 300+ «чтений» на одно открытие сайта, и бесплатный дневной лимит (50 000) заканчивался на ~150 открытиях.
// Теперь базу читает сервер, держит копию в памяти и раздаёт её всем: расход чтений почти не зависит
// от числа посетителей.
//
// Когда копия перечитывается из базы:
//   • раз в час (для большого каталога реже) — в любом случае: так подтягиваются остатки после броней
//     и окончание подписок;
//   • когда продавец или админ что-то поменял: сайт присылает сигнал POST /api/catalog, сервер ставит
//     отметку времени в базе (server_state/catalog). Каждая копия сервера раз в 3 минуты сверяется
//     с этой отметкой (1 чтение) и, если она новее копии, перечитывает каталог.
//     Поэтому изменения продавца видны в каталоге в течение ~3 минут.
// Точный остаток вещи страница товара берёт напрямую из базы (1 чтение), а бронь проверяет его ещё раз.
//
// Нет ключа сервера (FIREBASE_SERVICE_ACCOUNT) — ответ 503, и сайт читает базу сам, как раньше.
import { accountContext, wrap } from './accounts.js'
import { firestoreFromEnv } from './firestore.js'

// Полное перечитывание — раз в час. Если каталог большой (больше ~500 записей), то реже: по 7 секунд
// на запись (2000 товаров — раз в ~4 часа). Так плановое перечитывание стоит не больше ~12 000 чтений
// в сутки при любом размере каталога.
const FULL_MS = 60 * 60 * 1000
const fullMs = (count) => Math.max(FULL_MS, count * 7000)
// Сверка с отметкой «каталог изменился» — не чаще раза в 3 минуты. Это же и предел: базу целиком
// сервер перечитывает не чаще раза в 3 минуты, как бы часто ни приходили сигналы и посетители.
const CHECK_MS = 3 * 60 * 1000

let copy = null // { at, count, body } — at: когда начали читать базу, count: сколько записей прочитано
let checkedAt = 0
let loading = null

// Для проверок: начать «с чистого листа».
export function resetCatalogCopy() {
  copy = null
  checkedAt = 0
  loading = null
}

// Что видят посетители. Владельцы магазина (owner_uids) и служебные поля наружу не отдаются.
const SHOP_FIELDS = ['id', 'name', 'description_uz', 'description_ru', 'address_uz', 'address_ru', 'landmark_uz', 'landmark_ru', 'district',
  'latitude', 'longitude', 'phone', 'telegram_username', 'opens_at', 'closes_at', 'subscription_until', 'is_active']
const PRODUCT_HIDDEN = ['hold_ref', 'hold_op', 'hold_idx']
const publicShop = (shop) => Object.fromEntries(SHOP_FIELDS.filter((key) => key in shop).map((key) => [key, shop[key]]))
const publicProduct = (product) => Object.fromEntries(Object.entries(product).filter(([key]) => !PRODUCT_HIDDEN.includes(key)))

async function readAll(db) {
  const at = Date.now()
  const [categories, shops, products] = await Promise.all([
    db.all('categories', { limit: 500 }),
    db.where('shops', 'is_active', 'EQUAL', true, { limit: 2000 }),
    db.where('products', 'is_active', 'EQUAL', true, { limit: 10000 }),
  ])
  const count = categories.length + shops.length + products.length
  return { at, count, body: JSON.stringify({ at, categories, shops: shops.map(publicShop), products: products.map(publicProduct) }) }
}

async function current(db) {
  const now = Date.now()
  if (copy && now - checkedAt < CHECK_MS) return copy
  loading ??= (async () => {
    let stale = !copy || now - copy.at >= fullMs(copy.count)
    if (!stale) {
      const mark = await db.get('server_state', 'catalog')
      stale = Boolean(mark?.changed_at && Date.parse(mark.changed_at) > copy.at)
    }
    if (stale) copy = await readAll(db)
    checkedAt = Date.now()
    return copy
  })().finally(() => {
    loading = null
  })
  try {
    return await loading
  } catch (error) {
    // База не ответила — лучше старая копия, чем пустой сайт. Следующая попытка — через полминуты.
    console.error('catalog:', error)
    if (!copy) throw error
    checkedAt = Date.now() - CHECK_MS + 30 * 1000
    return copy
  }
}

// POST — «каталог изменился» (товар, магазин, категория). Только продавец, владелец магазина, модератор или админ.
const signal = wrap(async (req) => {
  const { db, user, uid, admin } = await accountContext(req, { needBot: false })
  let allowed = admin || user.role === 'seller'
  if (!allowed) allowed = (await db.where('shops', 'owner_uids', 'ARRAY_CONTAINS', uid, { limit: 1 })).length > 0
  if (!allowed) return { status: 403, json: { error: 'forbidden' } }
  const at = Date.now()
  await db.commit([db.set('server_state', 'catalog', { changed_at: new Date(at), by: uid })])
  return { status: 200, json: { ok: true, at } }
})

export async function catalog(req) {
  if (req.method === 'POST') return signal(req)
  if (req.method !== 'GET') return { status: 405, json: { error: 'method' } }
  const db = firestoreFromEnv(req.env)
  if (!db) return { status: 503, json: { error: 'not_configured' } }
  const { body } = await current(db)
  return {
    response: new Response(body, {
      status: 200,
      // Копию хранит сервер и сам сайт (на 10 минут); браузеру отдельно запоминать ответ не нужно.
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    }),
  }
}
