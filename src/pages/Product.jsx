import { useEffect, useState } from 'react'
import BookingSheet from '../components/BookingSheet.jsx'
import Icon from '../components/Icon.jsx'
import ShopInfo from '../components/ShopInfo.jsx'
import { designFor, itemHTML } from '../components/showcaseArt.js'
import { fetchProduct } from '../lib/catalog.js'
import { getChosenPalette } from '../lib/choices.js'
import { colorHex } from '../lib/colors.js'
import { useI18n } from '../lib/i18n.jsx'
import { resetPageColor, setPageColor } from '../lib/pageColor.js'
import { Link, navigate, replaceSearch } from '../lib/router.jsx'
import { compareSizes } from '../lib/sizes.js'

// Страница товара: вещь на цветной сцене (перекрашивается под выбранный цвет), цена,
// выбор цвета и размера, наличие, «Забронировать» и магазин.
export default function Product({ id, slug }) {
  const { language, t, formatPrice } = useI18n()
  const [product, setProduct] = useState(undefined) // undefined — загружаем, null — товара нет
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [color, setColor] = useState(null) // выбранный цвет (по узбекскому названию)
  const [size, setSize] = useState(null) // выбранный размер
  const [bookingOpen, setBookingOpen] = useState(false) // шторка «Забронировать»
  // Бронь начали на сайте и продолжают в Telegram (?book=1): после брони — сразу «Мои брони».
  const [fromSite, setFromSite] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProduct(id)
      .then((data) => {
        if (cancelled) return
        // Размер и цвет, выбранные раньше (?size=M&color=Qora со страницы категории
        // или ?variant=<номер> из брони, начатой на сайте), — если они есть в наличии.
        const params = new URLSearchParams(window.location.search)
        const wantedVariant = params.get('variant')
        const wantedSize = params.get('size')
        const wantedColor = params.get('color')
        const inStock = data?.variants.filter((variant) => variant.quantity > 0) ?? []
        const fitsSize = (v) => !wantedSize || v.size === wantedSize
        const fitsColor = (v) => !wantedColor || v.color_uz === wantedColor
        const exact = inStock.find((v) => v.id === wantedVariant)
        const first =
          exact ??
          inStock.find((v) => fitsSize(v) && fitsColor(v)) ??
          inStock.find(fitsColor) ??
          inStock.find(fitsSize) ??
          inStock[0] ??
          data?.variants[0]
        setColor(first?.color_uz ?? null)
        setSize(first?.size ?? null)
        setProduct(data)
        // Пришли из брони на сайте — сразу открываем подтверждение (если эта вещь ещё в наличии).
        // Из адреса это убираем, чтобы при «Назад» или обновлении шторка не открывалась снова.
        if (params.get('book') === '1') {
          replaceSearch('')
          if (exact) {
            setFromSite(true)
            setBookingOpen(true)
          }
        }
      })
      .catch((error) => {
        console.error('Не удалось загрузить товар:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  // Фон страницы — цвет категории, выбранный на витрине.
  const design = designFor(slug)
  const palette = design.palettes[getChosenPalette(slug)]
  useEffect(() => {
    setPageColor(palette.bg, palette.light)
    return resetPageColor
  }, [palette.bg, palette.light])

  function retry() {
    setFailed(false)
    setProduct(undefined)
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

  if (product === undefined) return <p className="page-message">{t('common.loading')}</p>

  if (product === null) {
    return (
      <div className="page-message">
        <p>{t('product.notFound')}</p>
        <Link to="/" className="primary-button">
          {t('nav.home')}
        </Link>
      </div>
    )
  }

  const { category, shop, variants } = product
  const name = product[`name_${language}`]

  // Цвета (без повторов) и размеры выбранного цвета — по порядку.
  const colors = uniqueBy(
    variants.filter((variant) => variant.color_uz),
    (variant) => variant.color_uz,
  )
  const variantsOfColor = colors.length ? variants.filter((variant) => variant.color_uz === color) : variants
  const sizes = variantsOfColor.filter((variant) => variant.size).sort((a, b) => compareSizes(a.size, b.size))
  const selected = variantsOfColor.find((variant) => !sizes.length || variant.size === size) ?? null
  const available = selected?.quantity > 0
  const selectedColorName = colors.find((v) => v.color_uz === color)?.[`color_${language}`]

  function chooseColor(newColor) {
    setColor(newColor)
    // Оставляем размер, если он есть в новом цвете; иначе — первый размер в наличии.
    const ofColor = variants.filter((variant) => variant.color_uz === newColor)
    const keep = ofColor.find((variant) => variant.size === size && variant.quantity > 0)
    const next = keep ?? ofColor.find((variant) => variant.quantity > 0) ?? ofColor[0]
    setSize(next?.size ?? null)
  }

  const colorInStock = (colorName) =>
    variants.some((variant) => variant.color_uz === colorName && variant.quantity > 0)

  return (
    <article className="pp">
      <div className="pp-stage" aria-hidden="true">
        <div className="pp-art">
          {product.photo_urls[0] ? (
            <img src={product.photo_urls[0]} alt="" />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: itemHTML(design, colorHex(color), name, category.emoji) }} />
          )}
        </div>
        <div className="pp-shadow" />
      </div>

      <div className="pp-card">
        <Link to={`/c/${category.slug}`} className="pp-category">
          <span aria-hidden="true">{category.emoji}</span> {category[`name_${language}`]}
        </Link>
        <h1 className="pp-title">{name}</h1>
        <p className="pp-meta">{[product.brand, t(`gender.${product.gender}`)].filter(Boolean).join(' · ')}</p>
        <p className="pp-price">{formatPrice(product.price)}</p>

        {colors.length > 0 && (
          <div className="pp-option">
            <p className="pp-option-label">
              {t('product.color')}: <b>{selectedColorName}</b>
            </p>
            <div className="chip-wrap">
              {colors.map((variant) => (
                <button
                  key={variant.color_uz}
                  type="button"
                  className="chip color-chip"
                  aria-pressed={variant.color_uz === color}
                  disabled={!colorInStock(variant.color_uz)}
                  onClick={() => chooseColor(variant.color_uz)}
                >
                  <span className="color-dot" style={{ background: colorHex(variant.color_uz) }} />
                  {variant[`color_${language}`]}
                </button>
              ))}
            </div>
          </div>
        )}

        {sizes.length > 0 && (
          <div className="pp-option">
            <p className="pp-option-label">{t('product.size')}</p>
            <div className="chip-wrap">
              {sizes.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className="chip"
                  aria-pressed={variant.size === size}
                  disabled={variant.quantity === 0}
                  onClick={() => setSize(variant.size)}
                >
                  {variant.size}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className={available ? 'stock-line in-stock' : 'stock-line'}>
          {available ? t('product.inStock', { n: selected.quantity }) : t('product.outOfStock')}
        </p>

        {/* На телефоне кнопка всегда видна внизу экрана. */}
        <div className="pp-book">
          <button type="button" className="book-button" disabled={!available} onClick={() => setBookingOpen(true)}>
            {t('product.book')}
          </button>
        </div>
        <BookingSheet
          open={bookingOpen}
          onClose={() => setBookingOpen(false)}
          onBooked={fromSite ? (booking) => navigate(`/bookings?new=${booking.id}`) : undefined}
          product={product}
          variant={selected}
          colorName={selectedColorName}
          slug={category.slug}
        />

        {product[`description_${language}`] && <p className="pp-description">{product[`description_${language}`]}</p>}

        <section className="pp-shop">
          <h2 className="pp-shop-label">{t('product.whereToBuy')}</h2>
          {/* Название магазина ведёт на его страницу со всеми товарами. */}
          <Link to={`/s/${shop.id}`} className="shop-title shop-link">
            {shop.name}
            <Icon name="chevron" />
          </Link>
          <ShopInfo shop={shop} />
          <Link to={`/s/${shop.id}`} className="shop-all-link">
            {t('shop.allProducts')}
          </Link>
        </section>

        {/* Тот же товар в других магазинах — сравнить цену и наличие. */}
        {product.offers.length > 0 && (
          <section className="pp-offers">
            <h2 className="pp-shop-label">{t('product.otherShops', { n: product.offers.length })}</h2>
            <ul className="offer-list">
              {product.offers.map((offer) => (
                <li key={offer.id}>
                  <Link to={`/c/${category.slug}/p/${offer.id}`} className="offer-row">
                    <span className="offer-shop">{offer.shop?.name}</span>
                    <span className="offer-sizes">
                      {offer.inStock ? offer.sizes.join(', ') || t('product.inStockShort') : t('product.outOfStock')}
                    </span>
                    <b className="offer-price">{formatPrice(offer.price)}</b>
                    <Icon name="chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  )
}

// Первый элемент для каждого значения ключа, порядок сохраняется.
function uniqueBy(items, key) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(key(item))) return false
    seen.add(key(item))
    return true
  })
}
