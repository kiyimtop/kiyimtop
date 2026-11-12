import { colorHex, isLight, tint } from '../lib/colors.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import Icon from './Icon.jsx'
import { designFor, itemHTML } from './showcaseArt.js'

// Строка товара: плитка с вещью в цвете товара, бренд, название, цена, кружки цветов.
// Используется на странице категории, в поиске и на странице магазина.
// color — какой цвет показать (например, выбранный в фильтре), note — подпись внизу (магазин).
export default function ProductRow({ product, category, search = '', color, note }) {
  const { language, t, formatPrice } = useI18n()
  const hex = colorHex(color ?? product.colors[0]?.uz)
  const name = product[`name_${language}`]

  return (
    <li>
      <Link
        to={`/c/${category.slug}/p/${product.id}${search ? `?${search}` : ''}`}
        className={product.inStock ? 'product-row' : 'product-row out'}
      >
        {/* Плитка — светлый оттенок цвета товара; для белых и светлых вещей — светло-серая. */}
        <div className="product-tile" style={{ background: isLight(hex) ? '#ECEEF2' : tint(hex, 0.82) }} aria-hidden="true">
          {product.photo_urls[0] ? (
            <img src={product.photo_urls[0]} alt="" />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: itemHTML(designFor(category.slug), hex, name, category.emoji) }} />
          )}
        </div>
        <div className="product-info">
          {product.brand && <p className="product-brand">{product.brand}</p>}
          <p className="product-name">{name}</p>
          <p className="product-price">{formatPrice(product.price)}</p>
          {product.inStock ? (
            <span className="color-dots" aria-label={product.colors.map((c) => c[language]).join(', ')}>
              {product.colors.map((c) => (
                <span key={c.uz} className="color-dot" style={{ background: colorHex(c.uz) }} />
              ))}
            </span>
          ) : (
            <p className="product-stock">{t('product.outOfStock')}</p>
          )}
          {note && <p className="product-note">{note}</p>}
        </div>
        <Icon name="chevron" className="icon product-chevron" />
      </Link>
    </li>
  )
}
