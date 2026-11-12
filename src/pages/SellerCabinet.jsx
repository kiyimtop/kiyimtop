import { useEffect, useMemo, useState } from 'react'
import TelegramLogin from '../components/TelegramLogin.jsx'
import { getAdminSession } from '../lib/adminAuth.js'
import { useLogin } from '../lib/auth.js'
import { fetchCategories, fetchSearchIndex, photoSrc } from '../lib/catalog.js'
import { DISTRICTS } from '../lib/filters.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import {
  applyShop,
  deleteProduct,
  fetchMe,
  fetchMyShop,
  saveProduct,
  setAdminMode,
  setBookingStatus,
  updateShop,
  uploadPhoto,
} from '../lib/seller.js'

// Кабинет магазина (/my-shop) — и на сайте, и внутри Telegram (кнопка «Кабинет магазина» в боте).
//   нет магазина → заявка; заявка → «ждёт решения администратора»;
//   одобрен → вкладки «Брони», «Товары», «Магазин».
// Админ (вошедший в /admin по паролю) может открыть любой магазин: /my-shop?shop=<номер>.
export default function SellerCabinet() {
  // Открыт из админки (?shop=… и админ вошёл по паролю) — работаем от имени админа.
  const [adminShop] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('shop')
    return id && getAdminSession() ? id : null
  })
  setAdminMode(Boolean(adminShop))
  if (adminShop) {
    return <ShopCabinet id={adminShop} isAdmin canSwitch={false} onSwitch={() => {}} onApply={() => {}} />
  }
  return <SellerHome />
}

function SellerHome() {
  const { t } = useI18n()
  const { loggedIn } = useLogin()
  const [me, setMe] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [shopId, setShopId] = useState(() => new URLSearchParams(window.location.search).get('shop'))
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setError(null)
    fetchMe()
      .then((data) => !cancelled && setMe(data))
      .catch((failure) => !cancelled && setError(failure.code ?? 'server'))
    return () => {
      cancelled = true
    }
  }, [loggedIn, attempt])

  if (!loggedIn) {
    return (
      <section className="cab">
        <h1 className="search-title">{t('seller.title')}</h1>
        <p className="cab-text">{t('seller.intro')}</p>
        <HowItWorks />
        <TelegramLogin text={t('seller.loginWhy')} startParam="shop" onLoggedIn={() => setAttempt((n) => n + 1)} />
      </section>
    )
  }
  if (error) return <ErrorBox code={error} onRetry={() => setAttempt((n) => n + 1)} />
  if (me === undefined) return <p className="page-message">{t('common.loading')}</p>

  const reload = () => setAttempt((n) => n + 1)
  const shops = me.shops
  const current = shopId ?? (shops.length === 1 ? shops[0].id : null)

  if (applying || shops.length === 0) {
    return (
      <section className="cab">
        <h1 className="search-title">{t('seller.applyTitle')}</h1>
        <p className="cab-text">{t('seller.applyText')}</p>
        <ShopForm
          submitLabel={t('seller.applySend')}
          onSubmit={async (data) => {
            const shop = await applyShop(data)
            setApplying(false)
            setShopId(shop.id)
            reload()
          }}
        />
        <p className="cab-text cab-muted">{t('seller.yourId', { id: me.user.id })}</p>
        {shops.length > 0 && (
          <button type="button" className="link-button" onClick={() => setApplying(false)}>
            {t('common.cancel')}
          </button>
        )}
      </section>
    )
  }

  if (!current) {
    return (
      <section className="cab">
        <h1 className="search-title">{t('seller.title')}</h1>
        <ul className="cab-list">
          {shops.map((shop) => (
            <li key={shop.id}>
              <button type="button" className="cab-row" onClick={() => setShopId(shop.id)}>
                <b>{shop.name}</b>
                <span className={`cab-status ${shop.status}`}>{t(`seller.status.${shop.status}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="primary-button" onClick={() => setApplying(true)}>
          {t('seller.applyAnother')}
        </button>
      </section>
    )
  }

  return (
    <ShopCabinet
      key={current}
      id={current}
      isAdmin={me.isAdmin}
      canSwitch={shops.length > 1}
      onSwitch={() => setShopId(null)}
      onApply={() => setApplying(true)}
    />
  )
}

// «Как это работает» — 4 шага, чтобы владелец магазина сразу понял весь путь.
function HowItWorks() {
  const { t } = useI18n()
  return (
    <ol className="cab-steps">
      {[1, 2, 3, 4].map((n) => (
        <li key={n}>
          <b>{t(`seller.step${n}`)}</b>
          <span>{t(`seller.step${n}Text`)}</span>
        </li>
      ))}
    </ol>
  )
}

function ErrorBox({ code, onRetry }) {
  const { t } = useI18n()
  return (
    <div className="page-message" role="alert">
      <p>{t(`seller.error.${code}`)}</p>
      {onRetry && (
        <button type="button" className="primary-button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

function ShopCabinet({ id, isAdmin, canSwitch, onSwitch, onApply }) {
  const { t, language, formatDate, formatPrice } = useI18n()
  const [data, setData] = useState(undefined)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState('bookings')
  const [editing, setEditing] = useState(null) // товар в редакторе ({} — новый)

  useEffect(() => {
    let cancelled = false
    fetchMyShop(id)
      .then((d) => !cancelled && setData(d))
      .catch((failure) => !cancelled && setError(failure.code ?? 'server'))
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  if (error) return <ErrorBox code={error} onRetry={() => (setError(null), setAttempt((n) => n + 1))} />
  if (data === undefined) return <p className="page-message">{t('common.loading')}</p>
  const { shop, products, bookings } = data
  const reload = () => setAttempt((n) => n + 1)

  const header = (
    <header className="cab-head">
      <h1 className="search-title">{shop.name}</h1>
      <p className="cab-text">
        <span className={`cab-status ${shop.status}`}>{t(`seller.status.${shop.status}`)}</span>
        {shop.status === 'active' && shop.subscription_until && (
          <> {t('seller.subscriptionUntil', { date: formatDate(shop.subscription_until) })}</>
        )}
        {shop.status === 'active' && !shop.is_active && <> · {t('seller.hidden')}</>}
      </p>
      {canSwitch && (
        <button type="button" className="link-button" onClick={onSwitch}>
          {t('seller.otherShops')}
        </button>
      )}
    </header>
  )

  if (shop.status !== 'active' && !isAdmin) {
    return (
      <section className="cab">
        {header}
        <p className="cab-text">{t(`seller.statusText.${shop.status}`)}</p>
        {shop.status !== 'pending' && (
          <button type="button" className="primary-button" onClick={onApply}>
            {t('seller.applyAnother')}
          </button>
        )}
      </section>
    )
  }

  if (editing) {
    return (
      <section className="cab">
        <ProductEditor
          shopId={shop.id}
          product={editing}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      </section>
    )
  }

  const activeBookings = bookings.filter(isOpenBooking)
  return (
    <section className="cab">
      {header}
      <div className="chip-row cab-tabs" role="tablist">
        {['bookings', 'products', 'shop'].map((name) => (
          <button key={name} type="button" role="tab" className="chip" aria-pressed={tab === name} onClick={() => setTab(name)}>
            {t(`seller.tab.${name}`)}
            {name === 'bookings' && activeBookings.length > 0 && <span className="cab-badge">{activeBookings.length}</span>}
            {name === 'products' && <span className="search-count">{products.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'bookings' && <BookingsTab shopId={shop.id} bookings={bookings} onChanged={reload} />}

      {tab === 'products' && (
        <>
          <button type="button" className="primary-button cab-add" onClick={() => setEditing({})}>
            + {t('seller.addProduct')}
          </button>
          {products.length === 0 && (
            <div className="cab-empty">
              <b>{t('seller.noProductsTitle')}</b>
              <span>{t('seller.noProducts')}</span>
            </div>
          )}
          <ul className="cab-list">
            {products.map((product) => (
              <li key={product.id}>
                <button type="button" className="cab-row cab-product" onClick={() => setEditing(product)}>
                  {product.photo_urls?.[0] ? <img src={photoSrc(product.photo_urls[0])} alt="" /> : <span className="cab-thumb" />}
                  <span className="cab-product-text">
                    <b>{product[`name_${language}`] ?? product.name_ru}</b>
                    <span>
                      {formatPrice(product.price)} · {t('seller.pieces', { n: totalQuantity(product) })}
                      {!product.is_active && <> · {t('seller.hiddenProduct')}</>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'shop' && (
        <ShopForm
          initial={shop}
          submitLabel={t('seller.save')}
          onSubmit={async (form) => {
            await updateShop(shop.id, form)
            reload()
          }}
        />
      )}
    </section>
  )
}

const isOpenBooking = (b) => ['new', 'confirmed'].includes(b.status) && Date.parse(b.expires_at) > Date.now()
const totalQuantity = (product) => (product.variants ?? []).reduce((sum, v) => sum + (v.quantity ?? 0), 0)

function BookingsTab({ shopId, bookings, onChanged }) {
  const { t, language, formatDateTime } = useI18n()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const open = bookings.filter(isOpenBooking)
  const list = showAll ? bookings : open

  async function act(booking, status) {
    setBusy(booking.id)
    setError(null)
    try {
      await setBookingStatus(shopId, booking.id, status)
      onChanged()
    } catch (failure) {
      setError(failure.code ?? 'server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error && <p className="cab-error">{t(`seller.error.${error}`)}</p>}
      {list.length === 0 && (
        <div className="cab-empty">
          <b>{t(showAll ? 'seller.noBookingsAll' : 'seller.noBookings')}</b>
          {!showAll && <span>{t('seller.noBookingsHint')}</span>}
        </div>
      )}
      <ul className="cab-list">
        {list.map((b) => {
          const state = ['new', 'confirmed'].includes(b.status) && Date.parse(b.expires_at) <= Date.now() ? 'expired' : b.status
          return (
            <li key={b.id} className="cab-card">
              <p className="cab-card-title">
                <b>{b[`product_name_${language}`] ?? b.product_name_ru}</b>
                <span className={`booking-status ${state}`}>{t(`seller.bookingStatus.${state}`)}</span>
              </p>
              <p className="cab-text">
                {[b[`color_${language}`], b.size].filter(Boolean).join(' · ')} · {b.price?.toLocaleString('ru-RU')}
              </p>
              <p className="cab-text">
                {t('booking.code')}: <b className="cab-code">{b.code}</b> · {t('booking.until', { date: formatDateTime(b.expires_at) })}
              </p>
              {state === 'new' && (
                <div className="cab-actions">
                  <button type="button" className="primary-button" disabled={busy === b.id} onClick={() => act(b, 'confirmed')}>
                    {t('seller.confirm')}
                  </button>
                  <button type="button" className="link-button" disabled={busy === b.id} onClick={() => act(b, 'unavailable')}>
                    {t('seller.unavailable')}
                  </button>
                </div>
              )}
              {state === 'confirmed' && (
                <div className="cab-actions">
                  <button type="button" className="primary-button" disabled={busy === b.id} onClick={() => act(b, 'picked_up')}>
                    {t('seller.pickedUp')}
                  </button>
                  <button type="button" className="link-button" disabled={busy === b.id} onClick={() => act(b, 'unavailable')}>
                    {t('seller.unavailable')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
        {t(showAll ? 'seller.showOpen' : 'seller.showAll')}
      </button>
    </>
  )
}

// ---------- Данные магазина (заявка и редактирование) ----------
// Сначала только главное (название, телефон, район, адрес, часы, место на карте);
// переводы и описание — в свёрнутом блоке «Дополнительно».
function ShopForm({ initial = {}, submitLabel, onSubmit }) {
  const { t, language } = useI18n()
  const other = language === 'uz' ? 'ru' : 'uz'
  const [form, setForm] = useState(() => ({
    name: initial.name ?? '',
    phone: initial.phone ?? '',
    telegram_username: initial.telegram_username ?? '',
    district: initial.district ?? '',
    address_uz: initial.address_uz ?? '',
    address_ru: initial.address_ru ?? '',
    landmark_uz: initial.landmark_uz ?? '',
    landmark_ru: initial.landmark_ru ?? '',
    description_uz: initial.description_uz ?? '',
    description_ru: initial.description_ru ?? '',
    opens_at: (initial.opens_at ?? '10:00').slice(0, 5),
    closes_at: (initial.closes_at ?? '21:00').slice(0, 5),
    latitude: initial.latitude ?? '',
    longitude: initial.longitude ?? '',
  }))
  const [state, setState] = useState({ status: 'idle' })
  const [locating, setLocating] = useState(false)
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const hasLocation = form.latitude !== '' && form.longitude !== ''

  function locate() {
    if (!navigator.geolocation) return setState({ status: 'error', code: 'location' })
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }))
      },
      () => {
        setLocating(false)
        setState({ status: 'error', code: 'location' })
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function submit(event) {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      // Адрес обязателен на узбекском (сервер так проверяет): если заполнен только русский — берём его.
      await onSubmit({ ...form, address_uz: form.address_uz || form.address_ru })
      setState({ status: 'saved' })
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    }
  }

  const input = (key, { type = 'text', required = false, placeholder } = {}) => (
    <label className="cab-field">
      <span>
        {t(`seller.field.${key}`)}
        {required && <i className="cab-required"> *</i>}
      </span>
      <input type={type} value={form[key]} onChange={set(key)} required={required} maxLength={200} placeholder={placeholder} />
    </label>
  )

  return (
    <form className="cab-form" onSubmit={submit}>
      <fieldset className="cab-section">
        <legend>{t('seller.section.main')}</legend>
        {input('name', { required: true, placeholder: t('seller.placeholder.name') })}
        {input('phone', { type: 'tel', required: true, placeholder: '+998 90 123 45 67' })}
        {input('telegram_username', { placeholder: '@shop' })}
      </fieldset>

      <fieldset className="cab-section">
        <legend>{t('seller.section.where')}</legend>
        <label className="cab-field">
          <span>
            {t('seller.field.district')}
            <i className="cab-required"> *</i>
          </span>
          <select value={form.district} onChange={set('district')} required>
            <option value="">{t('seller.choose')}</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {t(`district.${d}`)}
              </option>
            ))}
          </select>
        </label>
        {input(`address_${language}`, { required: true, placeholder: t('seller.placeholder.address') })}
        {input(`landmark_${language}`, { placeholder: t('seller.placeholder.landmark') })}
        <div className="cab-location">
          <span>{hasLocation ? `✅ ${t('seller.locationSaved')}` : t('seller.locationHint')}</span>
          <button type="button" className="secondary-button" onClick={locate} disabled={locating}>
            📍 {locating ? t('common.loading') : t(hasLocation ? 'seller.locateAgain' : 'seller.locate')}
          </button>
        </div>
      </fieldset>

      <fieldset className="cab-section">
        <legend>{t('seller.section.hours')}</legend>
        <div className="cab-pair">
          {input('opens_at', { type: 'time' })}
          {input('closes_at', { type: 'time' })}
        </div>
      </fieldset>

      <details className="cab-more">
        <summary>{t('seller.section.more')}</summary>
        {input(`address_${other}`)}
        {input(`landmark_${other}`)}
        {['description_uz', 'description_ru'].map((key) => (
          <label key={key} className="cab-field">
            <span>{t(`seller.field.${key}`)}</span>
            <textarea value={form[key]} onChange={set(key)} rows={3} maxLength={500} />
          </label>
        ))}
      </details>

      <div className="cab-savebar">
        {state.status === 'error' && <p className="cab-error">{t(`seller.error.${state.code}`)}</p>}
        {state.status === 'saved' && <p className="cab-ok">{t('seller.saved')}</p>}
        <button type="submit" className="primary-button" disabled={state.status === 'saving'}>
          {state.status === 'saving' ? t('common.loading') : submitLabel}
        </button>
      </div>
    </form>
  )
}

// ---------- Редактор товара ----------
// По шагам: 1) категория → 2) «уже есть в KiyimTop?» → 3) фото → 4) название и цена → 5) размеры и количество.
// Название и цвет — на языке сайта; второй язык — необязательно (сервер подставит первый).
const GENDERS = ['men', 'women', 'kids', 'unisex']
const emptyVariant = () => ({ size: '', color_uz: '', color_ru: '', quantity: 1 })

function ProductEditor({ shopId, product, onDone }) {
  const { t, language } = useI18n()
  const other = language === 'uz' ? 'ru' : 'uz'
  const isNew = !product.id
  const [form, setForm] = useState(() => ({
    model_id: product.model_id ?? null,
    category_id: product.category_id ?? '',
    name_uz: product.name_uz ?? '',
    name_ru: product.name_ru ?? '',
    brand: product.brand ?? '',
    gender: product.gender ?? 'unisex',
    price: product.price ?? '',
    description_uz: product.description_uz ?? '',
    description_ru: product.description_ru ?? '',
    photo_urls: product.photo_urls ?? [],
    is_active: product.is_active !== false,
    variants: product.variants?.length ? product.variants.map((v) => ({ ...v })) : [emptyVariant()],
  }))
  const [categories, setCategories] = useState([])
  const [catalog, setCatalog] = useState([])
  const [query, setQuery] = useState('')
  const [isNewItem, setIsNewItem] = useState(!isNew) // «нет, такого товара ещё нет» (или редактируем)
  const [state, setState] = useState({ status: 'idle' })
  const [uploading, setUploading] = useState(false)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const field = (key) => (event) => set(key, event.target.value)

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {})
    fetchSearchIndex()
      .then((index) => setCatalog(index.products))
      .catch(() => {})
  }, [])

  // Тот же товар в других магазинах: по одному на модель, только в выбранной категории.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2 || !form.category_id) return []
    const seen = new Set()
    return catalog
      .filter((p) => p.shop_id !== shopId && p.category_id === form.category_id)
      .filter((p) => [p.name_uz, p.name_ru, p.brand].some((s) => s?.toLowerCase().includes(q)))
      .filter((p) => {
        const model = p.model_id ?? p.id
        if (seen.has(model)) return false
        seen.add(model)
        return true
      })
      .slice(0, 6)
  }, [query, catalog, form.category_id, shopId])

  function chooseModel(p) {
    setForm((f) => ({
      ...f,
      model_id: p.model_id ?? p.id,
      category_id: p.category_id,
      name_uz: p.name_uz ?? '',
      name_ru: p.name_ru ?? '',
      brand: p.brand ?? '',
      gender: p.gender ?? 'unisex',
      description_uz: p.description_uz ?? '',
      description_ru: p.description_ru ?? '',
      photo_urls: f.photo_urls.length ? f.photo_urls : (p.photo_urls ?? []).map(unPhotoSrc),
    }))
    setQuery('')
    setIsNewItem(true)
  }

  const linked = form.model_id && form.model_id !== product.id ? catalog.find((p) => (p.model_id ?? p.id) === form.model_id) : null

  function setVariant(index, key, value) {
    setForm((f) => ({ ...f, variants: f.variants.map((v, i) => (i === index ? { ...v, [key]: value } : v)) }))
  }

  async function addPhotos(event) {
    const files = [...event.target.files].slice(0, 8 - form.photo_urls.length)
    event.target.value = ''
    setUploading(true)
    setState({ status: 'idle' })
    try {
      for (const file of files) {
        const url = await uploadPhoto(file)
        setForm((f) => ({ ...f, photo_urls: [...f.photo_urls, url] }))
      }
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    } finally {
      setUploading(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await saveProduct(shopId, {
        ...form,
        id: product.id,
        price: Number(String(form.price).replace(/\s/g, '')),
        // Цвет пишут на одном языке — на другом подставляем его же, если пусто.
        variants: form.variants.map((v) => ({
          ...v,
          [`color_${other}`]: v[`color_${other}`] || v[`color_${language}`],
          quantity: Number(v.quantity) || 0,
        })),
      })
      onDone()
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    }
  }

  async function remove() {
    if (!window.confirm(t('seller.deleteConfirm'))) return
    setState({ status: 'saving' })
    try {
      await deleteProduct(shopId, product.id)
      onDone()
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    }
  }

  const stepTitle = (n, key) => (
    <legend>
      <span className="cab-step-number">{n}</span> {t(key)}
    </legend>
  )
  const showDetails = isNewItem && form.category_id

  return (
    <form className="cab-form" onSubmit={save}>
      <button type="button" className="link-button cab-back" onClick={onDone}>
        ← {t('seller.backToProducts')}
      </button>
      <h1 className="search-title">{t(isNew ? 'seller.newProduct' : 'seller.editProduct')}</h1>

      <fieldset className="cab-section">
        {stepTitle(1, 'seller.field.category')}
        <select value={form.category_id} onChange={field('category_id')} required>
          <option value="">{t('seller.choose')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c[`name_${language}`]}
            </option>
          ))}
        </select>
      </fieldset>

      {form.category_id && (
        <fieldset className="cab-section">
          {stepTitle(2, 'seller.sameItem')}
          {linked ? (
            <div className="cab-linked">
              <span>
                🔗 {t('seller.linkedTo')} <b>{linked[`name_${language}`]}</b>
              </span>
              <button type="button" className="link-button" onClick={() => set('model_id', null)}>
                {t('seller.unlink')}
              </button>
            </div>
          ) : (
            <>
              <p className="cab-text cab-muted">{t('seller.sameItemText')}</p>
              <input className="cab-input" placeholder={t('seller.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && (
                <ul className="cab-list">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="cab-row" onClick={() => chooseModel(p)}>
                        <span className="cab-product-text">
                          <b>{p[`name_${language}`]}</b>
                          <span>{p.brand}</span>
                        </span>
                        <span className="cab-pick">{t('seller.pick')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!isNewItem && (
                <button type="button" className="secondary-button" onClick={() => setIsNewItem(true)}>
                  {t('seller.newItem')}
                </button>
              )}
            </>
          )}
        </fieldset>
      )}

      {showDetails && (
        <>
          <fieldset className="cab-section">
            {stepTitle(3, 'seller.field.photos')}
            <div className="cab-photos">
              {form.photo_urls.map((url, i) => (
                <div key={url} className="cab-photo">
                  <img src={photoSrc(url)} alt="" />
                  {i === 0 && <em>{t('seller.mainPhoto')}</em>}
                  <button type="button" aria-label={t('common.close')} onClick={() => set('photo_urls', form.photo_urls.filter((u) => u !== url))}>
                    ×
                  </button>
                </div>
              ))}
              {form.photo_urls.length < 8 && (
                <label className="cab-photo cab-photo-add">
                  {uploading ? '…' : '+'}
                  <small>{t('seller.addPhoto')}</small>
                  <input type="file" accept="image/*" multiple hidden disabled={uploading} onChange={addPhotos} />
                </label>
              )}
            </div>
          </fieldset>

          <fieldset className="cab-section">
            {stepTitle(4, 'seller.section.nameAndPrice')}
            <label className="cab-field">
              <span>
                {t('seller.field.productName')}
                <i className="cab-required"> *</i>
              </span>
              <input value={form[`name_${language}`]} onChange={field(`name_${language}`)} maxLength={120} required placeholder={t('seller.placeholder.product')} />
            </label>
            <div className="cab-pair">
              <label className="cab-field">
                <span>
                  {t('seller.field.price')}
                  <i className="cab-required"> *</i>
                </span>
                <input inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/[^\d\s]/g, ''))} required placeholder="250 000" />
              </label>
              <label className="cab-field">
                <span>{t('seller.field.gender')}</span>
                <select value={form.gender} onChange={field('gender')}>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {t(`gender.${g}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="cab-field">
              <span>{t('seller.field.brand')}</span>
              <input value={form.brand} onChange={field('brand')} maxLength={60} placeholder="Nike, Zara…" />
            </label>
          </fieldset>

          <fieldset className="cab-section">
            {stepTitle(5, 'seller.field.variants')}
            <p className="cab-text cab-muted">{t('seller.variantsHint')}</p>
            <div className="cab-variant-head" aria-hidden="true">
              <span>{t('seller.field.size')}</span>
              <span>{t('seller.field.color')}</span>
              <span>{t('seller.field.quantity')}</span>
            </div>
            {form.variants.map((v, i) => (
              <div key={v.id ?? i} className="cab-variant">
                <input aria-label={t('seller.field.size')} placeholder="M, 42…" value={v.size ?? ''} onChange={(e) => setVariant(i, 'size', e.target.value)} />
                <input aria-label={t('seller.field.color')} placeholder={t('seller.placeholder.color')} value={v[`color_${language}`] ?? ''} onChange={(e) => setVariant(i, `color_${language}`, e.target.value)} />
                <div className="cab-qty">
                  <button type="button" aria-label="−1" onClick={() => setVariant(i, 'quantity', Math.max(0, (Number(v.quantity) || 0) - 1))}>
                    −
                  </button>
                  <input aria-label={t('seller.field.quantity')} inputMode="numeric" value={v.quantity} onChange={(e) => setVariant(i, 'quantity', e.target.value.replace(/\D/g, ''))} />
                  <button type="button" aria-label="+1" onClick={() => setVariant(i, 'quantity', (Number(v.quantity) || 0) + 1)}>
                    +
                  </button>
                </div>
                {form.variants.length > 1 && (
                  <button type="button" className="cab-remove" aria-label={t('seller.removeVariant')} onClick={() => set('variants', form.variants.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => set('variants', [...form.variants, emptyVariant()])}>
              + {t('seller.addVariant')}
            </button>
          </fieldset>

          <details className="cab-more">
            <summary>{t('seller.section.more')}</summary>
            <label className="cab-field">
              <span>{t(`seller.field.name_${other}`)}</span>
              <input value={form[`name_${other}`]} onChange={field(`name_${other}`)} maxLength={120} />
            </label>
            {['description_uz', 'description_ru'].map((key) => (
              <label key={key} className="cab-field">
                <span>{t(`seller.field.${key}`)}</span>
                <textarea value={form[key]} onChange={field(key)} rows={3} maxLength={1000} />
              </label>
            ))}
          </details>

          <label className="cab-check">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            <span>
              {t('seller.field.is_active')}
              <small>{t('seller.isActiveHint')}</small>
            </span>
          </label>

          <div className="cab-savebar">
            {state.status === 'error' && <p className="cab-error">{t(`seller.error.${state.code}`)}</p>}
            <button type="submit" className="primary-button" disabled={state.status === 'saving' || uploading}>
              {state.status === 'saving' ? t('common.loading') : t('seller.save')}
            </button>
          </div>
          {!isNew && (
            <div className="cab-actions">
              <Link to={`/c/${categories.find((c) => c.id === form.category_id)?.slug ?? ''}/p/${product.id}`} className="link-button">
                {t('seller.viewInCatalog')}
              </Link>
              <button type="button" className="link-button cab-danger" onClick={remove}>
                {t('seller.delete')}
              </button>
            </div>
          )}
        </>
      )}
    </form>
  )
}

// photoSrc добавляет BASE к «/api/photo…»; в базе храним без него.
function unPhotoSrc(url) {
  const at = url.indexOf('/api/photo?id=')
  return at >= 0 ? url.slice(at) : url
}
