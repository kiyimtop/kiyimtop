import { useEffect } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { isTelegram, setTelegramBackButton } from '../lib/platform.js'

// «Назад»: в Telegram — его кнопка в шапке, в браузере — обычная кнопка на странице.
export default function BackButton({ onBack }) {
  const { t } = useI18n()
  const inTelegram = isTelegram()

  useEffect(() => {
    if (inTelegram) return setTelegramBackButton(onBack)
  }, [inTelegram, onBack])

  if (inTelegram) return null

  return (
    <button type="button" className="back-button" onClick={onBack}>
      <span aria-hidden="true">←</span> {t('nav.back')}
    </button>
  )
}
