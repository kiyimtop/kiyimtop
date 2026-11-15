import { useCart } from '../lib/cart.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import Icon from './Icon.jsx'

// Круглая кнопка корзины в правом нижнем углу: видна, только когда в корзине что-то есть.
// Число — сколько всего штук.
export default function CartButton() {
  const { t } = useI18n()
  const { count } = useCart()
  if (!count) return null
  return (
    <Link to="/cart" className="cart-fab" aria-label={t('cart.open', { n: count })}>
      <Icon name="cart" />
      <span className="cart-fab-count">{count > 99 ? '99+' : count}</span>
    </Link>
  )
}
