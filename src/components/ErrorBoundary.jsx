import { Component } from 'react'
import { useI18n } from '../lib/i18n.jsx'

// Если страница «упала» из-за неожиданной ошибки (например, испорченной записи в базе), вместо пустого
// белого экрана показываем понятное сообщение и кнопку «Обновить страницу».
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Ошибка на странице:', error)
  }

  render() {
    return this.state.failed ? <Crash /> : this.props.children
  }
}

function Crash() {
  const { t } = useI18n()
  return (
    <div className="page-message" role="alert">
      <p>{t('common.crash')}</p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>
        {t('common.reload')}
      </button>
    </div>
  )
}
