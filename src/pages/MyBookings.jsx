import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import ShopInfo from '../components/ShopInfo.jsx'
import { designFor, itemHTML } from '../components/showcaseArt.js'
import AuthForm from '../components/AuthForm.jsx'
import { useAccount } from '../lib/auth.js'
import { bookingState, cancelBooking, fetchMyBookings, isActive } from '../lib/bookings.js'
import { colorHex, isLight, tint } from '../lib/colors.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link, replaceSearch } from '../lib/router.jsx'

// «Мои брони» (/bookings): что забронировано, код брони, до какого времени держится,
// где магазин и как туда позвонить. Действующую бронь можно отменить.
// Не вошли — вход или регистрация; брони привязаны к аккаунту (те же на сайте и в Telegram).
export default function MyBookings() {
  const { t } = useI18n()
  const [bookings, setBookings] = useState(undefined) // undefined — загружаем
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const account = useAccount()
  const loggedIn = account.status === 'in'
  // Только что забронировали (?new=<номер брони>) — эта бронь сверху с пометкой «Забронировано!».
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

  const markCancelled = (id) =>
    setBookings((list) => list.map((booking) => (booking.id === id ? { ...booking, status: 'cancelled' } : booking)))

  // Сначала только что сделанная, потом действующие, потом остальные (внутри — новые сверху).
  const sorted = bookings
    ? [...bookings].sort((a, b) => (b.id === justBooked) - (a.id === justBooked) || isActive(b) - isActive(a))
    : []

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
        {loggedIn && sorted.map((booking) => (
          <BookingCard key={booking.id} booking={booking} isNew={booking.id === justBooked} onCancelled={markCancelled} />
        ))}
      </div>
    </section>
  )
}

function BookingCard({ booking, isNew, onCancelled }) {
  const { language, t, formatPrice, formatDateTime } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  const state = bookingState(booking)
  const active = isActive(booking)
  const category = booking.product?.category
  const name = booking[`product_name_${language}`]
  const color = booking[`color_${language}`]
  const hex = colorHex(booking.color_uz)
  const productLink = booking.product_id && category ? `/c/${category.slug}/p/${booking.product_id}` : null

  async function cancel() {
    setSending(true)
    setError(null)
    try {
      await cancelBooking(booking.id)
      onCancelled(booking.id)
    } catch (failure) {
      setError(failure.code ?? 'server')
      setSending(false)
    }
  }

  const item = (
    <>
      <div className="product-tile" style={{ background: isLight(hex) ? '#ECEEF2' : tint(hex, 0.82) }} aria-hidden="true">
        <div dangerouslySetInnerHTML={{ __html: itemHTML(designFor(category?.slug), hex, name, category?.emoji ?? '🛍️') }} />
      </div>
      <div className="product-info">
        <p className="product-name">{name}</p>
        {(color || booking.size) && <p className="product-note">{[color, booking.size].filter(Boolean).join(' · ')}</p>}
        <p className="product-price">{formatPrice(booking.price)}</p>
      </div>
    </>
  )

  return (
    <article className={['booking', !active && 'inactive', isNew && 'just-booked'].filter(Boolean).join(' ')}>
      {isNew && active && (
        <p className="booking-new" role="status">
          <Icon name="check" />
          <span>
            <b>{t('booking.done')}</b> {t('booking.showCode', { date: formatDateTime(booking.expires_at) })}
          </span>
        </p>
      )}
      <div className="booking-head">
        <span className={`booking-status ${state}`}>{t(`booking.status.${state}`)}</span>
        <span className="booking-code-small">
          {t('booking.code')}: <b>{booking.code}</b>
        </span>
      </div>

      {productLink ? (
        <Link to={productLink} className="product-row">
          {item}
          <Icon name="chevron" className="icon product-chevron" />
        </Link>
      ) : (
        <div className="product-row">{item}</div>
      )}

      <p className="booking-when">
        <Icon name="clock" />
        {active
          ? t('booking.until', { date: formatDateTime(booking.expires_at) })
          : t('booking.created', { date: formatDateTime(booking.created_at) })}
      </p>

      {booking.shop && (
        <div className="booking-shop-info">
          <Link to={`/s/${booking.shop.id}`} className="shop-title shop-link">
            {booking.shop.name}
            <Icon name="chevron" />
          </Link>
          {active && <ShopInfo shop={booking.shop} />}
        </div>
      )}

      {active && !confirming && (
        <button type="button" className="booking-cancel" onClick={() => setConfirming(true)}>
          {t('booking.cancel')}
        </button>
      )}
      {active && confirming && (
        <div className="booking-confirm" role="group" aria-label={t('booking.cancelConfirm')}>
          <p>{t('booking.cancelConfirm')}</p>
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
