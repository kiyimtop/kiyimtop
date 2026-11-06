import { useEffect, useState } from 'react'
import Showcase from '../components/Showcase.jsx'
import { designFor } from '../components/showcaseArt.js'
import { fetchShowcase } from '../lib/catalog.js'
import { useI18n } from '../lib/i18n.jsx'

// Главная: витрина категорий со свайпом.
export default function Home() {
  const { t } = useI18n()
  const [slides, setSlides] = useState(null) // null — ещё загружаем
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchShowcase()
      .then((data) => {
        if (cancelled) return
        if (!data.length) throw new Error('В базе нет категорий')
        setSlides(data.map(({ category, stats }) => ({ category, stats, design: designFor(category.slug) })))
      })
      .catch((error) => {
        console.error('Не удалось загрузить витрину:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  function retry() {
    setFailed(false)
    setSlides(null)
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

  if (!slides) return <p className="page-message">{t('common.loading')}</p>

  return <Showcase slides={slides} />
}
