import { useEffect, useMemo, useState } from 'react'
import { adminLogin, adminLogout, getAdminSession } from '../lib/adminAuth.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import { adminAction, fetchAdmin } from '../lib/seller.js'

// Админка (/admin): вход по логину и паролю (ADMIN_LOGIN и ADMIN_PASSWORD — настройки на Cloudflare).
// Сверху — сколько заявок ждут решения; вкладки по статусу; поиск по названию.
// В карточке магазина — только главное и одна-две главные кнопки; редкие действия
// (владельцы, блокировка) — в свёрнутом блоке «Управление».
export default function Admin() {
  const { t } = useI18n()
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getAdminSession()))
  const [shops, setShops] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setError(null)
    fetchAdmin()
      .then((list) => {
        if (cancelled) return
        setShops(list)
        // Есть заявки — открываем сразу их.
        setFilter((current) => current ?? (list.some((s) => s.status === 'pending') ? 'pending' : 'all'))
      })
      .catch((failure) => {
        if (cancelled) return
        if (failure.code === 'auth') setLoggedIn(false)
        else setError(failure.code ?? 'server')
      })
    return () => {
      cancelled = true
    }
  }, [loggedIn, attempt])

  const counts = useMemo(
    () => (shops ?? []).reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {}),
    [shops],
  )

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
  const q = query.trim().toLowerCase()
  const shown = shops
    .filter((s) => filter === 'all' || s.status === filter)
    .filter((s) => !q || [s.name, s.phone, s.address_ru, s.address_uz].some((v) => v?.toLowerCase().includes(q)))

  return (
    <section className="cab">
      <header className="cab-topbar">
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

      {/* Сводка: что требует внимания. */}
      <div className="cab-summary">
        <button type="button" className={`cab-stat ${counts.pending ? 'attention' : ''}`} onClick={() => setFilter('pending')}>
          <b>{counts.pending ?? 0}</b>
          <span>{t('admin.statPending')}</span>
        </button>
        <button type="button" className="cab-stat" onClick={() => setFilter('active')}>
          <b>{counts.active ?? 0}</b>
          <span>{t('admin.statActive')}</span>
        </button>
        <button type="button" className="cab-stat" onClick={() => setFilter('all')}>
          <b>{shops.length}</b>
          <span>{t('admin.statAll')}</span>
        </button>
      </div>

      <div className="chip-row cab-tabs">
        {['all', 'pending', 'active', 'blocked', 'rejected'].map((name) => (
          <button key={name} type="button" className="chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>
            {t(name === 'all' ? 'admin.all' : `seller.status.${name}`)}
            <span className="search-count">{name === 'all' ? shops.length : (counts[name] ?? 0)}</span>
          </button>
        ))}
      </div>
      <input className="cab-input" type="search" placeholder={t('admin.search')} value={query} onChange={(e) => setQuery(e.target.value)} />

      {shown.length === 0 && (
        <div className="cab-empty">
          <b>{t(filter === 'pending' ? 'admin.noPending' : 'admin.empty')}</b>
        </div>
      )}
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
    <section className="cab cab-narrow">
      <h1 className="search-title">{t('admin.title')}</h1>
      <p className="cab-text cab-muted">{t('admin.loginText')}</p>
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
  const { t, language, formatDate } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [owner, setOwner] = useState('')

  async function act(action, extra, confirmKey) {
    if (confirmKey && !window.confirm(t(confirmKey, { name: shop.name }))) return
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
  const address = shop[`address_${language}`] ?? shop.address_uz ?? shop.address_ru
  return (
    <li className={`cab-card ${shop.status === 'pending' ? 'cab-card-attention' : ''}`}>
      <p className="cab-card-title">
        <b>{shop.name}</b>
        <span className={`cab-status ${shop.status}`}>{t(`seller.status.${shop.status}`)}</span>
      </p>
      <dl className="cab-facts">
        {address && (
          <>
            <dt>{t('admin.address')}</dt>
            <dd>{address}</dd>
          </>
        )}
        <dt>{t('admin.phone')}</dt>
        <dd>
          {shop.phone ? <a href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}>{shop.phone}</a> : '—'}
          {shop.telegram_username && (
            <>
              {' · '}
              <a href={`https://t.me/${shop.telegram_username}`} target="_blank" rel="noreferrer">
                @{shop.telegram_username}
              </a>
            </>
          )}
        </dd>
        {shop.status !== 'pending' && (
          <>
            <dt>{t('admin.productsLabel')}</dt>
            <dd>{shop.productCount ?? 0}</dd>
            <dt>{t('admin.subscription')}</dt>
            <dd className={expired ? 'cab-error' : ''}>
              {shop.subscription_until
                ? t(expired ? 'admin.subscriptionExpired' : 'admin.until', { date: formatDate(shop.subscription_until) })
                : t('admin.noSubscription')}
            </dd>
          </>
        )}
      </dl>

      {/* Главные действия. */}
      <div className="cab-actions">
        {shop.status === 'pending' && (
          <>
            <button type="button" className="primary-button" disabled={busy} onClick={() => act('approve')}>
              ✅ {t('admin.approve')}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => act('reject', undefined, 'admin.confirmReject')}>
              {t('admin.reject')}
            </button>
          </>
        )}
        {shop.status === 'active' && (
          <>
            <button type="button" className="primary-button" disabled={busy} onClick={() => act('extend', { days: 30 })}>
              {t('admin.extend30')}
            </button>
            <Link to={`/my-shop?shop=${shop.id}`} className="secondary-button">
              {t('admin.openCabinet')}
            </Link>
          </>
        )}
        {(shop.status === 'blocked' || shop.status === 'rejected') && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => act(shop.status === 'rejected' ? 'approve' : 'unblock')}>
            {t('admin.unblock')}
          </button>
        )}
      </div>

      {/* Редкие действия — свёрнуты. */}
      <details className="cab-more">
        <summary>{t('admin.manage')}</summary>
        <p className="cab-text">
          {t('admin.owners')}: {(shop.owner_ids ?? []).join(', ') || '—'}
        </p>
        <div className="cab-inline">
          <input
            className="cab-input"
            inputMode="numeric"
            placeholder={t('admin.ownerId')}
            value={owner}
            onChange={(e) => setOwner(e.target.value.replace(/\D/g, ''))}
          />
          <button type="button" className="secondary-button" disabled={busy || !owner} onClick={() => act('addOwner', { telegramId: Number(owner) })}>
            {t('admin.addOwner')}
          </button>
        </div>
        {owner && (shop.owner_ids ?? []).includes(Number(owner)) && (
          <button type="button" className="link-button cab-danger" disabled={busy} onClick={() => act('removeOwner', { telegramId: Number(owner) })}>
            {t('admin.removeOwner')}
          </button>
        )}
        {shop.status === 'active' && (
          <button type="button" className="link-button cab-danger" disabled={busy} onClick={() => act('block', undefined, 'admin.confirmBlock')}>
            {t('admin.block')}
          </button>
        )}
        {shop.status !== 'pending' && (
          <Link to={`/my-shop?shop=${shop.id}`} className="link-button">
            {t('admin.openCabinet')}
          </Link>
        )}
      </details>
      {error && <p className="cab-error">{t(`seller.error.${error}`)}</p>}
    </li>
  )
}
