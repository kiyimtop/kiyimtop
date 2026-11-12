import { currentAccount } from './auth.js'
import { releaseExpired, releaseOne } from './bookings.js'
import { clearCatalogCache } from './catalog.js'
import { codeError, fire, plain, toCode } from './db.js'
import { notify } from './notify.js'
import { shopOut, statusOf, syncSubscriptions } from './seller.js'

// Админ-панель — прямо в базе Firestore (как в TheStarth). Правила firebase/firestore.rules пускают:
//   admin     — всё: магазины, каталог, брони, пользователи и роли, журнал, настройки;
//   moderator — магазины, каталог, брони, блокировка покупателей (роли и журнал — только админ).
// Каждое действие записывается в журнал (admin_log): кто, когда, что сделал.

const DAY = 24 * 60 * 60 * 1000
export const TRIAL_DAYS = 30
export const ROLES = ['admin', 'moderator', 'seller', null]

function staff() {
  const { status, user, profile } = currentAccount()
  if (status !== 'in' || !profile?.isStaff) throw codeError('forbidden')
  return { user, profile }
}

const all = async (fs, db, name, max = 5000) =>
  (await fs.getDocs(fs.query(fs.collection(db, name), fs.limit(max)))).docs.map((d) => ({ id: d.id, ...plain(d.data()) }))

async function run(work) {
  const f = await fire()
  try {
    return await work(f.db, f.fs)
  } catch (error) {
    throw toCode(error)
  }
}

// Записать действие в журнал. Ошибка журнала не отменяет само действие.
async function log(action, target, details = {}) {
  const { user, profile } = staff()
  const { db, fs } = await fire()
  await fs
    .addDoc(fs.collection(db, 'admin_log'), {
      at: fs.serverTimestamp(),
      by: user.uid,
      by_email: profile.email ?? user.email ?? null,
      action,
      target: target ?? null,
      details,
    })
    .catch((error) => console.error('Журнал:', error))
}

// ---------- Магазины ----------
export async function fetchAdminShops() {
  staff()
  return run(async (db, fs) => {
    const [shops, products, users] = await Promise.all([all(fs, db, 'shops'), all(fs, db, 'products'), all(fs, db, 'users')])
    await syncSubscriptions(shops)
    const counts = new Map()
    for (const p of products) counts.set(p.shop_id, (counts.get(p.shop_id) ?? 0) + 1)
    const byId = new Map(users.map((u) => [u.id, u]))
    const order = { pending: 0, active: 1, blocked: 2, rejected: 3 }
    shops.sort((a, b) => (order[statusOf(a)] ?? 9) - (order[statusOf(b)] ?? 9) || String(a.name).localeCompare(String(b.name)))
    return shops.map((s) => ({ ...shopOut(s), productCount: counts.get(s.id) ?? 0, owners: ownersOf(s, byId) }))
  })
}

const ownersOf = (shop, byId) =>
  (shop.owner_uids ?? []).map((uid) => {
    const u = byId.get(uid)
    return { uid, email: u?.email ?? null, name: u?.name ?? null, telegram: Number.isSafeInteger(u?.telegram_id) }
  })

// Действие над магазином: approve, reject, block, unblock, extend {days, amount}, addOwner {email}, removeOwner {uid}.
export async function adminAction(shopId, action, options = {}) {
  staff()
  return run(async (db, fs) => {
    const ref = fs.doc(db, 'shops', shopId)
    const snap = await fs.getDoc(ref)
    if (!snap.exists()) throw codeError('not_found')
    const shop = { id: snap.id, ...plain(snap.data()) }
    const now = Date.now()
    const subscriptionOk = (until) => !until || Date.parse(until) > now
    let change
    let addedOwner = null

    if (action === 'approve') {
      const until = shop.subscription_until && Date.parse(shop.subscription_until) > now ? Date.parse(shop.subscription_until) : now + TRIAL_DAYS * DAY
      change = { status: 'active', is_active: true, subscription_until: fs.Timestamp.fromMillis(until) }
    } else if (action === 'reject') {
      change = { status: 'rejected', is_active: false }
    } else if (action === 'block') {
      change = { status: 'blocked', is_active: false }
    } else if (action === 'unblock') {
      change = { status: 'active', is_active: subscriptionOk(shop.subscription_until) }
    } else if (action === 'extend') {
      const days = Number(options.days)
      if (!Number.isInteger(days) || days < 1 || days > 400) throw codeError('bad_request')
      const from = Math.max(now, shop.subscription_until ? Date.parse(shop.subscription_until) : now)
      change = { subscription_until: fs.Timestamp.fromMillis(from + days * DAY), is_active: statusOf(shop) === 'active' }
    } else if (action === 'addOwner') {
      const email = String(options.email ?? '').trim().toLowerCase()
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) throw codeError('bad_request')
      const found = await fs.getDocs(fs.query(fs.collection(db, 'users'), fs.where('email', '==', email), fs.limit(1)))
      if (found.empty) throw codeError('no_user')
      addedOwner = found.docs[0].id
      change = { owner_uids: [...new Set([...(shop.owner_uids ?? []), addedOwner])] }
    } else if (action === 'removeOwner') {
      change = { owner_uids: (shop.owner_uids ?? []).filter((uid) => uid !== options.uid) }
    } else {
      throw codeError('bad_request')
    }

    await fs.updateDoc(ref, change)
    const updated = { ...shop, ...plain(change) }

    // Подписка оплачена — запись для «Аналитики» (доход по месяцам).
    if (action === 'extend' && Number(options.amount) > 0) {
      await fs.addDoc(fs.collection(db, 'payments'), {
        shop_id: shop.id,
        shop_name: shop.name ?? null,
        amount: Math.round(Number(options.amount)),
        days: Number(options.days),
        created_at: fs.serverTimestamp(),
        by: currentAccount().user.uid,
      })
    }
    // Владельцы одобренного магазина получают роль «Продавец» (если у них нет другой роли).
    if (action === 'approve' || action === 'addOwner') {
      for (const uid of updated.owner_uids ?? []) {
        const userRef = fs.doc(db, 'users', uid)
        const userSnap = await fs.getDoc(userRef)
        if (userSnap.exists() && !userSnap.data().role) await fs.updateDoc(userRef, { role: 'seller' }).catch(() => {})
      }
    }
    // Новые/убранные владельцы видят действующие брони магазина.
    if (action === 'addOwner' || action === 'removeOwner') {
      const open = await fs.getDocs(fs.query(fs.collection(db, 'bookings'), fs.where('shop_id', '==', shop.id), fs.limit(1000)))
      for (const d of open.docs) {
        if (['new', 'confirmed'].includes(d.data().status)) await fs.updateDoc(d.ref, { owner_uids: updated.owner_uids }).catch(() => {})
      }
    }
    clearCatalogCache()
    await log(`shop.${action}`, shop.id, { name: shop.name ?? null, ...(options.days ? { days: options.days } : {}), ...(options.amount ? { amount: Number(options.amount) } : {}), ...(options.email ? { email: options.email } : {}) })
    if (action === 'approve' || action === 'reject') notify('shop_decision', shop.id)

    const users = await Promise.all((updated.owner_uids ?? []).map((uid) => fs.getDoc(fs.doc(db, 'users', uid))))
    const byId = new Map(users.filter((u) => u.exists()).map((u) => [u.id, u.data()]))
    return { ...shopOut(updated), owners: ownersOf(updated, byId) }
  })
}

// ---------- Пользователи и роли ----------
export const userOut = (u) => ({
  uid: u.id,
  email: u.email ?? null,
  name: [u.name, u.surname].filter(Boolean).join(' ') || null,
  phone: u.phone ?? null,
  role: u.role ?? null,
  blocked: u.blocked === true,
  emailVerified: u.email_verified === true,
  telegram: Number.isSafeInteger(u.telegram_id) ? { id: u.telegram_id, username: u.telegram_username ?? null } : null,
  created_at: u.created_at ?? null,
  isAdmin: u.role === 'admin',
})

// Все пользователи (поиск — на телефоне): { users, total }.
export async function fetchUsers() {
  staff()
  return run(async (db, fs) => (await all(fs, db, 'users')).map(userOut))
}

// Выдать роль (только админ). Себя менять нельзя — чтобы не остаться без админа.
export async function setUserRole(uid, role) {
  const { user } = staff()
  if (uid === user.uid) throw codeError('self')
  if (!ROLES.includes(role)) throw codeError('bad_request')
  return run(async (db, fs) => {
    await fs.updateDoc(fs.doc(db, 'users', uid), { role })
    await log('user.role', uid, { role })
  })
}

// Заблокировать / разблокировать: заблокированный не может бронировать и подавать заявки магазина.
export async function setUserBlocked(uid, blocked) {
  const { user } = staff()
  if (uid === user.uid) throw codeError('self')
  return run(async (db, fs) => {
    await fs.updateDoc(fs.doc(db, 'users', uid), { blocked: Boolean(blocked) })
    if (blocked) {
      // Его действующие брони отменяются — вещи возвращаются в магазин.
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'bookings'), fs.where('user_id', '==', uid), fs.limit(200)))
      for (const d of snap.docs) {
        if (['new', 'confirmed'].includes(d.data().status)) await releaseOne(d.id, 'cancelled').catch(() => {})
      }
    }
    await log(blocked ? 'user.block' : 'user.unblock', uid)
  })
}

// ---------- Каталог: категории ----------
export async function fetchAllCategories() {
  staff()
  return run(async (db, fs) => {
    const list = await all(fs, db, 'categories', 500)
    return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  })
}

const SLUG = /^[a-z0-9-]{2,40}$/

// Новая категория (id = slug) или изменения.
export async function saveCategory(input, isNew) {
  staff()
  const slug = String(input.slug ?? input.id ?? '').trim().toLowerCase()
  if (!SLUG.test(slug)) throw codeError('slug')
  const data = {
    slug,
    name_uz: String(input.name_uz ?? '').trim().slice(0, 60),
    name_ru: String(input.name_ru ?? '').trim().slice(0, 60),
    emoji: String(input.emoji ?? '').trim().slice(0, 8) || null,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
  }
  if (!data.name_uz || !data.name_ru) throw codeError('bad_request')
  return run(async (db, fs) => {
    const ref = fs.doc(db, 'categories', slug)
    if (isNew && (await fs.getDoc(ref)).exists()) throw codeError('exists')
    await fs.setDoc(ref, data, { merge: true })
    clearCatalogCache()
    await log(isNew ? 'category.create' : 'category.update', slug, { name: data.name_ru })
    return { id: slug, ...data }
  })
}

// Удалить категорию можно, только если в ней нет товаров.
export async function deleteCategory(id) {
  staff()
  return run(async (db, fs) => {
    const count = await fs.getCountFromServer(fs.query(fs.collection(db, 'products'), fs.where('category_id', '==', id)))
    if (count.data().count > 0) throw codeError('not_empty')
    await fs.deleteDoc(fs.doc(db, 'categories', id))
    clearCatalogCache()
    await log('category.delete', id)
  })
}

// ---------- Каталог: товары всех магазинов ----------
export async function fetchAllProducts() {
  staff()
  return run(async (db, fs) => {
    const [products, shops] = await Promise.all([all(fs, db, 'products'), all(fs, db, 'shops')])
    const names = new Map(shops.map((s) => [s.id, s.name]))
    return products
      .map((p) => ({ ...p, shop_name: names.get(p.shop_id) ?? '—' }))
      .sort((a, b) => String(a.name_ru ?? '').localeCompare(String(b.name_ru ?? '')))
  })
}

export async function setProductActive(id, active) {
  staff()
  return run(async (db, fs) => {
    await fs.updateDoc(fs.doc(db, 'products', id), { is_active: Boolean(active) })
    clearCatalogCache()
    await log(active ? 'product.show' : 'product.hide', id)
  })
}

export async function deleteProductAdmin(id, name) {
  staff()
  return run(async (db, fs) => {
    await fs.deleteDoc(fs.doc(db, 'products', id))
    clearCatalogCache()
    await log('product.delete', id, { name: name ?? null })
  })
}

// ---------- Брони ----------
export async function fetchAllBookings() {
  staff()
  return run(async (db, fs) => {
    const list = await all(fs, db, 'bookings', 3000)
    await releaseExpired(list).catch(() => {})
    return list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  })
}

// Отменить чужую бронь (вещь возвращается в магазин).
export async function cancelBookingAdmin(id) {
  staff()
  try {
    await releaseOne(id, 'cancelled')
  } catch (error) {
    throw toCode(error)
  }
  clearCatalogCache()
  await log('booking.cancel', id)
  notify('booking_cancelled', id)
}

// Удалить бронь совсем (например, тестовую). Действующую сначала отменяем, чтобы вещь вернулась.
export async function deleteBooking(booking) {
  staff()
  if (['new', 'confirmed'].includes(booking.status) && Date.parse(booking.expires_at) > Date.now()) {
    await releaseOne(booking.id, 'cancelled').catch(() => {})
  }
  return run(async (db, fs) => {
    await fs.deleteDoc(fs.doc(db, 'bookings', booking.id))
    await log('booking.delete', booking.id, { code: booking.code ?? null })
  })
}

// ---------- Журнал (только админ) ----------
export async function fetchLog() {
  staff()
  return run(async (db, fs) => {
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'admin_log'), fs.orderBy('at', 'desc'), fs.limit(300)))
    return snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
  })
}

// ---------- Настройки (цена подписки) ----------
export async function fetchSettings() {
  return run(async (db, fs) => {
    const snap = await fs.getDoc(fs.doc(db, 'settings', 'main'))
    return snap.exists() ? plain(snap.data()) : {}
  })
}

export async function saveSettings(change) {
  staff()
  return run(async (db, fs) => {
    await fs.setDoc(fs.doc(db, 'settings', 'main'), change, { merge: true })
    await log('settings', 'main', change)
  })
}

// ---------- Аналитика ----------
// Всё считается на телефоне админа из базы (пока данных немного — это дёшево).
export async function fetchAnalytics() {
  staff()
  return run(async (db, fs) => {
    const [users, shops, products, bookings, payments] = await Promise.all([
      all(fs, db, 'users'),
      all(fs, db, 'shops'),
      all(fs, db, 'products'),
      all(fs, db, 'bookings'),
      all(fs, db, 'payments'),
    ])
    const now = Date.now()
    // Месяц «2026-11» по времени телефона (в Ташкенте — ташкентский), последние 6 месяцев.
    const pad = (n) => String(n).padStart(2, '0')
    const monthOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    const month = (iso) => (iso ? monthOf(new Date(iso)) : null)
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      months.push(monthOf(new Date(d.getFullYear(), d.getMonth() - i, 1)))
    }
    const perMonth = (items, dateKey, value = () => 1) =>
      months.map((m) => ({ month: m, value: items.filter((x) => month(x[dateKey]) === m).reduce((s, x) => s + value(x), 0) }))

    const roleCount = (role) => users.filter((u) => (u.role ?? null) === role).length
    const shopStatus = (status) => shops.filter((s) => statusOf(s) === status).length
    const activeBookings = bookings.filter((b) => ['new', 'confirmed'].includes(b.status) && Date.parse(b.expires_at) > now)
    const bookingStatus = {}
    for (const b of bookings) {
      const s = ['new', 'confirmed'].includes(b.status) && Date.parse(b.expires_at) <= now ? 'expired' : b.status
      bookingStatus[s] = (bookingStatus[s] ?? 0) + 1
    }
    const thisMonth = months[months.length - 1]
    return {
      users: {
        total: users.length,
        buyers: roleCount(null),
        sellers: roleCount('seller'),
        moderators: roleCount('moderator'),
        admins: roleCount('admin'),
        blocked: users.filter((u) => u.blocked === true).length,
        withPhone: users.filter((u) => u.phone).length,
        newThisMonth: users.filter((u) => month(u.created_at) === thisMonth).length,
      },
      shops: {
        total: shops.length,
        pending: shopStatus('pending'),
        active: shopStatus('active'),
        visible: shops.filter((s) => s.is_active === true).length,
        blocked: shopStatus('blocked'),
        rejected: shopStatus('rejected'),
        expiringSoon: shops.filter((s) => s.is_active && s.subscription_until && Date.parse(s.subscription_until) - now < 7 * DAY).length,
      },
      products: {
        total: products.length,
        active: products.filter((p) => p.is_active === true).length,
        pieces: products.reduce((sum, p) => sum + (p.variants ?? []).reduce((s, v) => s + (v.quantity ?? 0), 0), 0),
      },
      bookings: {
        total: bookings.length,
        active: activeBookings.length,
        status: bookingStatus,
        pickedUpValue: bookings.filter((b) => b.status === 'picked_up').reduce((s, b) => s + (b.price ?? 0), 0),
      },
      revenue: {
        total: payments.reduce((s, p) => s + (p.amount ?? 0), 0),
        thisMonth: payments.filter((p) => month(p.created_at) === thisMonth).reduce((s, p) => s + (p.amount ?? 0), 0),
        payments: payments.length,
      },
      months: {
        users: perMonth(users, 'created_at'),
        bookings: perMonth(bookings, 'created_at'),
        revenue: perMonth(payments, 'created_at', (p) => p.amount ?? 0),
      },
      // Магазины с самым большим числом броней.
      topShops: Object.entries(
        bookings.reduce((acc, b) => ({ ...acc, [b.shop_id]: (acc[b.shop_id] ?? 0) + 1 }), {}),
      )
        .map(([id, n]) => ({ id, n, name: shops.find((s) => s.id === id)?.name ?? '—' }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 5),
    }
  })
}

// ---------- Тестовые данные ----------
// Магазины «(demo)» (id начинаются с d0000000-0000-4000-8000-) с товарами и бронями, и брони без аккаунта.
const DEMO_ID = 'd0000000-0000-4000-8000-'
async function findTestData(db, fs) {
  const [shops, products, bookings] = await Promise.all([all(fs, db, 'shops'), all(fs, db, 'products'), all(fs, db, 'bookings')])
  const demoShops = shops.filter((s) => s.id.startsWith(DEMO_ID) || /\(demo\)\s*$/i.test(s.name ?? ''))
  const demoIds = new Set(demoShops.map((s) => s.id))
  return {
    shops: demoShops,
    products: products.filter((p) => demoIds.has(p.shop_id) || p.id.startsWith(DEMO_ID)),
    bookings: bookings.filter((b) => demoIds.has(b.shop_id) || !b.user_id),
  }
}

export async function fetchCleanup() {
  staff()
  return run(async (db, fs) => {
    const found = await findTestData(db, fs)
    return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]))
  })
}

export async function runCleanup() {
  staff()
  return run(async (db, fs) => {
    const found = await findTestData(db, fs)
    const docs = Object.entries(found).flatMap(([collection, items]) => items.map((d) => fs.doc(db, collection, d.id)))
    for (let i = 0; i < docs.length; i += 400) {
      const batch = fs.writeBatch(db)
      docs.slice(i, i + 400).forEach((ref) => batch.delete(ref))
      await batch.commit()
    }
    clearCatalogCache()
    await log('cleanup', null, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])))
    return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]))
  })
}
