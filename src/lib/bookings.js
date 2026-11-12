import { currentAccount } from './auth.js'
import { clearCatalogCache } from './catalog.js'
import { codeError, fire, plain, toCode } from './db.js'
import { notify } from './notify.js'

// Брони — прямо в базе Firestore (как в TheStarth, без сервера). Правила firebase/firestore.rules
// проверяют каждую запись: бронирует только сам покупатель с подтверждённым email, количество товара
// уменьшается ровно на 1 в той же операции, отпустить вещь можно только вместе с отменой брони.
//
// Бронь (коллекция bookings): user_id, owner_uids (владельцы магазина — им видна бронь), товар и вариант,
// копия названия/цвета/размера/цены и магазина, buyer_name / buyer_phone (видит магазин), code,
// status: new / confirmed / picked_up / cancelled / unavailable / expired, expires_at (2 дня).
//
// Будильника нет: просроченные брони отпускаются, когда их открывает покупатель, магазин или админ.

export const HOLD_DAYS = 2
export const MAX_ACTIVE = 3
const DAY = 24 * 60 * 60 * 1000
const ACTIVE = ['new', 'confirmed']

const SHOP_FIELDS = [
  'id', 'name', 'address_uz', 'address_ru', 'landmark_uz', 'landmark_ru',
  'latitude', 'longitude', 'phone', 'telegram_username', 'opens_at', 'closes_at',
]
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key] ?? null]))

const randomCode = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000))

function me() {
  const { status, user, profile } = currentAccount()
  if (status !== 'in' || !user) throw codeError('auth')
  return { user, profile }
}

// Состояние брони для показа: new / confirmed / picked_up / cancelled / unavailable / expired.
// «Истекла» — если срок прошёл, а бронь всё ещё новая или подтверждённая.
export function bookingState(booking, now = Date.now()) {
  const active = ACTIVE.includes(booking.status)
  return active && new Date(booking.expires_at).getTime() <= now ? 'expired' : booking.status
}

export const isActive = (booking) => ACTIVE.includes(bookingState(booking))

// Мои брони (последние 50). Просроченные заодно отпускаем (вещь — обратно в наличие).
export async function fetchMyBookings() {
  const { user } = me()
  const { db, fs } = await fire()
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'bookings'), fs.where('user_id', '==', user.uid), fs.limit(200)))
    const mine = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
    await releaseExpired(mine).catch((error) => console.error('releaseExpired:', error))
    mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return mine.slice(0, 50)
  } catch (error) {
    throw toCode(error)
  }
}

// Забронировать вариант товара на 2 дня. Одной транзакцией: проверка наличия, количество − 1, запись брони.
// Если двое одновременно берут последнюю вещь — второй получит «sold_out».
export async function createBooking(variantId, productId) {
  const { user, profile } = me()
  if (!user.emailVerified) throw codeError('not_verified')
  if (profile?.blocked) throw codeError('blocked')
  const { db, fs, auth } = await fire()
  // Свежий пропуск: в нём должен быть «email подтверждён» (его проверяют правила).
  await auth.currentUser?.getIdToken(true).catch(() => {})

  try {
    // Правила KiyimTop: не больше 3 действующих броней и одна бронь на один вариант.
    const mineSnap = await fs.getDocs(fs.query(fs.collection(db, 'bookings'), fs.where('user_id', '==', user.uid), fs.limit(200)))
    const mine = mineSnap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
    await releaseExpired(mine).catch(() => {})
    const active = mine.filter(isActive)
    if (active.some((b) => b.variant_id === variantId)) throw codeError('already_booked')
    if (active.length >= MAX_ACTIVE) throw codeError('too_many')

    const bookingRef = fs.doc(fs.collection(db, 'bookings'))
    const productRef = fs.doc(db, 'products', productId)
    const booking = await fs.runTransaction(db, async (tx) => {
      const productSnap = await tx.get(productRef)
      const product = productSnap.exists() ? productSnap.data() : null
      const variants = (product?.variants ?? []).map((v) => ({ ...v }))
      const index = variants.findIndex((v) => v.id === variantId)
      if (!product || product.is_active !== true || index < 0) throw codeError('not_found')
      const shopSnap = await tx.get(fs.doc(db, 'shops', product.shop_id))
      const shop = shopSnap.exists() ? { id: shopSnap.id, ...plain(shopSnap.data()) } : null
      if (!shop || shop.is_active !== true) throw codeError('not_found')
      const categorySnap = product.category_id ? await tx.get(fs.doc(db, 'categories', product.category_id)) : null
      const category = categorySnap?.exists() ? categorySnap.data() : null

      const variant = variants[index]
      if (!(variant.quantity > 0)) throw codeError('sold_out')
      variant.quantity -= 1

      const now = Date.now()
      const data = {
        code: randomCode(),
        status: 'new',
        created_at: fs.serverTimestamp(),
        updated_at: fs.serverTimestamp(),
        expires_at: fs.Timestamp.fromMillis(now + HOLD_DAYS * DAY),
        user_id: user.uid,
        buyer_name: [profile?.name, profile?.surname].filter(Boolean).join(' ') || user.name || null,
        buyer_phone: profile?.phone ?? null,
        buyer_email: user.email ?? null,
        buyer_lang: document.documentElement.lang === 'ru' ? 'ru' : 'uz',
        product_id: productId,
        variant_id: variantId,
        shop_id: shop.id,
        owner_uids: Array.isArray(shopSnap.data().owner_uids) ? shopSnap.data().owner_uids : [],
        product_name_uz: product.name_uz ?? null,
        product_name_ru: product.name_ru ?? null,
        size: variant.size ?? null,
        color_uz: variant.color_uz ?? null,
        color_ru: variant.color_ru ?? null,
        price: product.price ?? null,
        // Копия магазина и категории на момент брони — «Мои брони» показывают их без лишних запросов.
        shop: pick(shop, SHOP_FIELDS),
        product: { category: category ? { slug: category.slug ?? product.category_id, emoji: category.emoji ?? null } : null },
      }
      tx.update(productRef, { variants, hold_ref: bookingRef.id, hold_op: 'take', hold_idx: index })
      tx.set(bookingRef, data)
      const iso = new Date(now).toISOString()
      return { id: bookingRef.id, ...data, created_at: iso, updated_at: iso, expires_at: new Date(now + HOLD_DAYS * DAY).toISOString() }
    })
    clearCatalogCache()
    notify('booking_new', booking.id)
    return booking
  } catch (error) {
    throw toCode(error)
  }
}

// Отменить свою действующую бронь и вернуть вещь в наличие.
export async function cancelBooking(id) {
  me()
  try {
    await releaseOne(id, 'cancelled')
    clearCatalogCache()
    notify('booking_cancelled', id)
    return { ok: true }
  } catch (error) {
    throw toCode(error)
  }
}

// Закрыть бронь со статусом cancelled или expired и вернуть вещь (+1 к варианту).
// Если вариант магазин уже удалил — просто закрываем бронь.
export async function releaseOne(id, status) {
  const { db, fs } = await fire()
  const bookingRef = fs.doc(db, 'bookings', id)
  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef)
    const booking = snap.exists() ? plain(snap.data()) : null
    if (!booking || !ACTIVE.includes(booking.status)) throw codeError('not_found')
    const expired = Date.parse(booking.expires_at) <= Date.now()
    if (status === 'expired' && !expired) throw codeError('not_found')
    const productRef = fs.doc(db, 'products', booking.product_id)
    const productSnap = await tx.get(productRef)
    const variants = productSnap.exists() ? (productSnap.data().variants ?? []).map((v) => ({ ...v })) : []
    const index = variants.findIndex((v) => v.id === booking.variant_id)
    tx.update(bookingRef, { status, updated_at: fs.serverTimestamp() })
    if (index >= 0) {
      variants[index].quantity = (variants[index].quantity ?? 0) + 1
      tx.update(productRef, { variants, hold_ref: id, hold_op: 'give', hold_idx: index })
    }
  })
}

// Просроченные действующие брони из списка → «expired», вещь — обратно. Ошибки по одной — не мешают.
export async function releaseExpired(bookings) {
  const now = Date.now()
  const stale = bookings.filter((b) => ACTIVE.includes(b.status) && Date.parse(b.expires_at) <= now)
  for (const booking of stale) {
    try {
      await releaseOne(booking.id, 'expired')
      booking.status = 'expired'
    } catch (error) {
      console.error('Бронь не отпустилась:', booking.id, error)
    }
  }
  if (stale.length) clearCatalogCache()
}
