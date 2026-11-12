import { useEffect, useMemo, useState } from 'react'
import AuthForm from '../components/AuthForm.jsx'
import Icon from '../components/Icon.jsx'
import { useAccount } from '../lib/auth.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import { adminAction, fetchAdmin, fetchCleanup, fetchUsers, runCleanup, setUserAdmin } from '../lib/seller.js'

// Админ-панель (/admin). Открывается только аккаунту с правами админа (их выдают здесь же,
// во вкладке «Пользователи»; «главные» админы — из ADMIN_EMAILS на Cloudflare).
// Вкладки: «Магазины» (заявки, подписки, владельцы) и «Пользователи» (выдать / снять админа).
export default function Admin() {
  const { t } = useI18n()
  const account = useAccount()
  const [section, setSection] = useState('shops')

  if (account.status === 'loading' || (account.status === 'in' && !account.profile && !account.profileError)) {
    return <p className="page-message">{t('common.loading')}</p>
  }
  if (account.status === 'out') {
    return (
      <section className="cab cab-narrow">
        <h1 className="search-title">{t('admin.title')}</h1>
        <AuthForm intro={t('admin.loginText')} />
      </section>
    )
  }
  if (!account.profile?.isAdmin) {
    return (
      <section className="cab cab-narrow">
        <h1 className="search-title">{t('admin.title')}</h1>
        <div className="cab-empty">
          <b>{t('admin.noAccess')}</b>
          <span>{t('admin.noAccessText', { email: account.user.email ?? '' })}</span>
        </div>
        <Link to="/" className="primary-button">
          {t('nav.home')}
        </Link>
      </section>
    )
  }

  return (
    <section className="cab">
      <header className="cab-topbar">
        <h1 className="search-title">{t('admin.title')}</h1>
      </header>
      <div className="auth-tabs" role="tablist">
        {['shops', 'users'].map((name) => (
          <button key={name} type="button" role="tab" className="auth-tab" aria-selected={section === name} onClick={() => setSection(name)}>
            {t(`admin.section.${name}`)}
          </button>
        ))}
      </div>
      {section === 'shops' ? <ShopsSection /> : <UsersSection me={account.profile} />}
    </section>
  )
}

function ShopsSection() {
  const { t } = useI18n()
  const [shops, setShops] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchAdmin()
      .then((list) => {
        if (cancelled) return
        setShops(list)
        // Есть заявки — открываем сразу их.
        setFilter((current) => current ?? (list.some((s) => s.status === 'pending') ? 'pending' : 'all'))
      })
      .catch((failure) => !cancelled && setError(failure.code ?? 'server'))
    return () => {
      cancelled = true
    }
  }, [attempt])

  const counts = useMemo(
    () => (shops ?? []).reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {}),
    [shops],
  )

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
    <>
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
      <TestDataCleanup onDone={() => setAttempt((n) => n + 1)} />
    </>
  )
}

// Тестовые магазины «(demo)» с товарами, старые брони и запросы на вход — одной кнопкой.
// Блок виден, только пока такие данные есть в базе.
function TestDataCleanup({ onDone }) {
  const { t } = useI18n()
  const [counts, setCounts] = useState(null)
  const [state, setState] = useState(null) // working | done | error

  useEffect(() => {
    fetchCleanup()
      .then(setCounts)
      .catch(() => setCounts(null))
  }, [])

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  if (state === 'done') return <p className="cab-text">✓ {t('admin.cleanupDone')}</p>
  if (!total) return null

  async function run() {
    if (!window.confirm(t('admin.cleanupConfirm', { shops: counts.shops, products: counts.products }))) return
    setState('working')
    try {
      await runCleanup()
      setState('done')
      onDone()
    } catch {
      setState('error')
    }
  }

  return (
    <div className="cab-card cleanup-card">
      <p className="cab-card-title">
        <b>{t('admin.cleanupTitle')}</b>
      </p>
      <p className="cab-text cab-muted">
        {t('admin.cleanupText', { shops: counts.shops, products: counts.products, bookings: counts.bookings })}
      </p>
      <button type="button" className="link-button cab-danger" disabled={state === 'working'} onClick={run}>
        {state === 'working' ? t('common.loading') : t('admin.cleanupButton')}
      </button>
      {state === 'error' && <p className="cab-error">{t('seller.error.server')}</p>}
    </div>
  )
}

// Пользователи: поиск по email и имени, выдать или снять права админа.
function UsersSection({ me }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [data, setData] = useState(undefined)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      fetchUsers(query.trim())
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((failure) => !cancelled && setError(failure.code ?? 'server'))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  async function toggle(user) {
    const key = user.isAdmin ? 'admin.confirmRemoveAdmin' : 'admin.confirmMakeAdmin'
    if (!window.confirm(t(key, { email: user.email ?? user.uid }))) return
    setBusy(user.uid)
    setError(null)
    try {
      const updated = await setUserAdmin(user.uid, !user.isAdmin)
      setData((d) => ({ ...d, users: d.users.map((u) => (u.uid === updated.uid ? updated : u)) }))
    } catch (failure) {
      setError(failure.code ?? 'server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="cab-text cab-muted">{t('admin.usersText')}</p>
      <input className="cab-input" type="search" placeholder={t('admin.usersSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="cab-error">{t(`seller.error.${error}`)}</p>}
      {data === undefined && !error && <p className="page-message">{t('common.loading')}</p>}
      {data?.users.length === 0 && (
        <div className="cab-empty">
          <b>{t('admin.noUsers')}</b>
        </div>
      )}
      <ul className="cab-list">
        {data?.users.map((user) => (
          <li key={user.uid} className="cab-card user-row">
            <p className="cab-card-title">
              <span className="user-who">
                <b>{user.name || user.email}</b>
                <span>{user.email}</span>
              </span>
              {user.isAdmin && (
                <span className="profile-badge">
                  <Icon name="shield" />
                  {t(user.isOwnerAdmin ? 'admin.ownerAdmin' : 'account.adminBadge')}
                </span>
              )}
            </p>
            <p className="cab-text cab-muted">
              {[
                user.emailVerified ? t('admin.emailOk') : t('admin.emailNotVerified'),
                user.telegram ? `Telegram${user.telegram.username ? ' @' + user.telegram.username : ''}` : t('admin.noTelegram'),
              ].join(' · ')}
            </p>
            {user.uid === me.uid ? (
              <p className="cab-text cab-muted">{t('admin.thisIsYou')}</p>
            ) : user.isOwnerAdmin ? null : (
              <button
                type="button"
                className={user.isAdmin ? 'link-button cab-danger' : 'secondary-button'}
                disabled={busy === user.uid}
                onClick={() => toggle(user)}
              >
                {t(user.isAdmin ? 'admin.removeAdmin' : 'admin.makeAdmin')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {data && data.total > data.users.length && <p className="cab-text cab-muted">{t('admin.usersMore', { n: data.total - data.users.length })}</p>}
    </>
  )
}

function AdminShop({ shop, onChanged }) {
  const { t, language, formatDate } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [owner, setOwner] = useState('')

  async function act(action, extra, confirmKey, params) {
    if (confirmKey && !window.confirm(t(confirmKey, { name: shop.name, ...params }))) return
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
          <b>{t('admin.owners')}</b>
        </p>
        {(shop.owners ?? []).length === 0 && <p className="cab-text cab-muted">—</p>}
        <ul className="owner-list">
          {(shop.owners ?? []).map((o) => (
            <li key={o.uid}>
              <span>
                {o.email ?? o.uid}
                {!o.telegram && <small> · {t('admin.noTelegram')}</small>}
              </span>
              <button
                type="button"
                className="link-button cab-danger"
                disabled={busy}
                onClick={() => act('removeOwner', { uid: o.uid }, 'admin.confirmRemoveOwner', { email: o.email ?? o.uid })}
              >
                {t('admin.removeOwner')}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="cab-inline"
          onSubmit={(e) => {
            e.preventDefault()
            act('addOwner', { email: owner.trim() })
          }}
        >
          <input className="cab-input" type="email" placeholder={t('admin.ownerEmail')} value={owner} onChange={(e) => setOwner(e.target.value)} />
          <button type="submit" className="secondary-button" disabled={busy || !owner.includes('@')}>
            {t('admin.addOwner')}
          </button>
        </form>
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
