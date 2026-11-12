import { useEffect, useState } from 'react'
import AuthForm from '../components/AuthForm.jsx'
import ExternalLink from '../components/ExternalLink.jsx'
import Icon from '../components/Icon.jsx'
import VerifyEmail from '../components/VerifyEmail.jsx'
import { linkThisTelegram, refreshProfile, signOut, startTelegramLink, unlinkTelegram, updateName, useAccount } from '../lib/auth.js'
import { useI18n } from '../lib/i18n.jsx'
import { isTelegram, telegramBotLink } from '../lib/platform.js'
import { Link } from '../lib/router.jsx'

// Профиль (/account). Не вошли — вход и регистрация. Вошли:
//   кто я (имя, email, «Администратор»), подтверждение email, имя, Telegram (привязать / отвязать),
//   ссылки: «Мои брони», «Кабинет магазина», «Админ-панель» (только админу), «Выйти».
export default function Account() {
  const { t } = useI18n()
  const account = useAccount()

  if (account.status === 'loading') return <p className="page-message">{t('common.loading')}</p>
  if (account.status === 'out') {
    return (
      <section className="cab cab-narrow">
        <h1 className="search-title">{t('account.loginTitle')}</h1>
        <AuthForm intro={t('account.loginIntro')} />
      </section>
    )
  }

  const { user, profile, profileError } = account
  const name = profile?.name ?? user.name ?? user.email
  const verified = profile?.emailVerified ?? user.emailVerified
  return (
    <section className="cab cab-narrow">
      <h1 className="search-title">{t('account.title')}</h1>

      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">
          {(name ?? '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="profile-who">
          <b>{name}</b>
          <span>{user.email}</span>
          {profile?.isAdmin && (
            <span className="profile-badge">
              <Icon name="shield" />
              {t('account.adminBadge')}
            </span>
          )}
        </div>
      </div>

      {profileError && (
        <p className="cab-error" role="alert">
          {t(`seller.error.${profileError}`)}{' '}
          <button type="button" className="link-button" onClick={refreshProfile}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {!verified && <VerifyEmail email={user.email} />}

      {/* Куда дальше — главное сверху. */}
      <nav className="profile-links">
        {profile?.isAdmin && (
          <Link to="/admin" className="menu-link profile-admin">
            <Icon name="shield" />
            {t('account.adminPanel')}
            <Icon name="chevron" className="icon menu-link-chevron" />
          </Link>
        )}
        <Link to="/bookings" className="menu-link">
          <Icon name="bag" />
          {t('booking.title')}
          <Icon name="chevron" className="icon menu-link-chevron" />
        </Link>
        <Link to="/my-shop" className="menu-link">
          <Icon name="store" />
          {t('seller.menu')}
          <Icon name="chevron" className="icon menu-link-chevron" />
        </Link>
      </nav>

      {profile && <TelegramCard telegram={profile.telegram} />}
      {profile && <NameCard name={profile.name ?? ''} />}

      <button type="button" className="secondary-button profile-logout" onClick={() => signOut().catch(() => {})}>
        {t('account.logout')}
      </button>
    </section>
  )
}

// Telegram: зачем привязывать, привязать / отвязать.
// На сайте — ссылка на бота (там «Да, привязать»), страница сама увидит, что всё готово.
// В Telegram (Mini App) — одной кнопкой: Telegram сам подтверждает, кто это.
function TelegramCard({ telegram }) {
  const { t } = useI18n()
  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inTelegram = isTelegram()

  // Ждём «Да, привязать» в боте: спрашиваем сервер каждые 3 секунды (до 10 минут) и когда человек вернулся.
  useEffect(() => {
    if (!token || telegram) return
    const started = Date.now()
    const check = () => (Date.now() - started < 10 * 60 * 1000 ? refreshProfile() : setToken(null))
    const timer = setInterval(check, 3000)
    const onReturn = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [token, telegram])

  async function act(work) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(failure.code ?? 'server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cab-card">
      <p className="cab-card-title">
        <b>Telegram</b>
        {telegram ? <span className="cab-status active">{t('account.tgLinked')}</span> : <span className="cab-status">{t('account.tgNotLinked')}</span>}
      </p>
      {telegram ? (
        <>
          <p className="cab-text">
            {[telegram.name, telegram.username && `@${telegram.username}`].filter(Boolean).join(' · ') || telegram.id}
          </p>
          <p className="cab-text cab-muted">{t('account.tgLinkedText')}</p>
          <button type="button" className="link-button cab-danger" disabled={busy} onClick={() => window.confirm(t('account.tgUnlinkConfirm')) && act(unlinkTelegram)}>
            {t('account.tgUnlink')}
          </button>
        </>
      ) : (
        <>
          <p className="cab-text cab-muted">{t('account.tgWhy')}</p>
          {inTelegram ? (
            <button type="button" className="primary-button" disabled={busy} onClick={() => act(linkThisTelegram)}>
              {t('account.tgLinkThis')}
            </button>
          ) : token ? (
            <>
              <ExternalLink href={telegramBotLink(`link_${token}`)} className="primary-button tg-link-button">
                <Icon name="plane" />
                {t('account.tgOpenBot')}
              </ExternalLink>
              <p className="cab-text cab-muted" role="status">
                {t('account.tgWaiting')}
              </p>
            </>
          ) : (
            <button type="button" className="primary-button" disabled={busy} onClick={() => act(async () => setToken(await startTelegramLink()))}>
              <Icon name="plane" />
              {t('account.tgLink')}
            </button>
          )}
        </>
      )}
      {error && <p className="cab-error">{t(`seller.error.${error}`)}</p>}
    </div>
  )
}

// Имя — так его увидит магазин в брони.
function NameCard({ name: saved }) {
  const { t } = useI18n()
  const [name, setName] = useState(saved)
  const [state, setState] = useState(null) // saving | saved | error
  useEffect(() => setName(saved), [saved])

  async function save(event) {
    event.preventDefault()
    setState('saving')
    try {
      await updateName(name)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <form className="cab-card" onSubmit={save}>
      <label className="cab-field">
        <span>{t('auth.name')}</span>
        <input value={name} onChange={(e) => (setName(e.target.value), setState(null))} maxLength={80} required />
      </label>
      <p className="cab-text cab-muted">{t('account.nameHint')}</p>
      {name.trim() !== saved && (
        <button type="submit" className="primary-button" disabled={state === 'saving'}>
          {state === 'saving' ? t('common.loading') : t('account.save')}
        </button>
      )}
      {state === 'saved' && <p className="cab-text">✓ {t('account.saved')}</p>}
      {state === 'error' && <p className="cab-error">{t('seller.error.server')}</p>}
    </form>
  )
}
