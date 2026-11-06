import { compareSizes } from './sizes.js'
import { supabase } from './supabase.js'

// Все запросы к каталогу — здесь, чтобы экраны не обращались к базе напрямую.

function database() {
  if (!supabase) {
    throw new Error('Supabase не настроен: нет VITE_SUPABASE_URL или VITE_SUPABASE_PUBLISHABLE_KEY')
  }
  return supabase
}

// Категории в порядке sort_order (Футболки, Рубашки, …).
// Запоминаем список, чтобы при возврате на главную он появлялся сразу.
let categoriesCache = null

export async function fetchCategories() {
  if (categoriesCache) return categoriesCache
  const { data, error } = await database()
    .from('categories')
    .select('id, slug, name_uz, name_ru, emoji')
    .order('sort_order')
  if (error) throw error
  categoriesCache = data
  return data
}

// Категория и магазины, где есть её товары: { category, shops: [{ shop, products }] }.
// Если такой категории нет — category: null.
// Скрытые товары и неактивные магазины база сама не отдаёт (правила доступа).
export async function fetchCategoryShops(slug) {
  const { data: category, error: categoryError } = await database()
    .from('categories')
    .select('id, slug, name_uz, name_ru, emoji')
    .eq('slug', slug)
    .maybeSingle()
  if (categoryError) throw categoryError
  if (!category) return { category: null, shops: [] }

  const query = (withDistrict) =>
    database()
      .from('products')
      .select(
        `id, name_uz, name_ru, brand, gender, price, photo_urls,
         shop:shops (id, name, address_uz, address_ru, landmark_uz, landmark_ru, ${withDistrict ? 'district,' : ''}
                     latitude, longitude, opens_at, closes_at),
         variants:product_variants (size, color_uz, color_ru, quantity)`,
      )
      .eq('category_id', category.id)
      .order('price')
  let { data: products, error } = await query(true)
  // В базе ещё нет поля «район» (не запущен файл …_shop_district.sql) — показываем без него,
  // просто без фильтра «Район». Код 42703 — «такого поля нет».
  if (error?.code === '42703') {
    console.warn('В базе нет поля shops.district — запустите supabase/migrations/20261103120000_shop_district.sql')
    ;({ data: products, error } = await query(false))
  }
  if (error) throw error

  // Группируем товары по магазинам. Фильтры и порядок магазинов — на странице.
  const byShop = new Map()
  for (const product of products) {
    if (!byShop.has(product.shop.id)) byShop.set(product.shop.id, { shop: product.shop, products: [] })
    byShop.get(product.shop.id).products.push(withStock(product))
  }

  return { category, shops: [...byShop.values()] }
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

// Всё для поиска: категории, магазины и товары (с наличием). Запоминаем на 2 минуты.
// Когда товаров станет много (тысячи), поиск лучше перенести в базу.
let searchCache = null

export async function fetchSearchIndex() {
  if (searchCache && Date.now() - searchCache.at < 2 * 60 * 1000) return searchCache.data
  const [categories, shops, products] = await Promise.all([
    fetchCategories(),
    database()
      .from('shops')
      .select('id, name, address_uz, address_ru, landmark_uz, landmark_ru, district, opens_at, closes_at'),
    database()
      .from('products')
      .select(
        `id, shop_id, category_id, name_uz, name_ru, brand, price, photo_urls,
         variants:product_variants (size, color_uz, color_ru, quantity)`,
      ),
  ])
  if (shops.error) throw shops.error
  if (products.error) throw products.error
  const data = { categories, shops: shops.data, products: products.data.map(withStock) }
  searchCache = { at: Date.now(), data }
  return data
}

// Магазин и все его товары (с категорией и наличием). Если магазина нет или он скрыт — null.
export async function fetchShop(id) {
  if (!UUID.test(id)) return null
  const { data, error } = await database()
    .from('shops')
    .select(
      `id, name, description_uz, description_ru, address_uz, address_ru, landmark_uz, landmark_ru,
       district, latitude, longitude, phone, telegram_username, opens_at, closes_at,
       products (id, name_uz, name_ru, brand, price, photo_urls,
                 category:categories (id, slug, name_uz, name_ru, emoji, sort_order),
                 variants:product_variants (size, color_uz, color_ru, quantity))`,
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { products, ...shop } = data
  return { shop, products: products.map(withStock) }
}

// Данные для витрины на главной: по каждой категории — в скольких магазинах есть,
// от какой цены и какие размеры (по каждому размеру — магазины и цена).
// Запоминаем на 2 минуты, чтобы при возврате на главную витрина появлялась сразу.
let showcaseCache = null

export async function fetchShowcase() {
  if (showcaseCache && Date.now() - showcaseCache.at < 2 * 60 * 1000) return showcaseCache.data
  const categories = await fetchCategories()
  const { data: products, error } = await database()
    .from('products')
    .select('category_id, shop_id, price, variants:product_variants (size, quantity)')
  if (error) throw error
  const data = categories.map((category) => ({
    category,
    stats: summarize(products.filter((product) => product.category_id === category.id)),
  }))
  showcaseCache = { at: Date.now(), data }
  return data
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
  if (!UUID.test(id)) return null
  const { data, error } = await database()
    .from('product_variants')
    .select('id, product:products (id, category:categories (slug))')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data?.product?.category) return null
  return { variantId: data.id, productId: data.product.id, slug: data.product.category.slug }
}

// Номер товара — это uuid. Если в адресе что-то другое, товара точно нет (и базу не спрашиваем).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Один товар: категория, магазин и все варианты (размер, цвет, количество).
// Если товара нет или он скрыт — null.
export async function fetchProduct(id) {
  if (!UUID.test(id)) return null
  const { data, error } = await database()
    .from('products')
    .select(
      `id, name_uz, name_ru, description_uz, description_ru, brand, gender, price, photo_urls,
       category:categories (slug, name_uz, name_ru, emoji),
       shop:shops (id, name, address_uz, address_ru, landmark_uz, landmark_ru,
                   latitude, longitude, phone, telegram_username, opens_at, closes_at),
       variants:product_variants (id, size, color_uz, color_ru, quantity)`,
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}
