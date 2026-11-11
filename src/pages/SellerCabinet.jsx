import { useEffect, useMemo, useState } from 'react'
import TelegramLogin from '../components/TelegramLogin.jsx'
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
  setBookingStatus,
  updateShop,
  uploadPhoto,
} from '../lib/seller.js'

// Кабинет магазина (/my-shop) — и на сайте, и внутри Telegram (кнопка «Кабинет магазина» в боте).
//   нет магазина → заявка; заявка → «ждёт решения администратора»;
//   одобрен → вкладки «Брони», «Товары», «Магазин».
// Админ может открыть любой магазин: /my-shop?shop=<номер> (из админки).
export default function SellerCabinet() {
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
  const { t, language, formatDateTime, formatPrice } = useI18n()
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
          <> {t('seller.subscriptionUntil', { date: formatDateTime(shop.subscription_until) })}</>
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
          {products.length === 0 && <p className="page-message">{t('seller.noProducts')}</p>}
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
      {list.length === 0 && <p className="page-message">{t(showAll ? 'seller.noBookingsAll' : 'seller.noBookings')}</p>}
      <ul className="cab-list">
        {list.map((b) => {
          const state = ['new', 'confirmed'].includes(b.status) && Date.parse(b.expires_at) <= Date.now() ? 'expired' : b.status
          return (
            <li key={b.id} className="cab-card">
              <p className="cab-card-title">
                <b>{b[`product_name_${language}`] ?? b.product_name_ru}</b>
                <span className={`booking-status ${state}`}>{t(`booking.status.${state}`)}</span>
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
const SHOP_FIELDS = [
  ['name', 'text', true],
  ['address_uz', 'text', true],
  ['address_ru', 'text'],
  ['landmark_uz', 'text'],
  ['landmark_ru', 'text'],
  ['phone', 'tel', true],
  ['telegram_username', 'text'],
  ['description_uz', 'textarea'],
  ['description_ru', 'textarea'],
]

function ShopForm({ initial = {}, submitLabel, onSubmit }) {
  const { t } = useI18n()
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(SHOP_FIELDS.map(([key]) => [key, initial[key] ?? ''])),
    district: initial.district ?? '',
    opens_at: (initial.opens_at ?? '10:00').slice(0, 5),
    closes_at: (initial.closes_at ?? '21:00').slice(0, 5),
    latitude: initial.latitude ?? '',
    longitude: initial.longitude ?? '',
  }))
  const [state, setState] = useState({ status: 'idle' })
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })),
      () => setState({ status: 'error', code: 'location' }),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function submit(event) {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await onSubmit(form)
      setState({ status: 'saved' })
    } catch (failure) {
      setState({ status: 'error', code: failure.code ?? 'server' })
    }
  }

  return (
    <form className="cab-form" onSubmit={submit}>
      {SHOP_FIELDS.map(([key, type, required]) => (
        <label key={key} className="cab-field">
          <span>
            {t(`seller.field.${key}`)}
            {required && ' *'}
          </span>
          {type === 'textarea' ? (
            <textarea value={form[key]} onChange={set(key)} rows={3} maxLength={500} />
          ) : (
            <input type={type} value={form[key]} onChange={set(key)} required={required} maxLength={200} />
          )}
        </label>
      ))}
      <label className="cab-field">
        <span>{t('seller.field.district')}</span>
        <select value={form.district} onChange={set('district')}>
          <option value="">—</option>
          {DISTRICTS.map((d) => (
            <option key={d} value={d}>
              {t(`district.${d}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="cab-pair">
        <label className="cab-field">
          <span>{t('seller.field.opens_at')}</span>
          <input type="time" value={form.opens_at} onChange={set('opens_at')} />
        </label>
        <label className="cab-field">
          <span>{t('seller.field.closes_at')}</span>
          <input type="time" value={form.closes_at} onChange={set('closes_at')} />
        </label>
      </div>
      <div className="cab-pair">
        <label className="cab-field">
          <span>{t('seller.field.latitude')}</span>
          <input inputMode="decimal" value={form.latitude} onChange={set('latitude')} />
        </label>
        <label className="cab-field">
          <span>{t('seller.field.longitude')}</span>
          <input inputMode="decimal" value={form.longitude} onChange={set('longitude')} />
        </label>
      </div>
      <button type="button" className="link-button" onClick={locate}>
        📍 {t('seller.locate')}
      </button>
      {state.status === 'error' && <p className="cab-error">{t(`seller.error.${state.code}`)}</p>}
      {state.status === 'saved' && <p className="cab-ok">{t('seller.saved')}</p>}
      <button type="submit" className="primary-button" disabled={state.status === 'saving'}>
        {state.status === 'saving' ? t('common.loading') : submitLabel}
      </button>
    </form>
  )
}

// ---------- Редактор товара ----------
const GENDERS = ['men', 'women', 'kids', 'unisex']
const emptyVariant = () => ({ size: '', color_uz: '', color_ru: '', quantity: 1 })

function ProductEditor({ shopId, product, onDone }) {
  const { t, language } = useI18n()
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

  // «Такой товар уже есть в KiyimTop?» — один раз на каждую модель (model_id), не из этого магазина.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const seen = new Set()
    return catalog
      .filter((p) => p.shop_id !== shopId && (!form.category_id || p.category_id === form.category_id))
      .filter((p) => [p.name_uz, p.name_ru, p.brand].some((s) => s?.toLowerCase().includes(q)))
      .filter((p) => {
        const model = p.model_id ?? p.id
        if (seen.has(model)) return false
        seen.add(model)
        return true
      })
      .slice(0, 8)
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
        variants: form.variants.map((v) => ({ ...v, quantity: Number(v.quantity) || 0 })),
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

  return (
    <form className="cab-form" onSubmit={save}>
      <button type="button" className="link-button" onClick={onDone}>
        ← {t('nav.back')}
      </button>
      <h1 className="search-title">{t(isNew ? 'seller.newProduct' : 'seller.editProduct')}</h1>

      <label className="cab-field">
        <span>{t('seller.field.category')} *</span>
        <select value={form.category_id} onChange={field('category_id')} required>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c[`name_${language}`]}
            </option>
          ))}
        </select>
      </label>

      {/* Связь с тем же товаром в других магазинах. */}
      <div className="cab-box">
        <p className="cab-text">
          <b>{t('seller.sameItem')}</b> {t('seller.sameItemText')}
        </p>
        {linked ? (
          <p className="cab-text">
            🔗 {linked[`name_${language}`]}{' '}
            <button type="button" className="link-button" onClick={() => set('model_id', null)}>
              {t('seller.unlink')}
            </button>
          </p>
        ) : (
          <>
            <input className="cab-input" placeholder={t('seller.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="cab-list">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="cab-row" onClick={() => chooseModel(p)}>
                      <b>{p[`name_${language}`]}</b>
                      <span>{[p.brand, p.price?.toLocaleString('ru-RU')].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {['name_uz', 'name_ru', 'brand'].map((key) => (
        <label key={key} className="cab-field">
          <span>{t(`seller.field.${key}`)}</span>
          <input value={form[key]} onChange={field(key)} maxLength={120} />
        </label>
      ))}
      <div className="cab-pair">
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
        <label className="cab-field">
          <span>{t('seller.field.price')} *</span>
          <input inputMode="numeric" value={form.price} onChange={field('price')} required />
        </label>
      </div>

      <div className="cab-field">
        <span>{t('seller.field.photos')}</span>
        <div className="cab-photos">
          {form.photo_urls.map((url) => (
            <div key={url} className="cab-photo">
              <img src={photoSrc(url)} alt="" />
              <button type="button" aria-label={t('common.close')} onClick={() => set('photo_urls', form.photo_urls.filter((u) => u !== url))}>
                ×
              </button>
            </div>
          ))}
          {form.photo_urls.length < 8 && (
            <label className="cab-photo cab-photo-add">
              {uploading ? '…' : '+'}
              <input type="file" accept="image/*" multiple hidden disabled={uploading} onChange={addPhotos} />
            </label>
          )}
        </div>
      </div>

      <div className="cab-field">
        <span>{t('seller.field.variants')}</span>
        <div className="cab-variants">
          {form.variants.map((v, i) => (
            <div key={v.id ?? i} className="cab-variant">
              <input placeholder={t('seller.field.size')} value={v.size ?? ''} onChange={(e) => setVariant(i, 'size', e.target.value)} />
              <input placeholder={t('seller.field.color_uz')} value={v.color_uz ?? ''} onChange={(e) => setVariant(i, 'color_uz', e.target.value)} />
              <input placeholder={t('seller.field.color_ru')} value={v.color_ru ?? ''} onChange={(e) => setVariant(i, 'color_ru', e.target.value)} />
              <div className="cab-qty">
                <button type="button" onClick={() => setVariant(i, 'quantity', Math.max(0, (Number(v.quantity) || 0) - 1))}>
                  −
                </button>
                <input inputMode="numeric" value={v.quantity} onChange={(e) => setVariant(i, 'quantity', e.target.value.replace(/\D/g, ''))} />
                <button type="button" onClick={() => setVariant(i, 'quantity', (Number(v.quantity) || 0) + 1)}>
                  +
                </button>
              </div>
              {form.variants.length > 1 && (
                <button type="button" className="link-button" onClick={() => set('variants', form.variants.filter((_, j) => j !== i))}>
                  {t('seller.removeVariant')}
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="link-button" onClick={() => set('variants', [...form.variants, emptyVariant()])}>
          + {t('seller.addVariant')}
        </button>
      </div>

      {['description_uz', 'description_ru'].map((key) => (
        <label key={key} className="cab-field">
          <span>{t(`seller.field.${key}`)}</span>
          <textarea value={form[key]} onChange={field(key)} rows={3} maxLength={1000} />
        </label>
      ))}

      <label className="cab-check">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        {t('seller.field.is_active')}
      </label>

      {state.status === 'error' && <p className="cab-error">{t(`seller.error.${state.code}`)}</p>}
      <button type="submit" className="primary-button" disabled={state.status === 'saving' || uploading}>
        {state.status === 'saving' ? t('common.loading') : t('seller.save')}
      </button>
      {!isNew && (
        <button type="button" className="link-button cab-danger" onClick={remove}>
          {t('seller.delete')}
        </button>
      )}
      {!isNew && (
        <Link to={`/s/${shopId}`} className="link-button">
          {t('seller.viewInCatalog')}
        </Link>
      )}
    </form>
  )
}

// photoSrc добавляет BASE к «/api/photo…»; в базе храним без него.
function unPhotoSrc(url) {
  const at = url.indexOf('/api/photo?id=')
  return at >= 0 ? url.slice(at) : url
}
