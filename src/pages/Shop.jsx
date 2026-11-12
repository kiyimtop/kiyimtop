import { useEffect, useState } from 'react'
import ProductRow from '../components/ProductRow.jsx'
import ShopInfo from '../components/ShopInfo.jsx'
import { fetchShop } from '../lib/catalog.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link, replaceSearch } from '../lib/router.jsx'

// Страница магазина: название, описание, адрес, часы, звонок, карта —
// и все его товары по категориям. Кнопки сверху показывают одну категорию (?c=sneakers).
export default function Shop({ id }) {
  const { language, t } = useI18n()
  const [data, setData] = useState(undefined) // undefined — загружаем, null — магазина нет
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [only, setOnly] = useState(() => new URLSearchParams(window.location.search).get('c'))

  useEffect(() => {
    let cancelled = false
    fetchShop(id)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((error) => {
        console.error('Не удалось загрузить магазин:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  useEffect(() => {
    replaceSearch(only ? new URLSearchParams({ c: only }).toString() : '')
  }, [only])

  function retry() {
    setFailed(false)
    setData(undefined)
    setAttempt((n) => n + 1)
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

  if (data === undefined) return <p className="page-message">{t('common.loading')}</p>

  if (data === null) {
    return (
      <div className="page-message">
        <p>{t('shop.notFound')}</p>
        <Link to="/" className="primary-button">
          {t('nav.home')}
        </Link>
      </div>
    )
  }

  const { shop, products } = data

  // Товары по категориям (в порядке категорий), внутри — сначала в наличии, потом дешевле.
  const groups = new Map()
  for (const product of products) {
    const key = product.category.slug
    if (!groups.has(key)) groups.set(key, { category: product.category, products: [] })
    groups.get(key).products.push(product)
  }
  const sections = [...groups.values()].sort((a, b) => a.category.sort_order - b.category.sort_order)
  for (const section of sections) section.products.sort((a, b) => b.inStock - a.inStock || a.price - b.price)
  // Если в адресе категория, которой у магазина нет, — показываем все.
  const active = sections.some((section) => section.category.slug === only) ? only : null
  const shown = sections.filter((section) => !active || section.category.slug === active)

  return (
    <section className="shop-page">
      <header className="shop-page-hero">
        <h1 className="shop-page-title">{shop.name}</h1>
        {shop[`description_${language}`] && <p className="shop-page-description">{shop[`description_${language}`]}</p>}
      </header>

      <div className="shop shop-page-info">
        <ShopInfo shop={shop} />
      </div>

      {sections.length === 0 && <p className="page-message">{t('shop.empty')}</p>}

      {sections.length > 1 && (
        <div className="chip-row" role="group" aria-label={t('categories.title')}>
          <button type="button" className="chip" aria-pressed={!active} onClick={() => setOnly(null)}>
            {t('filter.all')}
          </button>
          {sections.map(({ category }) => (
            <button
              key={category.slug}
              type="button"
              className="chip"
              aria-pressed={active === category.slug}
              onClick={() => setOnly(active === category.slug ? null : category.slug)}
            >
              <span aria-hidden="true">{category.emoji}</span> {category[`name_${language}`]}
            </button>
          ))}
        </div>
      )}

      {shown.map(({ category, products: list }) => (
        <section key={category.slug} className="shop-section">
          <h2 className="shop-section-title">
            <Link to={`/c/${category.slug}`}>{category[`name_${language}`]}</Link>{' '}
            <span className="search-count">{list.length}</span>
          </h2>
          <div className="shop">
            <ul className="product-list">
              {list.map((product) => (
                <ProductRow key={product.id} product={product} category={category} />
              ))}
            </ul>
          </div>
        </section>
      ))}
    </section>
  )
}
