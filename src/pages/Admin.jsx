import { useEffect, useState } from 'react'
import { adminLogin, adminLogout, getAdminSession } from '../lib/adminAuth.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import { adminAction, fetchAdmin } from '../lib/seller.js'

// Админка (/admin): вход по логину и паролю (ADMIN_LOGIN и ADMIN_PASSWORD — настройки на Cloudflare).
// Заявки магазинов (разрешить / отклонить), блокировка, подписка (+30 дней), владельцы магазина,
// переход в кабинет любого магазина.
export default function Admin() {
  const { t } = useI18n()
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getAdminSession()))
  const [shops, setShops] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setError(null)
    fetchAdmin()
      .then((list) => !cancelled && setShops(list))
      .catch((failure) => {
        if (cancelled) return
        if (failure.code === 'auth') setLoggedIn(false)
        else setError(failure.code ?? 'server')
      })
    return () => {
      cancelled = true
    }
  }, [loggedIn, attempt])

  if (!loggedIn) return <AdminLogin onDone={() => setLoggedIn(true)} />
  if (error) {
    return (
      <div className="page-message" role="alert">
        <p>{t(`seller.error.${error}`)}</p>
        <button type="button" className="primary-button" onClick={() => setAttempt((n) => n + 1)}>
          {t('common.retry')}
        </button>
      </div>
    )
  }
  if (shops === undefined) return <p className="page-message">{t('common.loading')}</p>

  const replace = (shop) => setShops((list) => list.map((s) => (s.id === shop.id ? { ...s, ...shop } : s)))
  const counts = shops.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {})
  const shown = filter === 'all' ? shops : shops.filter((s) => s.status === filter)

  return (
    <section className="cab">
      <header className="cab-head">
        <h1 className="search-title">{t('admin.title')}</h1>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            adminLogout()
            setShops(undefined)
            setLoggedIn(false)
          }}
        >
          {t('admin.logout')}
        </button>
      </header>
      <div className="chip-row cab-tabs">
        {['all', 'pending', 'active', 'blocked', 'rejected'].map((name) => (
          <button key={name} type="button" className="chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>
            {t(name === 'all' ? 'admin.all' : `seller.status.${name}`)}
            <span className="search-count">{name === 'all' ? shops.length : (counts[name] ?? 0)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="page-message">{t('admin.empty')}</p>}
      <ul className="cab-list">
        {shown.map((shop) => (
          <AdminShop key={shop.id} shop={shop} onChanged={replace} />
        ))}
      </ul>
    </section>
  )
}

function AdminLogin({ onDone }) {
  const { t } = useI18n()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState({ status: 'idle' })

  async function submit(event) {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await adminLogin(login, password)
      onDone()
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
      setPassword('')
    }
  }

  return (
    <section className="cab">
      <h1 className="search-title">{t('admin.title')}</h1>
      <form className="cab-form" onSubmit={submit}>
        <label className="cab-field">
          <span>{t('admin.login')}</span>
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
        </label>
        <label className="cab-field">
          <span>{t('admin.password')}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {state.status === 'error' && <p className="cab-error">{t(`admin.error.${state.code}`)}</p>}
        <button type="submit" className="primary-button" disabled={state.status === 'saving'}>
          {state.status === 'saving' ? t('common.loading') : t('admin.signIn')}
        </button>
      </form>
    </section>
  )
}

function AdminShop({ shop, onChanged }) {
  const { t, formatDateTime } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [owner, setOwner] = useState('')

  async function act(action, extra) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await adminAction(shop.id, action, extra))
      setOwner('')
    } catch (failure) {
      setError(failure.code ?? 'server')
    } finally {
      setBusy(false)
    }
  }

  const expired = shop.subscription_until && Date.parse(shop.subscription_until) <= Date.now()
  return (
    <li className="cab-card">
      <p className="cab-card-title">
        <b>{shop.name}</b>
        <span className={`cab-status ${shop.status}`}>{t(`seller.status.${shop.status}`)}</span>
      </p>
      <p className="cab-text">
        {[shop.address_ru ?? shop.address_uz, shop.phone, shop.telegram_username && `@${shop.telegram_username}`].filter(Boolean).join(' · ')}
      </p>
      <p className="cab-text">
        {t('admin.products', { n: shop.productCount ?? 0 })} ·{' '}
        {shop.subscription_until
          ? t(expired ? 'admin.subscriptionExpired' : 'seller.subscriptionUntil', { date: formatDateTime(shop.subscription_until) })
          : t('admin.noSubscription')}
        {shop.status === 'active' && !shop.is_active && <> · {t('seller.hidden')}</>}
      </p>
      <p className="cab-text">
        {t('admin.owners')}: {(shop.owner_ids ?? []).join(', ') || '—'}
      </p>

      <div className="cab-actions">
        {shop.status === 'pending' && (
          <>
            <button type="button" className="primary-button" disabled={busy} onClick={() => act('approve')}>
              {t('admin.approve')}
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => act('reject')}>
              {t('admin.reject')}
            </button>
          </>
        )}
        {shop.status === 'active' && (
          <>
            <button type="button" className="primary-button" disabled={busy} onClick={() => act('extend', { days: 30 })}>
              {t('admin.extend30')}
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => act('block')}>
              {t('admin.block')}
            </button>
          </>
        )}
        {(shop.status === 'blocked' || shop.status === 'rejected') && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => act(shop.status === 'rejected' ? 'approve' : 'unblock')}>
            {t('admin.unblock')}
          </button>
        )}
        <Link to={`/my-shop?shop=${shop.id}`} className="link-button">
          {t('admin.openCabinet')}
        </Link>
      </div>

      <div className="cab-actions">
        <input
          className="cab-input"
          inputMode="numeric"
          placeholder={t('admin.ownerId')}
          value={owner}
          onChange={(e) => setOwner(e.target.value.replace(/\D/g, ''))}
        />
        <button type="button" className="link-button" disabled={busy || !owner} onClick={() => act('addOwner', { telegramId: Number(owner) })}>
          {t('admin.addOwner')}
        </button>
        <button type="button" className="link-button" disabled={busy || !owner} onClick={() => act('removeOwner', { telegramId: Number(owner) })}>
          {t('admin.removeOwner')}
        </button>
      </div>
      {error && <p className="cab-error">{t(`seller.error.${error}`)}</p>}
    </li>
  )
}
