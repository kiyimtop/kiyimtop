import { useEffect, useRef, useState } from 'react'
import { checkLogin, startLogin } from '../lib/auth.js'
import { useI18n } from '../lib/i18n.jsx'
import { isTouchScreen, telegramAppLink, telegramBotLink } from '../lib/platform.js'
import ExternalLink from './ExternalLink.jsx'
import Icon from './Icon.jsx'

// «Войти через Telegram» на сайте — через нашего бота:
// кнопка открывает чат с @KiyimTopBot (ссылка t.me/KiyimTopBot?start=login_…), там «Start» и «Да, войти»,
// а сайт тем временем раз в 2 секунды спрашивает сервер, подтвердили ли вход, и сам продолжает.
// На сайте и в боте показан один и тот же код из 4 цифр — чтобы сверить, что это ваш вход.
// startParam — что открыть, если выбрать «Открыть в приложении Telegram» (на телефоне).
export default function TelegramLogin({ text, startParam, onLoggedIn }) {
  const { t } = useI18n()
  const [request, setRequest] = useState(null) // { token, code }
  const [state, setState] = useState('creating') // creating → ready → waiting → done; expired; error
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const onLoggedInRef = useRef(onLoggedIn)
  useEffect(() => {
    onLoggedInRef.current = onLoggedIn
  })

  // Готовим ссылку заранее, чтобы кнопка была настоящей ссылкой (так телефон сразу откроет Telegram).
  useEffect(() => {
    let cancelled = false
    setState('creating')
    startLogin()
      .then((created) => {
        if (cancelled) return
        setRequest(created)
        setState('ready')
      })
      .catch((failure) => {
        if (cancelled) return
        setError(failure.code ?? 'server')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  // Ждём подтверждения: спрашиваем сервер каждые 2 секунды и сразу, когда человек вернулся на страницу.
  useEffect(() => {
    if (state !== 'waiting' || !request) return
    let stopped = false
    const check = async () => {
      const result = await checkLogin(request.token)
      if (stopped) return
      if (result === 'done') {
        setState('done')
        onLoggedInRef.current?.()
      } else if (result === 'expired') setState('expired')
    }
    const timer = setInterval(check, 2000)
    const onReturn = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    check()
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [state, request])

  const retry = () => {
    setError(null)
    setRequest(null)
    setAttempt((n) => n + 1)
  }

  // На телефоне можно вместо входа сразу перейти в приложение Telegram (на компьютере такие ссылки не открываются).
  const appLink = startParam && isTouchScreen() && (
    <ExternalLink href={telegramAppLink(startParam)} className="shop-all-link tg-login-app">
      {t('auth.openApp')}
    </ExternalLink>
  )

  if (state === 'error') {
    return (
      <div className="tg-login">
        <p className="booking-text">{error === 'not_configured' ? t('booking.error.not_configured') : t('auth.failed')}</p>
        {error !== 'not_configured' && (
          <button type="button" className="tg-login-button" onClick={retry}>
            {t('common.retry')}
          </button>
        )}
        {appLink}
      </div>
    )
  }

  if (state === 'expired') {
    return (
      <div className="tg-login">
        <p className="booking-text">{t('auth.expired')}</p>
        <button type="button" className="tg-login-button" onClick={retry}>
          {t('auth.again')}
        </button>
        {appLink}
      </div>
    )
  }

  const link = request ? telegramBotLink(`login_${request.token}`) : null
  return (
    <div className="tg-login">
      {state !== 'waiting' && text && <p className="booking-text">{text}</p>}
      {state === 'waiting' && (
        <p className="booking-text" role="status">
          {t('auth.waiting')}
        </p>
      )}
      {request && (
        <p className="tg-login-code">
          {t('auth.code')} <b>{request.code}</b>
        </p>
      )}
      {link ? (
        <ExternalLink href={link} className="tg-login-button" onClick={() => setState('waiting')}>
          <Icon name="plane" />
          {state === 'waiting' ? t('auth.openAgain') : t('auth.login')}
        </ExternalLink>
      ) : (
        <button type="button" className="tg-login-button" disabled>
          <Icon name="plane" />
          {t('auth.login')}
        </button>
      )}
      {state !== 'waiting' && appLink}
    </div>
  )
}
