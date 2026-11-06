import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import OpenStatus from '../components/OpenStatus.jsx'
import ProductRow from '../components/ProductRow.jsx'
import { fetchSearchIndex } from '../lib/catalog.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link, replaceSearch } from '../lib/router.jsx'
import { buildIndex, searchCatalog } from '../lib/search.js'

// Сколько товаров показываем сразу (остальные — «уточните запрос»).
const MAX_PRODUCTS = 40

// Поиск: категории, магазины и товары на узбекском и русском (лупа в шапке).
// Запрос хранится в адресе (/search?q=krossovka) — при возврате с товара результаты на месте.
export default function Search() {
  const { language, t } = useI18n()
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchSearchIndex()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((error) => {
        console.error('Не удалось загрузить данные для поиска:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    replaceSearch(query.trim() ? new URLSearchParams({ q: query }).toString() : '')
  }, [query])

  // Сразу ставим курсор в поле (на телефоне откроется клавиатура) — но не при возврате к результатам.
  useEffect(() => {
    if (!query) inputRef.current?.focus()
  }, []) // только при открытии страницы

  const index = useMemo(() => (data ? buildIndex(data) : null), [data])
  const results = index ? searchCatalog(index, query) : null
  const total = results ? results.categories.length + results.shops.length + results.products.length : 0

  function retry() {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  return (
    <section className="search">
      <h1 className="search-title">{t('search.title')}</h1>
      <form
        className="search-box"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          inputRef.current?.blur() // «Найти» на клавиатуре телефона — прячем клавиатуру
        }}
      >
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={t('search.title')}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label={t('search.clear')}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </form>

      {failed && (
        <div className="page-message" role="alert">
          <p>{t('common.error')}</p>
          <button type="button" className="primary-button" onClick={retry}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!failed && !data && query.trim() && <p className="page-message">{t('common.loading')}</p>}

      {/* Пока ничего не ввели — подсказка и все категории. */}
      {!failed && !results && (
        <>
          <p className="search-hint">{t('search.hint')}</p>
          {data && (
            <div className="chip-wrap">
              {data.categories.map((category) => (
                <Link key={category.id} to={`/c/${category.slug}`} className="chip">
                  <span aria-hidden="true">{category.emoji}</span> {category[`name_${language}`]}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {results && total === 0 && (
        <p className="page-message" role="status">
          {t('search.nothing', { q: query.trim() })}
        </p>
      )}

      {results && results.categories.length > 0 && (
        <SearchGroup title={t('search.categories')} count={results.categories.length}>
          <div className="chip-wrap">
            {results.categories.map((category) => (
              <Link key={category.id} to={`/c/${category.slug}`} className="chip">
                <span aria-hidden="true">{category.emoji}</span> {category[`name_${language}`]}
              </Link>
            ))}
          </div>
        </SearchGroup>
      )}

      {results && results.shops.length > 0 && (
        <SearchGroup title={t('search.shops')} count={results.shops.length}>
          <ul className="search-shops">
            {results.shops.map((shop) => (
              <li key={shop.id}>
                <Link to={`/s/${shop.id}`} className="search-shop">
                  <span className="search-shop-text">
                    <span className="shop-title">{shop.name}</span>
                    <span className="search-shop-place">
                      {[shop[`landmark_${language}`], shop[`address_${language}`]].filter(Boolean).join(' · ')}
                    </span>
                    <OpenStatus opensAt={shop.opens_at} closesAt={shop.closes_at} />
                  </span>
                  <Icon name="chevron" className="icon product-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </SearchGroup>
      )}

      {results && results.products.length > 0 && (
        <SearchGroup title={t('search.products')} count={results.products.length}>
          <div className="shop">
            <ul className="product-list">
              {results.products.slice(0, MAX_PRODUCTS).map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  category={product.category}
                  color={product.matchedColor ?? undefined}
                  search={product.matchedColor ? new URLSearchParams({ color: product.matchedColor }).toString() : ''}
                  note={product.shop.name}
                />
              ))}
            </ul>
          </div>
          {results.products.length > MAX_PRODUCTS && (
            <p className="search-hint">
              {t('search.more', { n: MAX_PRODUCTS, total: results.products.length })}
            </p>
          )}
        </SearchGroup>
      )}
    </section>
  )
}

function SearchGroup({ title, count, children }) {
  return (
    <section className="search-group">
      <h2 className="search-group-title">
        {title} <span className="search-count">{count}</span>
      </h2>
      {children}
    </section>
  )
}
