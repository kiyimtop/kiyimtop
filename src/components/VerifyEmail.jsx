import { useState } from 'react'
import { checkVerification, resendVerification } from '../lib/auth.js'
import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

// «Подтвердите email»: письмо со ссылкой отправлено при регистрации.
// Кнопки: отправить ещё раз и «Я подтвердил» (проверить заново). Бронировать можно только после подтверждения.
export default function VerifyEmail({ email }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // sent | still | error

  async function act(work) {
    setBusy(true)
    setNote(null)
    try {
      setNote(await work())
    } catch {
      setNote('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-box" role="status">
      <p className="verify-title">
        <Icon name="mail" />
        {t('verify.title')}
      </p>
      <p className="cab-text">{t('verify.text', { email: email ?? '' })}</p>
      <div className="cab-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => act(async () => ((await checkVerification()) ? null : 'still'))}>
          {t('verify.done')}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => act(async () => (await resendVerification(), 'sent'))}>
          {t('verify.resend')}
        </button>
      </div>
      {note && <p className={note === 'sent' ? 'cab-text' : 'cab-error'}>{t(`verify.${note}`)}</p>}
    </div>
  )
}
