import { readCollection } from './firebase.js'
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

const CACHE_MS = 2 * 60 * 1000
let catalogCache = null
let catalogLoading = null

async function loadCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CACHE_MS) return catalogCache.data
  catalogLoading ??= Promise.all([
    readCollection('categories'),
    readCollection('shops', 'is_active', true),
    readCollection('products', 'is_active', true),
  ])
    .then(([categories, shops, products]) => {
      categories.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const shopsById = new Map(shops.map((shop) => [shop.id, shop]))
      const data = {
        categories,
        shops,
        shopsById,
        // Товары скрытого магазина не показываем. Сначала дешёвые.
        products: products
          .filter((product) => shopsById.has(product.shop_id))
          .map((product) => ({ ...product, variants: product.variants ?? [], photo_urls: product.photo_urls ?? [] }))
          .sort((a, b) => a.price - b.price),
      }
      catalogCache = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      catalogLoading = null
    })
  return catalogLoading
}

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
  const category = catalog.categories.find((c) => c.id === product.category_id)
  if (!category) return null
  return { ...product, category: categoryInfo(category), shop: catalog.shopsById.get(product.shop_id) }
}
