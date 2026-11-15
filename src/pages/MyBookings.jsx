import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import ShopInfo from '../components/ShopInfo.jsx'
import AuthForm from '../components/AuthForm.jsx'
import LineItem from '../components/LineItem.jsx'
import { useAccount } from '../lib/auth.js'
import { bookingState, cancelGroup, fetchMyBookings, groupBookings, qtyOf } from '../lib/bookings.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link, replaceSearch } from '../lib/router.jsx'

// «Мои брони» (/bookings): по одной карточке на бронь в магазине (из корзины — несколько вещей,
// один код). Что забронировано, код, до какого времени держится, где магазин и как туда позвонить.
// Действующую бронь можно отменить целиком.
// Не вошли — вход или регистрация; брони привязаны к аккаунту (те же на сайте и в Telegram).
export default function MyBookings() {
  const { t } = useI18n()
  const [bookings, setBookings] = useState(undefined) // undefined — загружаем
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const account = useAccount()
  const loggedIn = account.status === 'in'
  // Только что забронировали (?new=<номер брони или строки>) — эта бронь сверху с пометкой «Забронировано!».
  const [justBooked] = useState(() => new URLSearchParams(window.location.search).get('new'))
  useEffect(() => {
    if (justBooked) replaceSearch('')
  }, [justBooked])

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    fetchMyBookings()
      .then((list) => {
        if (!cancelled) setBookings(list)
      })
      .catch((failure) => {
        console.error('Не удалось загрузить брони:', failure)
        if (!cancelled) setError(failure.code ?? 'server')
      })
    return () => {
      cancelled = true
    }
  }, [loggedIn, account.user?.uid, attempt])

  function retry() {
    setError(null)
    setBookings(undefined)
    setAttempt((n) => n + 1)
  }

  const markCancelled = (group) =>
    setBookings((list) =>
      list.map((line) => (group.lines.some((l) => l.id === line.id) && ['new', 'confirmed'].includes(bookingState(line)) ? { ...line, status: 'cancelled' } : line)),
    )

  // Брони по магазинам. Сначала только что сделанная, потом действующие, потом остальные (внутри — новые сверху).
  const isJust = (group) => group.id === justBooked || group.lines.some((l) => l.id === justBooked)
  const groups = bookings ? groupBookings(bookings).sort((a, b) => isJust(b) - isJust(a)) : []

  return (
    <section className="bookings">
      <h1 className="search-title">{t('booking.title')}</h1>

      {account.status === 'loading' && <p className="page-message">{t('common.loading')}</p>}
      {account.status === 'out' && (
        <div className="bookings-login">
          <AuthForm intro={t('booking.loginWhyList')} />
        </div>
      )}

      {loggedIn && error && (
        <div className="page-message" role="alert">
          <p>{t(`booking.error.${error}`)}</p>
          {error !== 'not_configured' && (
            <button type="button" className="primary-button" onClick={retry}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

      {loggedIn && !error && bookings === undefined && <p className="page-message">{t('common.loading')}</p>}

      {loggedIn && bookings?.length === 0 && (
        <div className="page-message">
          <p>{t('booking.empty')}</p>
          <Link to="/" className="primary-button">
            {t('nav.home')}
          </Link>
        </div>
      )}

      <div className="booking-list">
        {loggedIn && groups.map((group) => (
          <BookingCard key={group.id} group={group} isNew={isJust(group)} onCancelled={markCancelled} />
        ))}
      </div>
    </section>
  )
}

function BookingCard({ group, isNew, onCancelled }) {
  const { language, t, formatPrice, formatDateTime } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const { state, active } = group
  const count = group.lines.reduce((sum, l) => sum + qtyOf(l), 0)

  async function cancel() {
    setSending(true)
    setError(null)
    try {
      await cancelGroup(group)
      onCancelled(group)
    } catch (failure) {
      setError(failure.code ?? 'server')
      setSending(false)
    }
  }

  return (
    <article className={['booking', !active && 'inactive', isNew && 'just-booked'].filter(Boolean).join(' ')}>
      {isNew && active && (
        <p className="booking-new" role="status">
          <Icon name="check" />
          <span>
            <b>{t('booking.done')}</b> {t('booking.showCode', { date: formatDateTime(group.expires_at) })}
          </span>
        </p>
      )}
      <div className="booking-head">
        <span className={`booking-status ${state}`}>{t(`booking.status.${state}`)}</span>
        <span className="booking-code-small">
          {t('booking.code')}: <b>{group.code}</b>
        </span>
      </div>

      <div className="booking-lines">
        {group.lines.map((line) => {
          const lineState = bookingState(line)
          const category = line.product?.category
          return (
            <LineItem
              key={line.id}
              name={line[`product_name_${language}`] ?? line.product_name_ru}
              colorUz={line.color_uz}
              colorName={line[`color_${language}`]}
              size={line.size}
              qty={qtyOf(line)}
              price={line.price}
              slug={category?.slug}
              emoji={category?.emoji}
              link={line.product_id && category ? `/c/${category.slug}/p/${line.product_id}` : null}
              muted={lineState === 'unavailable' || (lineState !== state && ['cancelled', 'expired'].includes(lineState))}
            >
              {/* У позиции свой статус, только если он не такой, как у всей брони (например, «нет в наличии»). */}
              {lineState !== state && <span className={`booking-status line-status ${lineState}`}>{t(`booking.status.${lineState}`)}</span>}
            </LineItem>
          )
        })}
        {group.lines.length > 1 && (
          <p className="cart-subtotal">
            {t('cart.total', { n: count })} <b>{formatPrice(group.total)}</b>
          </p>
        )}
      </div>

      <p className="booking-when">
        <Icon name="clock" />
        {active
          ? t('booking.until', { date: formatDateTime(group.expires_at) })
          : t('booking.created', { date: formatDateTime(group.created_at) })}
      </p>

      {group.shop && (
        <div className="booking-shop-info">
          <Link to={`/s/${group.shop.id}`} className="shop-title shop-link">
            {group.shop.name}
            <Icon name="chevron" />
          </Link>
          {active && <ShopInfo shop={group.shop} />}
        </div>
      )}

      {active && !confirming && (
        <button type="button" className="booking-cancel" onClick={() => setConfirming(true)}>
          {t('booking.cancel')}
        </button>
      )}
      {active && confirming && (
        <div className="booking-confirm" role="group" aria-label={t('booking.cancelConfirm')}>
          <p>{t(group.lines.length > 1 ? 'booking.cancelConfirmAll' : 'booking.cancelConfirm')}</p>
          <button type="button" className="booking-cancel danger" disabled={sending} onClick={cancel}>
            {t('booking.cancelYes')}
          </button>
          <button type="button" className="booking-cancel" disabled={sending} onClick={() => setConfirming(false)}>
            {t('booking.cancelNo')}
          </button>
        </div>
      )}
      {error && (
        <p className="sort-error" role="alert">
          {t(`booking.error.${error}`)}
        </p>
      )}
    </article>
  )
}
