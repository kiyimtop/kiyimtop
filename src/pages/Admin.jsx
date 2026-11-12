import { useEffect, useMemo, useState } from 'react'
import AuthForm from '../components/AuthForm.jsx'
import Icon from '../components/Icon.jsx'
import {
  adminAction,
  cancelBookingAdmin,
  deleteBooking,
  deleteCategory,
  deleteProductAdmin,
  fetchAdminShops,
  fetchAllBookings,
  fetchAllCategories,
  fetchAllProducts,
  fetchAnalytics,
  fetchCleanup,
  fetchLog,
  fetchSettings,
  fetchUsers,
  ROLES,
  runCleanup,
  saveCategory,
  saveSettings,
  setProductActive,
  setUserBlocked,
  setUserRole,
} from '../lib/admin.js'
import { formatPhone, useAccount } from '../lib/auth.js'
import { bookingState } from '../lib/bookings.js'
import { photoSrc } from '../lib/catalog.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'

// Админ-панель (/admin) — как в TheStarth: всё прямо в базе Firebase, доступ решают правила.
// Открывается админу и модератору. Вкладки:
//   «Аналитика» — пользователи, магазины, брони, доход от подписок по месяцам, цена подписки;
//   «Магазины» — заявки, подписки (+30 дней с суммой оплаты), владельцы, блокировка;
//   «Пользователи» — поиск, роли (только админ), блокировка;
//   «Каталог» — категории (добавить, изменить, удалить пустую) и все товары (скрыть, удалить);
//   «Брони» — все брони: отменить, удалить;
//   «Журнал» — кто из админов что сделал (только админ).
const SECTIONS = ['analytics', 'shops', 'users', 'catalog', 'bookings', 'log']

export default function Admin() {
  const { t } = useI18n()
  const account = useAccount()
  const [section, setSection] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab')
    return SECTIONS.includes(fromUrl) ? fromUrl : 'shops'
  })

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
  const me = account.profile
  if (!me?.isStaff) {
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

  const sections = SECTIONS.filter((name) => name !== 'log' || me.isAdmin)
  return (
    <section className="cab adm">
      <header className="cab-topbar">
        <h1 className="search-title">{t('admin.title')}</h1>
        <span className="profile-badge">
          <Icon name="shield" />
          {t(`role.${me.role}`)}
        </span>
      </header>
      <div className="chip-row cab-tabs adm-tabs" role="tablist">
        {sections.map((name) => (
          <button key={name} type="button" role="tab" className="chip" aria-pressed={section === name} onClick={() => setSection(name)}>
            {t(`admin.section.${name}`)}
          </button>
        ))}
      </div>
      {section === 'analytics' && <AnalyticsSection me={me} />}
      {section === 'shops' && <ShopsSection />}
      {section === 'users' && <UsersSection me={me} />}
      {section === 'catalog' && <CatalogSection />}
      {section === 'bookings' && <BookingsSection />}
      {section === 'log' && me.isAdmin && <LogSection />}
    </section>
  )
}

// Загрузка данных вкладки: { data, error, reload }.
function useLoad(load, deps = []) {
  const [data, setData] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(null)
    load()
      .then((d) => !cancelled && setData(d))
      .catch((failure) => !cancelled && setError(failure.code ?? 'server'))
    return () => {
      cancelled = true
    }
  }, [attempt, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, setData, error, reload: () => setAttempt((n) => n + 1) }
}

function Loading({ error, onRetry }) {
  const { t } = useI18n()
  if (!error) return <p className="page-message">{t('common.loading')}</p>
  return (
    <div className="page-message" role="alert">
      <p>{t(`seller.error.${error}`)}</p>
      <button type="button" className="primary-button" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  )
}

// ---------- Аналитика ----------
function AnalyticsSection({ me }) {
  const { t, formatPrice } = useI18n()
  const { data, error, reload } = useLoad(fetchAnalytics)
  if (!data) return <Loading error={error} onRetry={reload} />
  const { users, shops, products, bookings, revenue, months, topShops } = data
  return (
    <>
      <h2 className="adm-h2">{t('admin.stats.money')}</h2>
      <div className="cab-summary">
        <Stat value={formatPrice(revenue.thisMonth)} label={t('admin.stats.revenueMonth')} />
        <Stat value={formatPrice(revenue.total)} label={t('admin.stats.revenueTotal')} />
        <Stat value={revenue.payments} label={t('admin.stats.payments')} />
      </div>
      <Bars title={t('admin.stats.revenueByMonth')} rows={months.revenue} format={(n) => shortNumber(n, t)} />
      <PriceSetting canEdit={me.isAdmin} />

      <h2 className="adm-h2">{t('admin.stats.users')}</h2>
      <div className="cab-summary">
        <Stat value={users.total} label={t('admin.stats.usersTotal')} />
        <Stat value={users.newThisMonth} label={t('admin.stats.usersNew')} />
        <Stat value={users.buyers} label={t('admin.stats.buyers')} />
        <Stat value={users.sellers} label={t('admin.stats.sellers')} />
        <Stat value={users.admins + users.moderators} label={t('admin.stats.staff')} />
        <Stat value={users.blocked} label={t('admin.stats.blocked')} attention={users.blocked > 0} />
      </div>
      <Bars title={t('admin.stats.usersByMonth')} rows={months.users} />

      <h2 className="adm-h2">{t('admin.stats.shops')}</h2>
      <div className="cab-summary">
        <Stat value={shops.visible} label={t('admin.stats.shopsVisible')} />
        <Stat value={shops.pending} label={t('admin.statPending')} attention={shops.pending > 0} />
        <Stat value={shops.expiringSoon} label={t('admin.stats.expiring')} attention={shops.expiringSoon > 0} />
        <Stat value={shops.total} label={t('admin.statAll')} />
        <Stat value={products.active} label={t('admin.stats.products')} />
        <Stat value={products.pieces} label={t('admin.stats.pieces')} />
      </div>

      <h2 className="adm-h2">{t('admin.stats.bookings')}</h2>
      <div className="cab-summary">
        <Stat value={bookings.active} label={t('admin.stats.bookingsActive')} />
        <Stat value={bookings.status.picked_up ?? 0} label={t('admin.stats.pickedUp')} />
        <Stat value={formatPrice(bookings.pickedUpValue)} label={t('admin.stats.pickedUpValue')} />
        <Stat value={bookings.total} label={t('admin.stats.bookingsTotal')} />
      </div>
      <Bars title={t('admin.stats.bookingsByMonth')} rows={months.bookings} />
      {topShops.length > 0 && (
        <div className="cab-card">
          <p className="cab-card-title">
            <b>{t('admin.stats.topShops')}</b>
          </p>
          <ol className="adm-top">
            {topShops.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <b>{s.n}</b>
              </li>
            ))}
          </ol>
        </div>
      )}
      <button type="button" className="link-button" onClick={reload}>
        ↻ {t('admin.refresh')}
      </button>
    </>
  )
}

// 300000 → «300 тыс», 1250000 → «1,3 млн» (для подписей над столбиками).
const shortNumber = (n, t) => {
  if (n >= 1_000_000) return t('admin.stats.mln', { n: String(Math.round(n / 100_000) / 10).replace('.', ',') })
  if (n >= 1_000) return t('admin.stats.k', { n: Math.round(n / 1000) })
  return String(n)
}

function Stat({ value, label, attention }) {
  return (
    <div className={`cab-stat ${attention ? 'attention' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

// Простой столбчатый график по месяцам.
function Bars({ title, rows, format = (n) => n }) {
  const { language } = useI18n()
  const max = Math.max(1, ...rows.map((r) => r.value))
  const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'uz-UZ', { month: 'short' })
  return (
    <div className="cab-card adm-bars-card">
      <p className="cab-card-title">
        <b>{title}</b>
      </p>
      <div className="adm-bars">
        {rows.map((r) => (
          <div key={r.month} className="adm-bar">
            <span className="adm-bar-value">{r.value ? format(r.value) : ''}</span>
            <span className="adm-bar-fill" style={{ height: `${Math.max(3, (r.value / max) * 100)}%` }} />
            <span className="adm-bar-label">{monthName(r.month)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Цена подписки в месяц — подставляется, когда админ продлевает магазин.
function PriceSetting({ canEdit }) {
  const { t, formatPrice } = useI18n()
  const { data } = useLoad(fetchSettings)
  const [price, setPrice] = useState('')
  const [state, setState] = useState(null)
  useEffect(() => setPrice(String(data?.subscription_price ?? '')), [data])
  if (!data) return null
  async function save(event) {
    event.preventDefault()
    setState('saving')
    try {
      await saveSettings({ subscription_price: Math.max(0, Math.round(Number(price.replace(/\s/g, '')) || 0)) })
      setState('saved')
    } catch {
      setState('error')
    }
  }
  return (
    <form className="cab-card" onSubmit={save}>
      <label className="cab-field">
        <span>{t('admin.stats.price')}</span>
        {canEdit ? (
          <input inputMode="numeric" value={price} onChange={(e) => (setPrice(e.target.value), setState(null))} placeholder="300000" />
        ) : (
          <b>{data.subscription_price ? formatPrice(data.subscription_price) : '—'}</b>
        )}
      </label>
      <p className="cab-text cab-muted">{t('admin.stats.priceHint')}</p>
      {canEdit && (
        <button type="submit" className="secondary-button" disabled={state === 'saving'}>
          {t('account.save')}
        </button>
      )}
      {state === 'saved' && <p className="cab-text">✓ {t('account.saved')}</p>}
      {state === 'error' && <p className="cab-error">{t('seller.error.server')}</p>}
    </form>
  )
}

// ---------- Магазины ----------
function ShopsSection() {
  const { t } = useI18n()
  const { data: shops, setData: setShops, error, reload } = useLoad(fetchAdminShops)
  const { data: settings } = useLoad(fetchSettings)
  const [filter, setFilter] = useState(null)
  const [query, setQuery] = useState('')

  const counts = useMemo(() => (shops ?? []).reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {}), [shops])
  useEffect(() => {
    if (shops && filter === null) setFilter(shops.some((s) => s.status === 'pending') ? 'pending' : 'all')
  }, [shops, filter])

  if (!shops) return <Loading error={error} onRetry={reload} />
  const replace = (shop) => setShops((list) => list.map((s) => (s.id === shop.id ? { ...s, ...shop } : s)))
  const q = query.trim().toLowerCase()
  const shown = shops
    .filter((s) => !filter || filter === 'all' || s.status === filter)
    .filter((s) => !q || [s.name, s.phone, s.address_ru, s.address_uz].some((v) => v?.toLowerCase().includes(q)))

  return (
    <>
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
          <AdminShop key={shop.id} shop={shop} price={settings?.subscription_price ?? 0} onChanged={replace} />
        ))}
      </ul>
      <TestDataCleanup onDone={reload} />
    </>
  )
}

// Тестовые магазины «(demo)» с товарами и бронями — одной кнопкой (только админ: удалять магазины может он).
// Блок виден, только пока такие данные есть.
function TestDataCleanup({ onDone }) {
  const { t } = useI18n()
  const { profile } = useAccount()
  const [counts, setCounts] = useState(null)
  const [state, setState] = useState(null) // working | done | error

  useEffect(() => {
    fetchCleanup()
      .then(setCounts)
      .catch(() => setCounts(null))
  }, [])

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  if (!profile?.isAdmin) return null
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
      <p className="cab-text cab-muted">{t('admin.cleanupText', { shops: counts.shops, products: counts.products, bookings: counts.bookings })}</p>
      <button type="button" className="link-button cab-danger" disabled={state === 'working'} onClick={run}>
        {state === 'working' ? t('common.loading') : t('admin.cleanupButton')}
      </button>
      {state === 'error' && <p className="cab-error">{t('seller.error.server')}</p>}
    </div>
  )
}

function AdminShop({ shop, price, onChanged }) {
  const { t, language, formatDate, formatPrice } = useI18n()
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

  // +30 дней: спрашиваем, сколько заплатили (для «Аналитики»). 0 — бесплатно (например, бонус).
  function extend() {
    const answer = window.prompt(t('admin.extendAmount', { name: shop.name }), String(price || 0))
    if (answer === null) return
    const amount = Math.max(0, Math.round(Number(answer.replace(/\s/g, '')) || 0))
    act('extend', { days: 30, amount })
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
            <button type="button" className="primary-button" disabled={busy} onClick={extend}>
              {t('admin.extend30')}
              {price > 0 && <small> · {formatPrice(price)}</small>}
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

// ---------- Пользователи и роли ----------
function UsersSection({ me }) {
  const { t, formatDate } = useI18n()
  const { data: users, setData: setUsers, error, reload } = useLoad(fetchUsers)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [limit, setLimit] = useState(50)

  if (!users) return <Loading error={error} onRetry={reload} />

  const q = query.trim().toLowerCase().replace(/[\s()-]/g, '')
  const filtered = users
    .filter((u) => roleFilter === 'all' || (roleFilter === 'blocked' ? u.blocked : (u.role ?? 'buyer') === roleFilter))
    .filter((u) => !q || [u.email, u.name, u.phone, u.telegram?.username].some((v) => String(v ?? '').toLowerCase().replace(/[\s()-]/g, '').includes(q)))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  const count = (name) => users.filter((u) => (name === 'blocked' ? u.blocked : (u.role ?? 'buyer') === name)).length

  async function change(user, work, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(user.uid)
    setActionError(null)
    try {
      const patch = await work()
      setUsers((list) => list.map((u) => (u.uid === user.uid ? { ...u, ...patch } : u)))
    } catch (failure) {
      setActionError(failure.code ?? 'server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="cab-text cab-muted">{t(me.isAdmin ? 'admin.usersText' : 'admin.usersTextModerator')}</p>
      <div className="chip-row cab-tabs">
        {['all', 'buyer', 'seller', 'moderator', 'admin', 'blocked'].map((name) => (
          <button key={name} type="button" className="chip" aria-pressed={roleFilter === name} onClick={() => setRoleFilter(name)}>
            {t(name === 'all' ? 'admin.all' : name === 'blocked' ? 'admin.blockedUsers' : `role.${name}`)}
            <span className="search-count">{name === 'all' ? users.length : count(name)}</span>
          </button>
        ))}
      </div>
      <input className="cab-input" type="search" placeholder={t('admin.usersSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {actionError && <p className="cab-error">{t(`seller.error.${actionError}`)}</p>}
      {filtered.length === 0 && (
        <div className="cab-empty">
          <b>{t('admin.noUsers')}</b>
        </div>
      )}
      <ul className="cab-list">
        {filtered.slice(0, limit).map((user) => {
          const self = user.uid === me.uid
          const protectedUser = !me.isAdmin && ['admin', 'moderator'].includes(user.role)
          return (
            <li key={user.uid} className={`cab-card user-row ${user.blocked ? 'adm-blocked' : ''}`}>
              <p className="cab-card-title">
                <span className="user-who">
                  <b>{user.name || user.email}</b>
                  <span>{user.email}</span>
                  {user.phone && <a href={`tel:${user.phone}`}>{formatPhone(user.phone)}</a>}
                </span>
                {user.role && (
                  <span className="profile-badge">
                    <Icon name="shield" />
                    {t(`role.${user.role}`)}
                  </span>
                )}
              </p>
              <p className="cab-text cab-muted">
                {[
                  user.blocked ? `⛔ ${t('admin.isBlocked')}` : null,
                  user.emailVerified ? t('admin.emailOk') : t('admin.emailNotVerified'),
                  user.telegram ? `Telegram${user.telegram.username ? ' @' + user.telegram.username : ''}` : t('admin.noTelegram'),
                  user.created_at ? t('admin.registered', { date: formatDate(user.created_at) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {self ? (
                <p className="cab-text cab-muted">{t('admin.thisIsYou')}</p>
              ) : (
                <div className="cab-actions adm-user-actions">
                  {me.isAdmin && (
                    <label className="adm-role">
                      <span>{t('admin.role')}</span>
                      <select
                        className="cab-input"
                        value={user.role ?? ''}
                        disabled={busy === user.uid}
                        onChange={(e) => {
                          const role = e.target.value || null
                          change(user, async () => (await setUserRole(user.uid, role), { role, isAdmin: role === 'admin' }), t('admin.confirmRole', { email: user.email ?? user.uid, role: t(`role.${role ?? 'buyer'}`) }))
                        }}
                      >
                        {ROLES.map((role) => (
                          <option key={role ?? 'buyer'} value={role ?? ''}>
                            {t(`role.${role ?? 'buyer'}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!protectedUser && (
                    <button
                      type="button"
                      className={user.blocked ? 'secondary-button' : 'link-button cab-danger'}
                      disabled={busy === user.uid}
                      onClick={() =>
                        change(
                          user,
                          async () => (await setUserBlocked(user.uid, !user.blocked), { blocked: !user.blocked }),
                          t(user.blocked ? 'admin.confirmUnblockUser' : 'admin.confirmBlockUser', { email: user.email ?? user.uid }),
                        )
                      }
                    >
                      {t(user.blocked ? 'admin.unblockUser' : 'admin.blockUser')}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {filtered.length > limit && (
        <button type="button" className="secondary-button" onClick={() => setLimit((n) => n + 50)}>
          {t('admin.showMore', { n: filtered.length - limit })}
        </button>
      )}
    </>
  )
}

const roleRank = (role) => ({ admin: 0, moderator: 1, seller: 2 })[role] ?? 3

// ---------- Каталог: категории и товары ----------
function CatalogSection() {
  const { t } = useI18n()
  const [part, setPart] = useState('categories')
  return (
    <>
      <div className="auth-tabs" role="tablist">
        {['categories', 'products'].map((name) => (
          <button key={name} type="button" role="tab" className="auth-tab" aria-selected={part === name} onClick={() => setPart(name)}>
            {t(`admin.catalog.${name}`)}
          </button>
        ))}
      </div>
      {part === 'categories' ? <CategoriesPart /> : <ProductsPart />}
    </>
  )
}

function CategoriesPart() {
  const { t, language } = useI18n()
  const { data: categories, error, reload } = useLoad(fetchAllCategories)
  const [editing, setEditing] = useState(null) // {} — новая
  const [actionError, setActionError] = useState(null)

  if (!categories) return <Loading error={error} onRetry={reload} />
  if (editing) {
    return (
      <CategoryForm
        initial={editing}
        nextOrder={Math.max(0, ...categories.map((c) => c.sort_order ?? 0)) + 1}
        onDone={() => {
          setEditing(null)
          reload()
        }}
      />
    )
  }

  async function remove(category) {
    if (!window.confirm(t('admin.catalog.deleteConfirm', { name: category[`name_${language}`] ?? category.id }))) return
    setActionError(null)
    try {
      await deleteCategory(category.id)
      reload()
    } catch (failure) {
      setActionError(failure.code ?? 'server')
    }
  }

  return (
    <>
      <button type="button" className="primary-button cab-add" onClick={() => setEditing({})}>
        + {t('admin.catalog.addCategory')}
      </button>
      {actionError && <p className="cab-error">{t(`admin.catalog.error.${actionError}`, {}, t(`seller.error.${actionError}`))}</p>}
      <ul className="cab-list">
        {categories.map((c) => (
          <li key={c.id} className="cab-card adm-row">
            <span className="adm-emoji" aria-hidden="true">
              {c.emoji ?? '•'}
            </span>
            <span className="adm-row-text">
              <b>{c[`name_${language}`] ?? c.name_ru}</b>
              <span>
                /c/{c.slug ?? c.id} · {t('admin.catalog.order')}: {c.sort_order ?? 0}
              </span>
            </span>
            <button type="button" className="secondary-button" onClick={() => setEditing(c)}>
              {t('admin.edit')}
            </button>
            <button type="button" className="link-button cab-danger" onClick={() => remove(c)}>
              {t('admin.delete')}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function CategoryForm({ initial, nextOrder, onDone }) {
  const { t } = useI18n()
  const isNew = !initial.id
  const [form, setForm] = useState({
    slug: initial.slug ?? initial.id ?? '',
    name_uz: initial.name_uz ?? '',
    name_ru: initial.name_ru ?? '',
    emoji: initial.emoji ?? '',
    sort_order: String(initial.sort_order ?? nextOrder),
  })
  const [state, setState] = useState({ status: 'idle' })
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function save(event) {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await saveCategory(form, isNew)
      onDone()
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    }
  }

  return (
    <form className="cab-form cab-card" onSubmit={save}>
      <button type="button" className="link-button cab-back" onClick={onDone}>
        ← {t('admin.back')}
      </button>
      <h2 className="adm-h2">{t(isNew ? 'admin.catalog.addCategory' : 'admin.catalog.editCategory')}</h2>
      <label className="cab-field">
        <span>{t('admin.catalog.slug')}</span>
        <input value={form.slug} onChange={set('slug')} disabled={!isNew} pattern="[a-z0-9\-]{2,40}" placeholder="t-shirts" required />
        <small className="auth-hint">{t('admin.catalog.slugHint')}</small>
      </label>
      <div className="auth-row">
        <label className="cab-field">
          <span>{t('admin.catalog.nameUz')}</span>
          <input value={form.name_uz} onChange={set('name_uz')} maxLength={60} required />
        </label>
        <label className="cab-field">
          <span>{t('admin.catalog.nameRu')}</span>
          <input value={form.name_ru} onChange={set('name_ru')} maxLength={60} required />
        </label>
      </div>
      <div className="auth-row">
        <label className="cab-field">
          <span>{t('admin.catalog.emoji')}</span>
          <input value={form.emoji} onChange={set('emoji')} maxLength={8} placeholder="👕" />
        </label>
        <label className="cab-field">
          <span>{t('admin.catalog.order')}</span>
          <input value={form.sort_order} onChange={set('sort_order')} inputMode="numeric" />
        </label>
      </div>
      {state.status === 'error' && <p className="cab-error">{t(`admin.catalog.error.${state.code}`, {}, t(`seller.error.${state.code}`))}</p>}
      <button type="submit" className="primary-button" disabled={state.status === 'saving'}>
        {state.status === 'saving' ? t('common.loading') : t('account.save')}
      </button>
    </form>
  )
}

function ProductsPart() {
  const { t, language, formatPrice } = useI18n()
  const { data: products, setData: setProducts, error, reload } = useLoad(fetchAllProducts)
  const [query, setQuery] = useState('')
  const [onlyHidden, setOnlyHidden] = useState(false)
  const [limit, setLimit] = useState(50)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  if (!products) return <Loading error={error} onRetry={reload} />
  const q = query.trim().toLowerCase()
  const shown = products
    .filter((p) => !onlyHidden || !p.is_active)
    .filter((p) => !q || [p.name_uz, p.name_ru, p.brand, p.shop_name, p.category_id].some((v) => String(v ?? '').toLowerCase().includes(q)))

  async function act(product, work, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(product.id)
    setActionError(null)
    try {
      await work()
    } catch (failure) {
      setActionError(failure.code ?? 'server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <input className="cab-input" type="search" placeholder={t('admin.catalog.searchProducts')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chip-row cab-tabs">
        <button type="button" className="chip" aria-pressed={!onlyHidden} onClick={() => setOnlyHidden(false)}>
          {t('admin.all')} <span className="search-count">{products.length}</span>
        </button>
        <button type="button" className="chip" aria-pressed={onlyHidden} onClick={() => setOnlyHidden(true)}>
          {t('seller.hiddenProduct')} <span className="search-count">{products.filter((p) => !p.is_active).length}</span>
        </button>
      </div>
      {actionError && <p className="cab-error">{t(`seller.error.${actionError}`)}</p>}
      {shown.length === 0 && (
        <div className="cab-empty">
          <b>{t('admin.empty')}</b>
        </div>
      )}
      <ul className="cab-list">
        {shown.slice(0, limit).map((p) => {
          const pieces = (p.variants ?? []).reduce((s, v) => s + (v.quantity ?? 0), 0)
          return (
            <li key={p.id} className={`cab-card adm-row ${p.is_active ? '' : 'adm-hidden'}`}>
              {p.photo_urls?.[0] ? <img className="adm-thumb" src={photoSrc(p.photo_urls[0])} alt="" loading="lazy" /> : <span className="cab-thumb" />}
              <span className="adm-row-text">
                <b>{p[`name_${language}`] ?? p.name_ru}</b>
                <span>
                  {p.shop_name} · {formatPrice(p.price)} · {t('seller.pieces', { n: pieces })}
                </span>
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={busy === p.id}
                onClick={() =>
                  act(p, async () => {
                    await setProductActive(p.id, !p.is_active)
                    setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, is_active: !p.is_active } : x)))
                  })
                }
              >
                {t(p.is_active ? 'admin.hide' : 'admin.show')}
              </button>
              <Link to={`/my-shop?shop=${p.shop_id}`} className="link-button">
                {t('admin.edit')}
              </Link>
              <button
                type="button"
                className="link-button cab-danger"
                disabled={busy === p.id}
                onClick={() =>
                  act(
                    p,
                    async () => {
                      await deleteProductAdmin(p.id, p.name_ru)
                      setProducts((list) => list.filter((x) => x.id !== p.id))
                    },
                    t('seller.deleteConfirm'),
                  )
                }
              >
                {t('admin.delete')}
              </button>
            </li>
          )
        })}
      </ul>
      {shown.length > limit && (
        <button type="button" className="secondary-button" onClick={() => setLimit((n) => n + 50)}>
          {t('admin.showMore', { n: shown.length - limit })}
        </button>
      )}
    </>
  )
}

// ---------- Брони ----------
function BookingsSection() {
  const { t, language, formatDateTime, formatPrice } = useI18n()
  const { data: bookings, setData: setBookings, error, reload } = useLoad(fetchAllBookings)
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  if (!bookings) return <Loading error={error} onRetry={reload} />
  const stateOf = (b) => bookingState(b)
  const isOpen = (b) => ['new', 'confirmed'].includes(stateOf(b))
  const q = query.trim().toLowerCase()
  const shown = bookings
    .filter((b) => (filter === 'open' ? isOpen(b) : filter === 'all' ? true : stateOf(b) === filter))
    .filter((b) => !q || [b.code, b.buyer_name, b.buyer_phone, b.buyer_email, b.shop?.name, b.product_name_ru, b.product_name_uz].some((v) => String(v ?? '').toLowerCase().includes(q)))
  const count = (name) => bookings.filter((b) => (name === 'open' ? isOpen(b) : name === 'all' ? true : stateOf(b) === name)).length

  async function act(b, work, confirmText) {
    if (!window.confirm(confirmText)) return
    setBusy(b.id)
    setActionError(null)
    try {
      await work()
    } catch (failure) {
      setActionError(failure.code ?? 'server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="chip-row cab-tabs">
        {['open', 'picked_up', 'cancelled', 'expired', 'unavailable', 'all'].map((name) => (
          <button key={name} type="button" className="chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>
            {t(name === 'all' ? 'admin.all' : name === 'open' ? 'admin.bookings.open' : `seller.bookingStatus.${name}`)}
            <span className="search-count">{count(name)}</span>
          </button>
        ))}
      </div>
      <input className="cab-input" type="search" placeholder={t('admin.bookings.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {actionError && <p className="cab-error">{t(`seller.error.${actionError}`)}</p>}
      {shown.length === 0 && (
        <div className="cab-empty">
          <b>{t('admin.empty')}</b>
        </div>
      )}
      <ul className="cab-list">
        {shown.slice(0, limit).map((b) => {
          const state = stateOf(b)
          return (
            <li key={b.id} className="cab-card">
              <p className="cab-card-title">
                <b>{b[`product_name_${language}`] ?? b.product_name_ru}</b>
                <span className={`booking-status ${state}`}>{t(`seller.bookingStatus.${state}`)}</span>
              </p>
              <p className="cab-text">
                {[b[`color_${language}`], b.size].filter(Boolean).join(' · ')} · {formatPrice(b.price ?? 0)} · {b.shop?.name ?? '—'}
              </p>
              <p className="cab-text">
                {t('booking.code')}: <b className="cab-code">{b.code}</b> · {formatDateTime(b.created_at)}
              </p>
              <p className="cab-text cab-muted">
                {[b.buyer_name, b.buyer_phone && formatPhone(b.buyer_phone), b.buyer_email].filter(Boolean).join(' · ')}
              </p>
              <div className="cab-actions">
                {isOpen(b) && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy === b.id}
                    onClick={() =>
                      act(b, async () => {
                        await cancelBookingAdmin(b.id)
                        setBookings((list) => list.map((x) => (x.id === b.id ? { ...x, status: 'cancelled' } : x)))
                      }, t('admin.bookings.cancelConfirm', { code: b.code }))
                    }
                  >
                    {t('admin.bookings.cancel')}
                  </button>
                )}
                <button
                  type="button"
                  className="link-button cab-danger"
                  disabled={busy === b.id}
                  onClick={() =>
                    act(b, async () => {
                      await deleteBooking(b)
                      setBookings((list) => list.filter((x) => x.id !== b.id))
                    }, t('admin.bookings.deleteConfirm', { code: b.code }))
                  }
                >
                  {t('admin.delete')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {shown.length > limit && (
        <button type="button" className="secondary-button" onClick={() => setLimit((n) => n + 50)}>
          {t('admin.showMore', { n: shown.length - limit })}
        </button>
      )}
      <p className="cab-text cab-muted">{t('admin.bookings.reviewsNote')}</p>
    </>
  )
}

// ---------- Журнал ----------
function LogSection() {
  const { t, formatDateTime } = useI18n()
  const { data: log, error, reload } = useLoad(fetchLog)
  if (!log) return <Loading error={error} onRetry={reload} />
  if (!log.length) {
    return (
      <div className="cab-empty">
        <b>{t('admin.log.empty')}</b>
      </div>
    )
  }
  return (
    <ul className="cab-list adm-log">
      {log.map((entry) => (
        <li key={entry.id} className="cab-card">
          <p className="cab-card-title">
            <b>{t(`admin.log.${entry.action}`, {}, entry.action)}</b>
            <span className="cab-muted">{entry.at ? formatDateTime(entry.at) : ''}</span>
          </p>
          <p className="cab-text cab-muted">
            {[entry.by_email, entry.details?.name, entry.details?.email, entry.details?.role && t(`role.${entry.details.role}`), entry.details?.amount && `${entry.details.amount}`, entry.details?.code]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  )
}
