import { colorHex, isLight, tint } from '../lib/colors.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import { designFor, itemHTML } from './showcaseArt.js'

// Строка товара в корзине и в бронях: плитка (фото или рисунок в цвете товара), название,
// цвет · размер, «× 2», цена за все штуки. children — что справа/снизу (кнопки, статус).
// link — куда ведёт название (страница товара).
export default function LineItem({ name, colorUz, colorName, size, qty = 1, price, slug, emoji, photo, link, note, children, muted }) {
  const { formatPrice, t } = useI18n()
  const hex = colorHex(colorUz)
  const details = [colorName, size].filter(Boolean).join(' · ')
  const title = link ? (
    <Link to={link} className="line-name">
      {name}
    </Link>
  ) : (
    <span className="line-name">{name}</span>
  )
  return (
    <div className={muted ? 'line-item muted' : 'line-item'}>
      <div className="line-tile" style={{ background: isLight(hex) ? '#ECEEF2' : tint(hex, 0.82) }} aria-hidden="true">
        {photo ? <img src={photo} alt="" /> : <div dangerouslySetInnerHTML={{ __html: itemHTML(designFor(slug), hex, name, emoji ?? '🛍️') }} />}
      </div>
      <div className="line-info">
        {title}
        {details && <span className="line-details">{details}</span>}
        <span className="line-price">
          {formatPrice((price ?? 0) * qty)}
          {qty > 1 && <small> · {t('cart.each', { n: qty, price: formatPrice(price ?? 0) })}</small>}
        </span>
        {note && <span className="line-note">{note}</span>}
        {children}
      </div>
    </div>
  )
}
