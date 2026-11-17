import { authHeader } from './auth.js'
import { asset } from './base.js'
import { readCollection, readDocument } from './firebase.js'
import { compareSizes } from './sizes.js'

// Все запросы к каталогу — здесь, чтобы экраны не обращались к базе напрямую.
//
// База — Firebase (Firestore), три коллекции:
//   categories — id = slug (sneakers …), названия uz/ru, эмодзи, порядок;
//   shops      — магазины (только is_active = true видны посетителям);
//   products   — товары (shop_id, category_id = slug категории) и внутри — variants
//                (id, размер, цвет uz/ru, количество).
// Пока товаров немного, загружаем весь каталог одним разом и запоминаем на 2 минуты,
// а нужное (категорию, магазин, товар) выбираем на телефоне. Когда товаров станут тысячи —
// перейти на запросы по частям.

// ---------- Проверка данных из базы ----------
// Правила базы не умеют проверить каждое поле магазина и товара, поэтому продавец (или ошибка в данных)
// может записать не тот тип: число вместо текста, текст вместо списка. Чтобы от одной такой записи
// не падала страница у всех покупателей, всё из базы приводится к ожидаемому виду, а совсем
// испорченные товары в каталог не попадают.
const text = (value, max = 500) => (typeof value === 'string' && value.trim() ? value.slice(0, max) : null)
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const PHOTO = /^(\/api\/photo\?id=[A-Za-z0-9_-]{10,200}|https:\/\/[^\s"'<>]{1,500})$/

export function safeCategory(category) {
  const id = String(category.id)
  return {
    ...category,
    id,
    slug: text(category.slug, 60) ?? id,
    name_uz: text(category.name_uz, 80) ?? text(category.name_ru, 80) ?? id,
    name_ru: text(category.name_ru, 80) ?? text(category.name_uz, 80) ?? id,
    emoji: text(category.emoji, 16),
    sort_order: number(category.sort_order) ?? 0,
  }
}

export function safeShop(shop) {
  const time = (value) => (typeof value === 'string' && TIME.test(value) ? value : null)
  const telegram = text(shop.telegram_username, 40)
  return {
    ...shop,
    id: String(shop.id),
    name: text(shop.name, 80) ?? '—',
    description_uz: text(shop.description_uz, 500),
    description_ru: text(shop.description_ru, 500),
    address_uz: text(shop.address_uz, 200),
    address_ru: text(shop.address_ru, 200),
    landmark_uz: text(shop.landmark_uz, 200),
    landmark_ru: text(shop.landmark_ru, 200),
    district: text(shop.district, 40),
    latitude: number(shop.latitude),
    longitude: number(shop.longitude),
    phone: text(shop.phone, 30),
    telegram_username: telegram && /^[A-Za-z0-9_]+$/.test(telegram) ? telegram : null,
    opens_at: time(shop.opens_at),
    closes_at: time(shop.closes_at),
    owner_uids: Array.isArray(shop.owner_uids) ? shop.owner_uids.filter((uid) => typeof uid === 'string') : [],
    subscription_until: typeof shop.subscription_until === 'string' ? shop.subscription_until : null,
  }
}

// strict — для каталога покупателей: товар без названия, цены, магазина или вариантов не показываем (null).
// Без strict (админка) — товар остаётся в списке, чтобы его можно было найти и удалить.
export function safeProduct(product, { strict = true } = {}) {
  const nameUz = text(product.name_uz, 120)
  const nameRu = text(product.name_ru, 120)
  const price = number(product.price)
  const variants = (Array.isArray(product.variants) ? product.variants : [])
    .filter((v) => v && typeof v === 'object' && typeof v.id === 'string' && v.id)
    .slice(0, 80)
    .map((v) => ({
      id: v.id,
      size: text(v.size, 20),
      color_uz: text(v.color_uz, 40),
      color_ru: text(v.color_ru, 40) ?? text(v.color_uz, 40),
      quantity: Number.isInteger(v.quantity) && v.quantity > 0 ? v.quantity : 0,
    }))
  const broken = typeof product.shop_id !== 'string' || typeof product.category_id !== 'string' || (!nameUz && !nameRu) || price === null || price < 0 || !variants.length
  if (broken && strict) return null
  return {
    ...product,
    id: String(product.id),
    shop_id: typeof product.shop_id === 'string' ? product.shop_id : '',
    category_id: typeof product.category_id === 'string' ? product.category_id : '',
    model_id: text(product.model_id, 100),
    name_uz: nameUz ?? nameRu ?? '—',
    name_ru: nameRu ?? nameUz ?? '—',
    description_uz: text(product.description_uz, 1000),
    description_ru: text(product.description_ru, 1000),
    brand: text(product.brand, 60),
    gender: text(product.gender, 20),
    price: price !== null && price >= 0 ? price : 0,
    is_active: product.is_active === true,
    photo_urls: (Array.isArray(product.photo_urls) ? product.photo_urls : []).filter((url) => typeof url === 'string' && PHOTO.test(url)).slice(0, 8),
    variants,
  }
}

// ---------- Откуда берётся каталог ----------
// 1) из памяти страницы и из памяти браузера (localStorage) — 10 минут после загрузки, без единого запроса;
// 2) с нашего сервера: GET /api/catalog — одна общая копия на всех посетителей (server/catalog.js),
//    чтения Firebase при этом не тратятся;
// 3) если сервер не ответил (нет ключа, сбой) — напрямую из Firebase, как раньше.
// Остатки в списках могут отставать на несколько минут; точный остаток страница товара берёт из базы
// (fetchProduct), а после своей брони или отмены копия правится на месте (patchStock).
const CACHE_MS = 10 * 60 * 1000
const BEHIND_MS = 20 * 1000 // сервер ещё не подхватил наши изменения — спросим снова через 20 секунд
const STORE_KEY = 'kt_catalog_v1'
let catalogCache = null // { at, ttl, data }
let catalogLoading = null
let signal = null // идёт сигнал серверу «каталог изменился»
let signalAt = 0 // время сервера, когда он принял наш последний сигнал

function readStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    const ok = saved && Date.now() - saved.savedAt < CACHE_MS && Date.now() >= saved.savedAt && Array.isArray(saved.raw?.products)
    return ok ? saved : null
  } catch {
    return null
  }
}

function writeStore(raw, savedAt = Date.now()) {
  try {
    const text = JSON.stringify({ savedAt, raw })
    // Очень большой каталог в память браузера не кладём (у неё предел около 5 МБ).
    if (text.length < 3_000_000) localStorage.setItem(STORE_KEY, text)
    else localStorage.removeItem(STORE_KEY)
  } catch {
    // память браузера недоступна или переполнена — работаем без неё
  }
}

async function fromServer() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(asset('/api/catalog'), { signal: controller.signal })
    if (!response.ok) throw new Error(`catalog ${response.status}`)
    const raw = await response.json()
    if (!Array.isArray(raw?.categories) || !Array.isArray(raw.shops) || !Array.isArray(raw.products)) throw new Error('catalog format')
    return raw
  } finally {
    clearTimeout(timer)
  }
}

async function fromFirestore() {
  const [categories, shops, products] = await Promise.all([
    readCollection('categories'),
    readCollection('shops', 'is_active', true),
    readCollection('products', 'is_active', true),
  ])
  return { at: Date.now(), categories, shops, products }
}

// Сырые данные из базы → каталог для страниц (проверенные записи, только открытые магазины, сначала дешёвые).
function build(raw) {
  const categories = raw.categories.map(safeCategory).sort((a, b) => a.sort_order - b.sort_order)
  const products = raw.products.map((product) => safeProduct(product)).filter(Boolean)
  // Подписка закончилась — магазин не показываем (сервер тоже скрывает его, это на всякий случай).
  const shops = raw.shops.map(safeShop).filter((shop) => !shop.subscription_until || Date.parse(shop.subscription_until) > Date.now())
  const shopsById = new Map(shops.map((shop) => [shop.id, shop]))
  return {
    categories,
    shops,
    shopsById,
    // Товары скрытого магазина не показываем. Сначала дешёвые.
    products: products
      .filter((product) => shopsById.has(product.shop_id))
      .map((product) => ({ ...product, photo_urls: product.photo_urls.map(photoSrc) }))
      .sort((a, b) => a.price - b.price),
  }
}

async function loadCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < catalogCache.ttl) return catalogCache.data
  catalogLoading ??= (async () => {
    if (signal) await signal // сначала сервер должен узнать, что каталог изменился
    const saved = readStore()
    let raw = saved?.raw
    let at = saved?.savedAt ?? Date.now()
    let ttl = CACHE_MS
    if (!raw) {
      raw = (await fromServer().catch(() => null)) ?? (await fromFirestore())
      at = Date.now()
      // Мы только что что-то поменяли, а сервер отдал копию старше этого — не запоминаем её надолго.
      if (signalAt && Number(raw.at) < signalAt) ttl = BEHIND_MS
      else writeStore(raw, at)
    }
    const data = build(raw)
    catalogCache = { at, ttl, data }
    return data
  })().finally(() => {
    catalogLoading = null
  })
  return catalogLoading
}

// После своей брони (delta < 0) или отмены (delta > 0) правим остаток в запомненном каталоге на месте —
// без повторной загрузки всего каталога.
export function patchStock(productId, variantId, delta) {
  const apply = (products) => {
    const variant = products?.find((p) => p.id === productId)?.variants?.find?.((v) => v.id === variantId)
    if (variant && Number.isInteger(variant.quantity)) variant.quantity = Math.max(0, variant.quantity + delta)
    return Boolean(variant)
  }
  if (catalogCache) apply(catalogCache.data.products)
  const saved = readStore()
  if (saved && apply(saved.raw.products)) writeStore(saved.raw, saved.savedAt)
}

// Фото из Telegram хранятся как «/api/photo?id=…» — адрес нашего сервера (с учётом BASE).
export const photoSrc = (url) => (url.startsWith('/api/') ? asset(url) : url)

// Категория без лишнего: id, slug, названия, эмодзи.
const categoryInfo = ({ id, slug, name_uz, name_ru, emoji, sort_order }) => ({ id, slug, name_uz, name_ru, emoji, sort_order })

// Категории в порядке sort_order (Футболки, Рубашки, …).
export async function fetchCategories() {
  return (await loadCatalog()).categories.map(categoryInfo)
}

// Категория и магазины, где есть её товары: { category, shops: [{ shop, products }] }.
// Если такой категории нет — category: null.
export async function fetchCategoryShops(slug) {
  const catalog = await loadCatalog()
  const category = catalog.categories.find((c) => c.slug === slug)
  if (!category) return { category: null, shops: [] }

  // Группируем товары по магазинам. Фильтры и порядок магазинов — на странице.
  const byShop = new Map()
  for (const product of catalog.products.filter((p) => p.category_id === category.id)) {
    const shop = catalog.shopsById.get(product.shop_id)
    if (!byShop.has(shop.id)) byShop.set(shop.id, { shop, products: [] })
    byShop.get(shop.id).products.push(withStock({ ...product, shop }))
  }
  return { category: categoryInfo(category), shops: [...byShop.values()] }
}

// Что из товара есть в наличии: размеры, цвета и их сочетания (stock).
function withStock(product) {
  const available = product.variants.filter((variant) => variant.quantity > 0)
  const colors = [...new Map(available.map((v) => [v.color_uz, { uz: v.color_uz, ru: v.color_ru }])).values()]
    .filter((color) => color.uz)
  return {
    ...product,
    inStock: available.length > 0,
    sizes: [...new Set(available.map((v) => v.size).filter(Boolean))],
    colors,
    stock: available.map((v) => ({ size: v.size, color: v.color_uz })),
  }
}

// Всё для поиска: категории, магазины и товары (с наличием).
export async function fetchSearchIndex() {
  const catalog = await loadCatalog()
  return {
    categories: catalog.categories.map(categoryInfo),
    shops: catalog.shops,
    products: catalog.products.map(withStock),
  }
}

// Магазин и все его товары (с категорией и наличием). Если магазина нет или он скрыт — null.
export async function fetchShop(id) {
  const catalog = await loadCatalog()
  const shop = catalog.shopsById.get(id)
  if (!shop) return null
  const products = catalog.products
    .filter((product) => product.shop_id === id)
    .map((product) => {
      const category = catalog.categories.find((c) => c.id === product.category_id)
      return withStock({ ...product, category: category ? categoryInfo(category) : null })
    })
    .filter((product) => product.category)
  return { shop, products }
}

// Данные для витрины на главной: по каждой категории — в скольких магазинах есть,
// от какой цены и какие размеры (по каждому размеру — магазины и цена).
export async function fetchShowcase() {
  const catalog = await loadCatalog()
  return catalog.categories.map((category) => ({
    category: categoryInfo(category),
    stats: summarize(catalog.products.filter((product) => product.category_id === category.id)),
  }))
}

function summarize(products) {
  const inStock = products.filter((product) => product.variants.some((variant) => variant.quantity > 0))
  const bySize = new Map() // размер → { shops, minPrice }
  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.size) continue
      if (!bySize.has(variant.size)) bySize.set(variant.size, { shops: new Set(), minPrice: Infinity })
      if (variant.quantity > 0) {
        const entry = bySize.get(variant.size)
        entry.shops.add(product.shop_id)
        entry.minPrice = Math.min(entry.minPrice, product.price)
      }
    }
  }
  return {
    shopCount: new Set(inStock.map((product) => product.shop_id)).size,
    minPrice: inStock.length ? Math.min(...inStock.map((product) => product.price)) : null,
    sizes: [...bySize.entries()]
      .sort(([a], [b]) => compareSizes(a, b))
      .map(([size, entry]) => ({ size, shopCount: entry.shops.size, minPrice: entry.shops.size ? entry.minPrice : null })),
  }
}

// Вариант товара (размер + цвет) по его номеру: куда вести, когда бронь начали на сайте,
// а продолжают в Telegram (ссылка t.me/KiyimTopBot?startapp=book__<номер варианта>).
// { productId, slug, variantId } или null, если такого варианта нет или он скрыт.
export async function fetchVariant(id) {
  const catalog = await loadCatalog()
  for (const product of catalog.products) {
    if (!product.variants.some((variant) => variant.id === id)) continue
    const category = catalog.categories.find((c) => c.id === product.category_id)
    return category ? { variantId: id, productId: product.id, slug: category.slug } : null
  }
  return null
}

// Один товар: категория, магазин и все варианты (размер, цвет, количество).
// Если товара нет или он скрыт — null.
export async function fetchProduct(id) {
  const catalog = await loadCatalog()
  const product = catalog.products.find((p) => p.id === id)
  if (!product) return null
  // Каталог может отставать на несколько минут, а здесь человек выбирает размер и бронирует —
  // поэтому цену и остатки этого одного товара берём прямо из базы (1 чтение).
  // База не ответила — показываем как в каталоге (бронь всё равно проверит остаток ещё раз).
  const live = await readDocument('products', id).catch(() => undefined)
  if (live === null) return null // товар удалён
  const fresh = live && live.is_active === true ? safeProduct(live) : null
  if (fresh) {
    product.price = fresh.price
    product.variants = fresh.variants
  }
  const category = catalog.categories.find((c) => c.id === product.category_id)
  if (!category) return null
  // Тот же товар в других магазинах (общий model_id): где ещё есть и почём. Сначала те, где есть в наличии, и дешёвые.
  const model = product.model_id ?? product.id
  const offers = catalog.products
    .filter((p) => p.id !== product.id && (p.model_id ?? p.id) === model)
    .map((p) => withStock({ ...p, shop: catalog.shopsById.get(p.shop_id) }))
    .sort((a, b) => b.inStock - a.inStock || a.price - b.price)
  return { ...product, category: categoryInfo(category), shop: catalog.shopsById.get(product.shop_id), offers }
}

// Корзина для показа: строки корзины + товар, вариант, магазин и категория из каталога.
// Строка без товара (скрыт, удалён, магазин закрылся) — missing: true; stock — сколько штук есть сейчас.
export async function fetchCartView(lines) {
  const catalog = await loadCatalog()
  return lines.map((line) => {
    const product = catalog.products.find((p) => p.id === line.product_id)
    const variant = product?.variants.find((v) => v.id === line.variant_id)
    const category = product && catalog.categories.find((c) => c.id === product.category_id)
    const shop = product && catalog.shopsById.get(product.shop_id)
    if (!product || !variant || !category || !shop) return { ...line, missing: true }
    return { ...line, product, variant, category: categoryInfo(category), shop, stock: variant.quantity ?? 0 }
  })
}

// Сбросить запомненный каталог после изменений продавца или админа (товар, магазин, категория) и сообщить
// серверу, что его общую копию пора перечитать. Покупательские действия (бронь, отмена) сюда не ходят —
// для них есть patchStock.
export function clearCatalogCache() {
  catalogCache = null
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    // память браузера недоступна
  }
  const sending = authHeader()
    .then((authorization) => (authorization ? fetch(asset('/api/catalog'), { method: 'POST', headers: { Authorization: authorization } }) : null))
    .then(async (response) => {
      const answer = response?.ok ? await response.json().catch(() => null) : null
      if (answer?.at) signalAt = answer.at
    })
    .catch(() => {})
    .finally(() => {
      if (signal === sending) signal = null
    })
  signal = sending
}
