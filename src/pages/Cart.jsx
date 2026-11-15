import { useEffect, useMemo, useState } from 'react'
import AuthForm from '../components/AuthForm.jsx'
import Icon from '../components/Icon.jsx'
import LineItem from '../components/LineItem.jsx'
import QtyStepper from '../components/QtyStepper.jsx'
import VerifyEmail from '../components/VerifyEmail.jsx'
import { useAccount } from '../lib/auth.js'
import { checkout, HOLD_DAYS, MAX_ITEMS, MAX_SHOPS } from '../lib/bookings.js'
import { MAX_LINE_QTY, removeCartLines, removeFromCart, setCartQty, useCart } from '../lib/cart.js'
import { fetchCartView } from '../lib/catalog.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'

// Корзина (/cart): вещи из разных магазинов, по магазинам. Количество 1–5, убрать.
// «Забронировать всё» → на каждый магазин своя бронь со своим кодом (lib/bookings.js → checkout).
// Не вошли — вход прямо здесь; email не подтверждён — «Подтвердите email».
export default function Cart() {
  const { t, language, formatPrice } = useI18n()
  const account = useAccount()
  const { items } = useCart()
  const [view, setView] = useState(undefined)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchCartView(items)
      .then((rows) => !cancelled && setView(rows))
      .catch(() => !cancelled && setView(items.map((line) => ({ ...line, missing: true }))))
    return () => {
      cancelled = true
    }
  }, [items])

  const shops = useMemo(() => {
    const map = new Map()
    for (const row of view ?? []) {
      if (row.missing) continue
      if (!map.has(row.shop.id)) map.set(row.shop.id, { shop: row.shop, rows: [] })
      map.get(row.shop.id).rows.push(row)
    }
    return [...map.values()]
  }, [view])
  const missing = (view ?? []).filter((row) => row.missing)
  const ready = shops.flatMap((s) => s.rows).filter((row) => row.stock > 0)
  const itemsCount = ready.reduce((sum, row) => sum + row.qty, 0)
  const total = ready.reduce((sum, row) => sum + row.product.price * row.qty, 0)

  async function submit() {
    setSending(true)
    setError(null)
    try {
      const done = await checkout(ready.map(({ product_id, variant_id, qty }) => ({ product_id, variant_id, qty })))
      const booked = done.orders.flatMap((o) => o.booked.map((b) => b.variant_id))
      await removeCartLines(booked)
      setResult(done.orders)
      window.scrollTo(0, 0)
    } catch (failure) {
      setError(failure.code ?? 'server')
    } finally {
      setSending(false)
    }
  }

  if (result) return <CartDone orders={result} onBack={() => setResult(null)} />

  return (
    <section className="cab cart">
      <h1 className="search-title">{t('cart.title')}</h1>

      {view === undefined && <p className="page-message">{t('common.loading')}</p>}

      {view && items.length === 0 && (
        <div className="cab-empty">
          <b>{t('cart.empty')}</b>
          <span>{t('cart.emptyHint')}</span>
          <Link to="/" className="primary-button">
            {t('nav.home')}
          </Link>
        </div>
      )}

      {shops.map(({ shop, rows }) => (
        <div key={shop.id} className="cab-card cart-shop">
          <Link to={`/s/${shop.id}`} className="shop-title shop-link">
            {shop.name}
            <Icon name="chevron" />
          </Link>
          {rows.map((row) => {
            const max = Math.max(1, Math.min(MAX_LINE_QTY, row.stock))
            const note =
              row.stock === 0 ? t('cart.soldOut') : row.qty > row.stock ? t('cart.onlyLeft', { n: row.stock }) : null
            return (
              <LineItem
                key={row.variant_id}
                name={row.product[`name_${language}`] ?? row.product.name_ru}
                colorUz={row.variant.color_uz}
                colorName={row.variant[`color_${language}`]}
                size={row.variant.size}
                qty={row.qty}
                price={row.product.price}
                slug={row.category.slug}
                emoji={row.category.emoji}
                photo={row.product.photo_urls[0]}
                link={`/c/${row.category.slug}/p/${row.product.id}`}
                note={note}
                muted={row.stock === 0}
              >
                <div className="line-actions">
                  {row.stock > 0 && <QtyStepper value={row.qty} max={max} onChange={(n) => setCartQty(row.variant_id, n)} />}
                  <button type="button" className="link-button cab-danger" onClick={() => removeFromCart(row.variant_id)}>
                    {t('cart.remove')}
                  </button>
                </div>
              </LineItem>
            )
          })}
          <p className="cart-subtotal">
            {t('cart.shopTotal')} <b>{formatPrice(rows.filter((r) => r.stock > 0).reduce((s, r) => s + r.product.price * r.qty, 0))}</b>
          </p>
        </div>
      ))}

      {missing.length > 0 && (
        <div className="cab-card">
          <p className="cab-text cab-muted">{t('cart.missing', { n: missing.length })}</p>
          <button type="button" className="link-button cab-danger" onClick={() => removeCartLines(missing.map((r) => r.variant_id))}>
            {t('cart.removeMissing')}
          </button>
        </div>
      )}

      {ready.length > 0 && (
        <div className="cart-summary">
          <p className="cart-total">
            <span>{t('cart.total', { n: itemsCount })}</span>
            <b>{formatPrice(total)}</b>
          </p>
          <p className="cab-text cab-muted">
            {t('cart.howItWorks', { n: shops.filter((s) => s.rows.some((r) => r.stock > 0)).length, days: HOLD_DAYS })}
          </p>
          {(itemsCount > MAX_ITEMS || shops.length > MAX_SHOPS) && (
            <p className="cab-error">{t('cart.limits', { items: MAX_ITEMS, shops: MAX_SHOPS })}</p>
          )}

          {account.status === 'loading' && <p className="page-message">{t('common.loading')}</p>}
          {account.status === 'out' && (
            <div className="bookings-login">
              <AuthForm intro={t('cart.loginWhy')} />
            </div>
          )}
          {account.status === 'in' && !(account.profile?.emailVerified ?? account.user.emailVerified) && (
            <VerifyEmail email={account.user.email} />
          )}
          {account.status === 'in' && (account.profile?.emailVerified ?? account.user.emailVerified) && (
            <button type="button" className="book-button" disabled={sending} onClick={submit}>
              {sending ? t('booking.sending') : t('cart.bookAll')}
            </button>
          )}
          {error && (
            <div className="booking-error" role="alert">
              <p>{t(`booking.error.${error}`, { items: MAX_ITEMS, shops: MAX_SHOPS })}</p>
              {['too_many_items', 'too_many_shops'].includes(error) && (
                <Link to="/bookings" className="shop-all-link">
                  {t('booking.title')}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Готово: брони по магазинам со своими кодами. Что не получилось забронировать — осталось в корзине.
function CartDone({ orders, onBack }) {
  const { t, language, formatDateTime } = useI18n()
  const done = orders.filter((o) => o.booked.length)
  const failed = orders.flatMap((o) => o.failed)
  return (
    <section className="cab cart">
      <div className="cart-done" role="status">
        <span className="booking-done-icon" aria-hidden="true">
          <Icon name="check" />
        </span>
        <h1 className="search-title">{done.length ? t('cart.doneTitle', { n: done.length }) : t('cart.nothingBooked')}</h1>
        {done.length > 0 && <p className="cab-text">{t('cart.doneText', { date: formatDateTime(done[0].booked[0].expires_at) })}</p>}
      </div>

      {done.map((order) => (
        <div key={order.group_id} className="cab-card cart-order">
          <p className="cab-card-title">
            <b>{order.shop?.name}</b>
            <span className="cart-code">
              {t('booking.code')}: <b>{order.code}</b>
            </span>
          </p>
          <ul className="cart-order-lines">
            {order.booked.map((b) => (
              <li key={b.id}>
                {b[`product_name_${language}`] ?? b.product_name_ru}
                {[b[`color_${language}`], b.size].filter(Boolean).length > 0 && <> — {[b[`color_${language}`], b.size].filter(Boolean).join(' · ')}</>}
                {(b.qty ?? 1) > 1 && <> × {b.qty}</>}
              </li>
            ))}
          </ul>
          {order.failed.length > 0 && <p className="cab-error">{t('cart.someFailed', { n: order.failed.length })}</p>}
        </div>
      ))}

      {failed.length > 0 && (
        <div className="booking-error" role="alert">
          <p>{t('cart.failedLeft', { n: failed.length })}</p>
          <p>{t(`booking.error.${failed[0].code}`, { items: MAX_ITEMS, shops: MAX_SHOPS })}</p>
        </div>
      )}

      <div className="cab-actions">
        <Link to="/bookings" className="primary-button">
          {t('booking.title')}
        </Link>
        {failed.length > 0 && (
          <button type="button" className="secondary-button" onClick={onBack}>
            {t('cart.title')}
          </button>
        )}
      </div>
    </section>
  )
}
