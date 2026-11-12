import { useState } from 'react'
import { authConfigured, registerWithEmail, sendPasswordReset, signInWithEmail, signInWithGoogle } from '../lib/auth.js'
import { useI18n } from '../lib/i18n.jsx'
import { isTelegram } from '../lib/platform.js'
import Icon from './Icon.jsx'

// Вход и регистрация (аккаунт Firebase): Google или email + пароль.
// Три режима: «Войти», «Регистрация», «Забыли пароль?».
// В Telegram вход через Google не работает (Google запрещает его во встроенных браузерах),
// поэтому там только email; если Telegram уже привязан к аккаунту — вход происходит сам.
// intro — пояснение сверху («Чтобы забронировать, войдите»).
export default function AuthForm({ intro }) {
  const { t } = useI18n()
  const [mode, setMode] = useState('login') // login | register | reset
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [resetSent, setResetSent] = useState(false)
  const inTelegram = isTelegram()

  if (!authConfigured) return <p className="page-message">{t('auth.error.not_configured')}</p>

  async function run(work) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      if (failure.code) setError(failure.code) // code = null — сами закрыли окно Google
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
    setResetSent(false)
  }

  function submit(event) {
    event.preventDefault()
    if (mode === 'login') return run(() => signInWithEmail(email, password))
    if (mode === 'register') return run(() => registerWithEmail(name, email, password))
    return run(async () => {
      await sendPasswordReset(email)
      setResetSent(true)
    })
  }

  return (
    <div className="auth">
      {intro && <p className="cab-text">{intro}</p>}

      {mode !== 'reset' && (
        <div className="auth-tabs" role="tablist">
          {['login', 'register'].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={mode === name}
              className="auth-tab"
              onClick={() => switchMode(name)}
            >
              {t(`auth.${name}`)}
            </button>
          ))}
        </div>
      )}

      {mode !== 'reset' && !inTelegram && (
        <>
          <button type="button" className="auth-google" disabled={busy} onClick={() => run(signInWithGoogle)}>
            <Icon name="globe" />
            {t('auth.google')}
          </button>
          <p className="auth-or">
            <span>{t('auth.orEmail')}</span>
          </p>
        </>
      )}
      {mode !== 'reset' && inTelegram && <p className="cab-text cab-muted">{t('auth.telegramNote')}</p>}

      {mode === 'reset' && (
        <>
          <h2 className="auth-title">{t('auth.resetTitle')}</h2>
          <p className="cab-text cab-muted">{t('auth.resetText')}</p>
        </>
      )}

      {mode === 'reset' && resetSent ? (
        <p className="auth-success" role="status">
          <Icon name="mail" />
          {t('auth.resetSent', { email })}
        </p>
      ) : (
        <form className="cab-form" onSubmit={submit}>
          {mode === 'register' && (
            <label className="cab-field">
              <span>{t('auth.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
            </label>
          )}
          <label className="cab-field">
            <span>{t('auth.email')}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
          </label>
          {mode !== 'reset' && (
            <label className="cab-field">
              <span>{t('auth.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
              {mode === 'register' && <small className="auth-hint">{t('auth.passwordHint')}</small>}
            </label>
          )}
          {error && (
            <p className="cab-error" role="alert">
              {t(`auth.error.${error}`)}
            </p>
          )}
          <button type="submit" className="primary-button auth-submit" disabled={busy}>
            {busy ? t('common.loading') : t(mode === 'login' ? 'auth.loginButton' : mode === 'register' ? 'auth.registerButton' : 'auth.resetButton')}
          </button>
        </form>
      )}

      {mode === 'login' && (
        <button type="button" className="link-button auth-forgot" onClick={() => switchMode('reset')}>
          {t('auth.forgot')}
        </button>
      )}
      {mode === 'register' && <p className="cab-text cab-muted">{t('auth.registerNote')}</p>}
      {mode === 'reset' && (
        <button type="button" className="link-button auth-forgot" onClick={() => switchMode('login')}>
          ← {t('auth.backToLogin')}
        </button>
      )}
    </div>
  )
}
