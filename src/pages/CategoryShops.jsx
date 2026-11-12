import { useEffect, useState } from 'react'
import { FilterSheet, SortSheet } from '../components/CategoryFilters.jsx'
import Icon from '../components/Icon.jsx'
import OpenStatus from '../components/OpenStatus.jsx'
import ProductRow from '../components/ProductRow.jsx'
import { artHTML, designFor } from '../components/showcaseArt.js'
import { fetchCategoryShops } from '../lib/catalog.js'
import { getChosenPalette } from '../lib/choices.js'
import { compareColors } from '../lib/colors.js'
import {
  countFilters,
  distanceKm,
  DISTRICTS,
  GENDERS,
  NO_FILTERS,
  priceRanges,
  productFits,
  readQuery,
  shopFits,
  writeQuery,
} from '../lib/filters.js'
import { useI18n } from '../lib/i18n.jsx'
import { resetPageColor, setPageColor } from '../lib/pageColor.js'
import { getUserLocation } from '../lib/platform.js'
import { Link, replaceSearch } from '../lib/router.jsx'
import { compareSizes } from '../lib/sizes.js'

// Место пользователя помним, пока открыт сайт: при возврате со страницы товара
// «Сначала ближе» работает сразу, без нового вопроса.
let rememberedLocation = null

// Страница категории: магазины, где есть вещи этой категории, и их товары.
// Сверху — «Фильтры», «Сортировка» и размеры. Фон — в цвете категории, выбранном на витрине.
export default function CategoryShops({ slug }) {
  const { language, t, formatPrice, formatDistance, plural } = useI18n()
  const [data, setData] = useState(null) // null — ещё загружаем
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Фильтры и сортировка — из адреса страницы, и при каждом изменении записываются обратно.
  const [query, setQueryState] = useState(() => readQuery(window.location.search))
  const [sheet, setSheet] = useState(null) // открытая шторка: 'filters', 'sort' или null
  const [location, setLocation] = useState(rememberedLocation)
  const [locating, setLocating] = useState(false)
  const [locationFailed, setLocationFailed] = useState(false)

  const setQuery = (change) => setQueryState((current) => ({ ...current, ...change }))

  useEffect(() => {
    replaceSearch(writeQuery(query))
  }, [query])

  useEffect(() => {
    let cancelled = false
    fetchCategoryShops(slug)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((error) => {
        console.error('Не удалось загрузить категорию:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  // Открыли страницу с «Сначала ближе» (например, обновили), а место ещё не знаем — спрашиваем.
  // Не получилось — показываем «Сначала дешёвые».
  const needLocation = query.sort === 'near' && !location
  useEffect(() => {
    if (!needLocation) return
    let cancelled = false
    getUserLocation().then((found) => {
      if (cancelled) return
      if (found) {
        rememberedLocation = found
        setLocation(found)
      } else {
        setQueryState((current) => ({ ...current, sort: 'cheap' }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [needLocation])

  const design = designFor(slug)
  const palette = design.palettes[getChosenPalette(slug)]

  useEffect(() => {
    setPageColor(palette.bg, palette.light)
    return resetPageColor
  }, [palette.bg, palette.light])

  function retry() {
    setFailed(false)
    setData(null)
    setAttempt((n) => n + 1)
  }

  async function chooseSort(sort) {
    setLocationFailed(false)
    if (sort !== 'near' || location) {
      setQuery({ sort })
      setSheet(null)
      return
    }
    setLocating(true)
    const found = await getUserLocation()
    setLocating(false)
    if (!found) {
      setLocationFailed(true)
      return
    }
    rememberedLocation = found
    setLocation(found)
    setQuery({ sort: 'near' })
    setSheet(null)
  }

  if (failed) {
    return (
      <div className="page-message" role="alert">
        <p>{t('common.error')}</p>
        <button type="button" className="primary-button" onClick={retry}>
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (!data) return <p className="page-message">{t('common.loading')}</p>

  if (!data.category) {
    return (
      <div className="page-message">
        <p>{t('category.notFound')}</p>
        <Link to="/" className="primary-button">
          {t('nav.home')}
        </Link>
      </div>
    )
  }

  const { category } = data
  const categoryName = category[`name_${language}`]
  const allProducts = data.shops.flatMap((entry) => entry.products)

  // Что вообще есть в категории — из этого собираются кнопки фильтров.
  const allSizes = [...new Set(allProducts.flatMap((p) => p.sizes))].sort(compareSizes)
  const prices = allProducts.filter((p) => p.inStock).map((p) => p.price)
  const options = {
    genders: GENDERS.filter((gender) => allProducts.some((p) => productFits(p, { ...NO_FILTERS, gender }))),
    lowest: prices.length ? Math.min(...prices) : null,
    highest: prices.length ? Math.max(...prices) : null,
    priceRanges: priceRanges(prices),
    colors: [...new Map(allProducts.flatMap((p) => p.colors).map((c) => [c.uz, c])).values()].sort((a, b) =>
      compareColors(a.uz, b.uz),
    ),
    brands: [...new Set(allProducts.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    districts: DISTRICTS.filter((d) => data.shops.some((entry) => entry.shop.district === d)).sort((a, b) =>
      t(`district.${a}`).localeCompare(t(`district.${b}`), language),
    ),
  }

  // Порядок: «Сначала ближе» — когда место известно, иначе пока «Сначала дешёвые».
  const sort = query.sort === 'near' && !location ? 'cheap' : query.sort
  const byPrice = sort === 'expensive' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price

  const shops = data.shops
    .filter((entry) => shopFits(entry.shop, query))
    .map((entry) => {
      const products = entry.products.filter((p) => productFits(p, query)).sort((a, b) => b.inStock - a.inStock || byPrice(a, b))
      const inStock = products.filter((p) => p.inStock).map((p) => p.price)
      const { latitude, longitude } = entry.shop
      return {
        ...entry,
        products,
        minPrice: inStock.length ? Math.min(...inStock) : null,
        maxPrice: inStock.length ? Math.max(...inStock) : null,
        distance:
          location && latitude != null && longitude != null
            ? distanceKm(location, { latitude: Number(latitude), longitude: Number(longitude) })
            : null,
      }
    })
    .filter((entry) => entry.products.length > 0)
    .sort((a, b) => {
      if (sort === 'near') return (a.distance ?? Infinity) - (b.distance ?? Infinity)
      if (sort === 'expensive') return (b.maxPrice ?? -Infinity) - (a.maxPrice ?? -Infinity)
      return (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity)
    })

  const withStock = shops.filter((entry) => entry.minPrice !== null)
  const minPrice = withStock.length ? Math.min(...withStock.map((entry) => entry.minPrice)) : null
  // «Дешевле всего» — магазину с самой низкой ценой, при любой сортировке.
  const cheapestId = withStock.length > 1 ? withStock.find((entry) => entry.minPrice === minPrice).shop.id : null
  const shownCount = shops.reduce((sum, entry) => sum + entry.products.length, 0)
  const filterCount = countFilters(query)

  const resetFilters = () => setQuery({ ...NO_FILTERS, size: query.size })

  return (
    <section className="cat">
      <header className="cat-hero">
        <div className="cat-hero-text">
          <h1 className="cat-title">{categoryName}</h1>
          {minPrice !== null && (
            <p className="cat-summary">
              {t('showcase.from', { price: formatPrice(minPrice) })} ·{' '}
              {t(`showcase.inShops.${plural(withStock.length)}`, { n: withStock.length })}
            </p>
          )}
        </div>
        <div
          className="cat-hero-art"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: artHTML(design, getChosenPalette(slug), categoryName, category.emoji) }}
        />
      </header>

      {data.shops.length > 0 && (
        <div className="cat-tools">
          <button type="button" className="tool-button" aria-haspopup="dialog" onClick={() => setSheet('filters')}>
            <Icon name="filter" />
            {t('filter.title')}
            {filterCount > 0 && <span className="tool-badge">{filterCount}</span>}
          </button>
          <button type="button" className="tool-button" aria-haspopup="dialog" onClick={() => setSheet('sort')}>
            <Icon name="sort" />
            {t(`sort.${sort}`)}
          </button>
        </div>
      )}

      {allSizes.length > 0 && (
        <div className="chip-row" role="group" aria-label={t('product.size')}>
          <button type="button" className="chip" aria-pressed={query.size === null} onClick={() => setQuery({ size: null })}>
            {t('filter.all')}
          </button>
          {allSizes.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={query.size === s}
              onClick={() => setQuery({ size: query.size === s ? null : s })}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {data.shops.length === 0 && <p className="page-message">{t('category.empty')}</p>}
      {data.shops.length > 0 && shops.length === 0 && (
        <div className="page-message">
          <p>{filterCount === 0 && query.size ? t('category.noSize', { size: query.size }) : t('filter.empty')}</p>
          {filterCount > 0 && (
            <button type="button" className="primary-button" onClick={resetFilters}>
              {t('filter.resetAll')}
            </button>
          )}
        </div>
      )}

      <div className="shop-list">
        {shops.map((entry) => (
          <ShopCard
            key={entry.shop.id}
            entry={entry}
            cheapest={entry.shop.id === cheapestId}
            distance={sort === 'near' && entry.distance !== null ? formatDistance(entry.distance) : null}
            category={category}
            query={query}
          />
        ))}
      </div>

      <FilterSheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        query={query}
        onChange={setQuery}
        onReset={resetFilters}
        options={options}
        count={shownCount}
      />
      <SortSheet
        open={sheet === 'sort'}
        onClose={() => {
          setSheet(null)
          setLocationFailed(false)
        }}
        sort={sort}
        onChoose={chooseSort}
        locating={locating}
        locationFailed={locationFailed}
      />
    </section>
  )
}

function ShopCard({ entry, cheapest, distance, category, query }) {
  const { language, t } = useI18n()
  const { shop, products } = entry
  const place = [shop[`landmark_${language}`], shop[`address_${language}`]].filter(Boolean).join(' · ')

  return (
    <article className="shop">
      <div className="shop-head">
        {/* Название магазина ведёт на его страницу со всеми товарами. */}
        <Link to={`/s/${shop.id}`} className="shop-title shop-link">
          <h2>{shop.name}</h2>
          <Icon name="chevron" />
        </Link>
        {cheapest && <span className="badge-cheapest">{t('shop.cheapest')}</span>}
      </div>
      {(place || distance) && (
        <p className="shop-place">
          <Icon name="pin" />
          <span>
            {distance && <b className="shop-distance">{distance}</b>}
            {distance && place && ' · '}
            {place}
          </span>
        </p>
      )}
      <OpenStatus opensAt={shop.opens_at} closesAt={shop.closes_at} />

      <ul className="product-list">
        {products.map((product) => {
          // Выбран цвет в фильтре — показываем товар в этом цвете и открываем его сразу в нём.
          const chosenColor = query.colors.length
            ? product.stock.find((v) => (!query.size || v.size === query.size) && query.colors.includes(v.color))?.color
            : null
          const params = new URLSearchParams()
          if (query.size) params.set('size', query.size)
          if (chosenColor) params.set('color', chosenColor)
          return (
            <ProductRow
              key={product.id}
              product={product}
              category={category}
              search={params.toString()}
              color={chosenColor ?? undefined}
            />
          )
        })}
      </ul>
    </article>
  )
}
