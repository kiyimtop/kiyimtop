import { openStatus } from './hours.js'

// Фильтры и сортировка на странице категории.
// Выбор хранится в адресе страницы (например /c/sneakers?gender=men&sort=expensive):
// при возврате со страницы товара всё остаётся как было, а ссылкой можно поделиться.

export const SORTS = ['cheap', 'expensive', 'near']
export const GENDERS = ['men', 'women', 'kids']

// 12 районов Ташкента — поле district у магазина в базе.
// Названия на узбекском и русском — в переводах: district.<имя>.
export const DISTRICTS = [
  'bektemir', 'chilonzor', 'mirobod', 'mirzo-ulugbek', 'olmazor', 'sergeli',
  'shayxontohur', 'uchtepa', 'yakkasaroy', 'yangihayot', 'yashnobod', 'yunusobod',
]

export const NO_FILTERS = {
  size: null,
  gender: null,
  min: null,
  max: null,
  colors: [],
  brands: [],
  districts: [],
  openNow: false,
}

// Адрес → выбранные фильтры и сортировка.
export function readQuery(search) {
  const params = new URLSearchParams(search)
  const amount = (key) => {
    const value = Number(params.get(key))
    return params.get(key) && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
  }
  return {
    size: params.get('size') || null,
    gender: GENDERS.includes(params.get('gender')) ? params.get('gender') : null,
    min: amount('min'),
    max: amount('max'),
    colors: params.getAll('color'),
    brands: params.getAll('brand'),
    districts: params.getAll('district').filter((d) => DISTRICTS.includes(d)),
    openNow: params.get('open') === '1',
    sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'cheap',
  }
}

// Выбранные фильтры и сортировка → часть адреса после «?» (пустые не пишем).
export function writeQuery(query) {
  const params = new URLSearchParams()
  if (query.size) params.set('size', query.size)
  if (query.gender) params.set('gender', query.gender)
  if (query.min !== null) params.set('min', query.min)
  if (query.max !== null) params.set('max', query.max)
  query.colors.forEach((color) => params.append('color', color))
  query.brands.forEach((brand) => params.append('brand', brand))
  query.districts.forEach((district) => params.append('district', district))
  if (query.openNow) params.set('open', '1')
  if (query.sort !== 'cheap') params.set('sort', query.sort)
  return params.toString()
}

// Сколько групп фильтров в шторке выбрано (цифра на кнопке «Фильтры»). Размер — отдельно, на странице.
export function countFilters(query) {
  return [
    query.gender,
    query.min !== null || query.max !== null,
    query.colors.length,
    query.brands.length,
    query.districts.length,
    query.openNow,
  ].filter(Boolean).length
}

// Подходит ли товар. «Унисекс» подходит и мужчинам, и женщинам.
// Размер и цвет проверяем вместе: нужен вариант в наличии именно этого размера и цвета.
export function productFits(product, query) {
  if (query.gender && product.gender !== query.gender && !(query.gender !== 'kids' && product.gender === 'unisex')) {
    return false
  }
  if (query.min !== null && product.price < query.min) return false
  if (query.max !== null && product.price > query.max) return false
  if (query.brands.length && !query.brands.includes(product.brand)) return false
  if (query.size || query.colors.length) {
    return product.stock.some(
      (variant) =>
        (!query.size || variant.size === query.size) && (!query.colors.length || query.colors.includes(variant.color)),
    )
  }
  return true
}

// Подходит ли магазин: район и «открыто сейчас» (по ташкентскому времени).
export function shopFits(shop, query) {
  if (query.districts.length && !query.districts.includes(shop.district)) return false
  if (query.openNow && !openStatus(shop.opens_at, shop.closes_at)?.open) return false
  return true
}

// Быстрые кнопки цены для категории: «до …», «… – …», «от …» — делят товары примерно на три части.
// Границы круглые (по 1 000, 5 000, 10 000, 50 000 … сумов) — смотря насколько цены отличаются.
export function priceRanges(prices) {
  if (prices.length < 3) return []
  const sorted = [...prices].sort((a, b) => a - b)
  const spread = sorted[sorted.length - 1] - sorted[0]
  const steps = [100_000, 50_000, 10_000, 5_000, 1_000]
  const step = steps.find((s) => s <= spread / 4) ?? 1_000
  const round = (value) => Math.max(step, Math.round(value / step) * step)
  const low = round(sorted[Math.floor(sorted.length / 3)])
  const high = round(sorted[Math.floor((sorted.length * 2) / 3)])
  if (low >= high) return []
  const ranges = [{ min: null, max: low }, { min: low, max: high }, { min: high, max: null }]
  // Только кнопки, по которым что-то найдётся, и не все товары сразу.
  return ranges.filter((range) => {
    const found = sorted.filter((p) => (range.min === null || p >= range.min) && (range.max === null || p <= range.max))
    return found.length > 0 && found.length < sorted.length
  })
}

// Расстояние по прямой между двумя точками на карте, в километрах.
export function distanceKm(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180
  const dLat = radians(to.latitude - from.latitude)
  const dLon = radians(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
