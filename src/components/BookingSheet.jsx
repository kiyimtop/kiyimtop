import { useEffect, useState } from 'react'
import { useAccount } from '../lib/auth.js'
import { createBooking, HOLD_DAYS } from '../lib/bookings.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import AuthForm from './AuthForm.jsx'
import Icon from './Icon.jsx'
import Sheet from './Sheet.jsx'
import VerifyEmail from './VerifyEmail.jsx'

// Шторка «Забронировать» на странице товара: что бронируем → «Забронировать» → «Забронировано!» и код брони.
// Не вошли — сначала вход или регистрация (прямо в шторке), email не подтверждён — «Подтвердите email».
// onBooked — что сделать после брони вместо «Забронировано!» (например, открыть «Мои брони»).
export default function BookingSheet({ open, onClose, onBooked, product, variant, colorName }) {
  const { language, t, formatPrice, formatDateTime } = useI18n()
  const [step, setStep] = useState('confirm') // confirm → sending → done
  const [error, setError] = useState(null) // код ошибки: sold_out, too_many …
  const [booking, setBooking] = useState(null)
  const account = useAccount()

  // Каждый раз шторка открывается заново, с подтверждения.
  useEffect(() => {
    if (!open) return
    setStep('confirm')
    setError(null)
    setBooking(null)
  }, [open])

  if (account.status !== 'in') {
    return (
      <Sheet open={open} onClose={onClose} title={t('booking.loginTitle')}>
        {account.status === 'loading' ? <p className="page-message">{t('common.loading')}</p> : open && <AuthForm intro={t('booking.loginWhy')} />}
      </Sheet>
    )
  }

  const verified = account.profile?.emailVerified ?? account.user.emailVerified
  if (!verified) {
    return (
      <Sheet open={open} onClose={onClose} title={t('booking.loginTitle')}>
        <VerifyEmail email={account.user.email} />
      </Sheet>
    )
  }

  async function submit() {
    setStep('sending')
    setError(null)
    try {
      const created = await createBooking(variant.id, product.id)
      if (onBooked) return onBooked(created)
      setBooking(created)
      setStep('done')
    } catch (failure) {
      setError(failure.code ?? 'server')
      setStep('confirm')
    }
  }

  if (step === 'done' && booking) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={t('booking.done')}
        footer={
          <>
            <Link to="/bookings" className="sheet-reset">
              {t('booking.title')}
            </Link>
            <button type="button" className="sheet-apply" onClick={onClose}>
              {t('booking.close')}
            </button>
          </>
        }
      >
        <div className="booking-done" role="status">
          <span className="booking-done-icon" aria-hidden="true">
            <Icon name="check" />
          </span>
          <p className="booking-code-label">{t('booking.code')}</p>
          <p className="booking-code">{booking.code}</p>
          <p className="booking-text">{t('booking.showCode', { date: formatDateTime(booking.expires_at) })}</p>
        </div>
      </Sheet>
    )
  }

  const holdUntil = Date.now() + HOLD_DAYS * 24 * 60 * 60 * 1000
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('booking.confirmTitle')}
      footer={
        <button type="button" className="sheet-apply" disabled={step === 'sending'} onClick={submit}>
          {step === 'sending' ? t('booking.sending') : t('product.book')}
        </button>
      }
    >
      <div className="booking-summary">
        <p className="booking-product">{product[`name_${language}`]}</p>
        {(colorName || variant?.size) && (
          <p className="booking-details">{[colorName, variant?.size].filter(Boolean).join(' · ')}</p>
        )}
        <p className="booking-price">{formatPrice(product.price)}</p>
        <p className="booking-shop">
          <Icon name="pin" />
          {product.shop.name}
        </p>
      </div>
      <p className="booking-text">{t('booking.holdNote', { date: formatDateTime(holdUntil) })}</p>
      {error && (
        <div className="booking-error" role="alert">
          <p>{t(`booking.error.${error}`)}</p>
          {(error === 'too_many' || error === 'already_booked') && (
            <Link to="/bookings" className="shop-all-link">
              {t('booking.title')}
            </Link>
          )}
        </div>
      )}
    </Sheet>
  )
}
