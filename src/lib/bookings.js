import { currentAccount } from './auth.js'
import { MAX_LINE_QTY } from './cart.js'
import { fetchProduct, patchStock } from './catalog.js'
import { codeError, fire, plain, toCode } from './db.js'
import { notify } from './notify.js'

// Брони — прямо в базе Firestore (как в TheStarth, без сервера). Правила firebase/firestore.rules
// проверяют каждую запись: бронирует только сам покупатель с подтверждённым email, количество товара
// уменьшается ровно на qty в той же операции, отпустить вещь можно только вместе с отменой брони.
//
// Бронь из корзины: одна бронь на магазин (group_id, общий code), внутри — строки. Каждая строка —
// отдельный документ bookings (один вариант товара, qty штук), поэтому магазин может отметить
// «нет в наличии» для одной позиции, не трогая остальные.
//
// Строка (коллекция bookings): user_id, owner_uids (владельцы магазина — им видна бронь), group_id, code,
// товар и вариант, qty, копия названия/цвета/размера/цены и магазина, buyer_name / buyer_phone (видит магазин),
// status: new / confirmed / picked_up / cancelled / unavailable / expired, expires_at (2 дня).
// Старые брони (до корзины) — без group_id и qty: считаются группой из одной строки, 1 штука.
//
// Будильника нет: просроченные брони отпускаются, когда их открывает покупатель, магазин или админ.

export const HOLD_DAYS = 2
// Одновременно действующих: не больше 10 штук товаров и 3 магазинов (защита от брони «просто так»).
export const MAX_ITEMS = 10
export const MAX_SHOPS = 3
// За 24 часа с одного аккаунта — не больше 20 вещей. Это проверяют и правила базы (счётчик в профиле:
// book_from, book_count, book_ref), поэтому обойти лимит скриптом нельзя. Меняешь число — поменяй его
// и в firebase/firestore.rules (bookCounterOk), и в тексте booking.error.too_many_today (uz.json, ru.json).
export const MAX_DAILY = 20
// Запас на неточные часы телефона: считаем сутки «новыми» на 5 минут позже, чем правила базы.
const CLOCK_MARGIN = 5 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const ACTIVE = ['new', 'confirmed']

const SHOP_FIELDS = [
  'id', 'name', 'address_uz', 'address_ru', 'landmark_uz', 'landmark_ru',
  'latitude', 'longitude', 'phone', 'telegram_username', 'opens_at', 'closes_at',
]
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key] ?? null]))

const randomCode = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000))

// Защита от неявок: бронь, за которой не пришли (срок истёк, её не отменили и ничего не выдали), — «неявка».
// Три неявки за последние 30 дней — новые брони закрыты, пока старые неявки не выйдут за эти 30 дней.
// Отменил вовремя или магазин ответил «нет в наличии» — это не неявка.
// (Проверяет сайт; от скриптов в обход сайта защищает лимит «20 вещей в сутки» в правилах базы.)
export const NO_SHOW_LIMIT = 3
export const NO_SHOW_DAYS = 30
export function noShowCount(lines, now = Date.now()) {
  return groupBookings(lines).filter((group) => group.state === 'expired' && now - Date.parse(group.expires_at) < NO_SHOW_DAYS * DAY).length
}

export const qtyOf = (booking) => booking.qty ?? 1
export const groupIdOf = (booking) => booking.group_id ?? booking.id

function me() {
  const { status, user, profile } = currentAccount()
  if (status !== 'in' || !user) throw codeError('auth')
  return { user, profile }
}

// Состояние строки для показа: new / confirmed / picked_up / cancelled / unavailable / expired.
// «Истекла» — если срок прошёл, а бронь всё ещё новая или подтверждённая.
export function bookingState(booking, now = Date.now()) {
  const active = ACTIVE.includes(booking.status)
  return active && new Date(booking.expires_at).getTime() <= now ? 'expired' : booking.status
}

export const isActive = (booking) => ACTIVE.includes(bookingState(booking))

// Состояние всей брони (группы строк): пока есть новая строка — «новая», потом «подтверждена»;
// когда открытых нет — «забрали», если хоть что-то выдано, иначе «нет в наличии» / «отменена» / «истекла».
export function groupState(lines) {
  const states = lines.map((line) => bookingState(line))
  if (states.includes('new')) return 'new'
  if (states.includes('confirmed')) return 'confirmed'
  if (states.includes('picked_up')) return 'picked_up'
  if (states.every((s) => s === 'unavailable')) return 'unavailable'
  if (states.includes('cancelled')) return 'cancelled'
  if (states.includes('unavailable')) return 'unavailable'
  return 'expired'
}

// Строки броней → брони по магазинам: { id, code, shop, shop_id, lines, created_at, expires_at, state, active, total }.
// Сначала действующие, внутри — новые сверху.
export function groupBookings(lines) {
  const groups = new Map()
  for (const line of lines) {
    const id = groupIdOf(line)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(line)
  }
  return [...groups.entries()]
    .map(([id, list]) => {
      list.sort((a, b) => String(a.product_name_ru ?? '').localeCompare(String(b.product_name_ru ?? '')))
      const first = list[0]
      const state = groupState(list)
      return {
        id,
        code: first.code,
        shop: first.shop,
        shop_id: first.shop_id,
        buyer_name: first.buyer_name,
        buyer_phone: first.buyer_phone,
        lines: list,
        created_at: list.reduce((m, l) => (Date.parse(l.created_at) > Date.parse(m) ? l.created_at : m), first.created_at),
        expires_at: first.expires_at,
        state,
        active: ACTIVE.includes(state),
        total: list.filter((l) => bookingState(l) !== 'unavailable').reduce((sum, l) => sum + (l.price ?? 0) * qtyOf(l), 0),
      }
    })
    .sort((a, b) => b.active - a.active || Date.parse(b.created_at) - Date.parse(a.created_at))
}

async function myLines(db, fs, uid) {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'bookings'), fs.where('user_id', '==', uid), fs.limit(300)))
  return snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
}

// Мои брони (строки, последние 100). Просроченные заодно отпускаем (вещь — обратно в наличие).
export async function fetchMyBookings() {
  const { user } = me()
  const { db, fs } = await fire()
  try {
    const mine = await myLines(db, fs, user.uid)
    await releaseExpired(mine).catch((error) => console.error('releaseExpired:', error))
    mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return mine.slice(0, 100)
  } catch (error) {
    throw toCode(error)
  }
}

// Оформить корзину: lines = [{ product_id, variant_id, qty }].
// Строки делятся по магазинам: на каждый магазин — одна бронь (group_id) со своим кодом.
// Каждая строка — своя транзакция: если одна вещь только что закончилась, остальное всё равно бронируется.
// Возвращает { orders: [{ group_id, code, shop, booked: [строки], failed: [{ line, code }] }] }.
export async function checkout(lines) {
  const { user, profile } = me()
  if (!user.emailVerified) throw codeError('not_verified')
  if (profile?.blocked) throw codeError('blocked')
  const wanted = lines
    .filter((line) => line?.variant_id && line?.product_id)
    .map((line) => ({ ...line, qty: Math.min(MAX_LINE_QTY, Math.max(1, line.qty ?? 1)) }))
  if (!wanted.length) throw codeError('not_found')
  const { db, fs, auth } = await fire()
  // Свежий пропуск: в нём должен быть «email подтверждён» (его проверяют правила).
  await auth.currentUser?.getIdToken(true).catch(() => {})

  try {
    // Какой товар в каком магазине (из каталога; транзакция потом перепроверит по базе).
    const products = new Map()
    for (const line of wanted) {
      if (!products.has(line.product_id)) products.set(line.product_id, await fetchProduct(line.product_id).catch(() => null))
    }
    const byShop = new Map()
    const unknown = []
    for (const line of wanted) {
      const product = products.get(line.product_id)
      if (!product?.shop) {
        unknown.push({ line, code: 'not_found' })
        continue
      }
      if (!byShop.has(product.shop.id)) byShop.set(product.shop.id, [])
      byShop.get(product.shop.id).push(line)
    }

    // Лимиты: вместе с уже действующими бронями — не больше 10 штук и 3 магазинов.
    const mine = await myLines(db, fs, user.uid)
    await releaseExpired(mine).catch(() => {})
    if (noShowCount(mine) >= NO_SHOW_LIMIT) throw codeError('no_shows')
    const active = mine.filter(isActive)
    const activeItems = active.reduce((sum, b) => sum + qtyOf(b), 0)
    const shops = new Set([...active.map((b) => b.shop_id), ...byShop.keys()])
    const newItems = [...byShop.values()].flat().reduce((sum, line) => sum + line.qty, 0)
    if (shops.size > MAX_SHOPS) throw codeError('too_many_shops')
    if (activeItems + newItems > MAX_ITEMS) throw codeError('too_many_items')

    const orders = []
    for (const [shopId, shopLines] of byShop) {
      const groupId = fs.doc(fs.collection(db, 'bookings')).id
      const code = randomCode()
      const order = { group_id: groupId, code, shop: null, shop_id: shopId, booked: [], failed: [] }
      for (const line of shopLines) {
        try {
          const booking = await bookLine(db, fs, { user, profile, line, groupId, code })
          order.booked.push(booking)
          order.shop = booking.shop
        } catch (error) {
          order.failed.push({ line, code: toCode(error).code })
        }
      }
      order.shop ??= products.get(shopLines[0].product_id)?.shop ?? null
      if (order.booked.length) notify('booking_new', order.booked[0].id)
      orders.push(order)
    }
    if (unknown.length) orders.push({ group_id: null, code: null, shop: null, booked: [], failed: unknown })
    return { orders }
  } catch (error) {
    throw toCode(error)
  }
}

// Одна строка брони одной транзакцией: проверка наличия, количество − qty, счётчик броней за сутки
// в профиле и запись строки. Если двое одновременно берут последние вещи — второй получит «sold_out».
async function bookLine(db, fs, args) {
  const booking = await bookLineSafe(db, fs, args)
  // Каталог целиком не перечитываем — просто уменьшаем остаток в запомненной копии.
  patchStock(args.line.product_id, args.line.variant_id, -args.line.qty)
  return booking
}

async function bookLineSafe(db, fs, args) {
  try {
    return await bookLineOnce(db, fs, args, true)
  } catch (error) {
    // Совместимость со старыми правилами базы (без счётчика броней): они не дают менять счётчик в профиле,
    // поэтому пробуем ещё раз без него. С новыми правилами такая попытка просто получит отказ.
    // Когда новые правила опубликованы в Firebase, этот запасной путь можно убрать.
    if (error?.code !== 'permission-denied') throw error
    return bookLineOnce(db, fs, args, false)
  }
}

async function bookLineOnce(db, fs, { user, profile, line, groupId, code }, withCounter) {
  const bookingRef = fs.doc(fs.collection(db, 'bookings'))
  const productRef = fs.doc(db, 'products', line.product_id)
  const userRef = fs.doc(db, 'users', user.uid)
  return fs.runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef)
    const product = productSnap.exists() ? productSnap.data() : null
    const variants = (product?.variants ?? []).map((v) => ({ ...v }))
    const index = variants.findIndex((v) => v.id === line.variant_id)
    if (!product || product.is_active !== true || index < 0) throw codeError('not_found')
    const shopSnap = await tx.get(fs.doc(db, 'shops', product.shop_id))
    const shop = shopSnap.exists() ? { id: shopSnap.id, ...plain(shopSnap.data()) } : null
    if (!shop || shop.is_active !== true) throw codeError('not_found')
    const categorySnap = product.category_id ? await tx.get(fs.doc(db, 'categories', product.category_id)) : null
    const category = categorySnap?.exists() ? categorySnap.data() : null

    // Профиль из базы: счётчик броней за сутки, телефон и email (правила сверяют их с бронью).
    const userSnap = withCounter ? await tx.get(userRef) : null
    const account = userSnap?.exists() ? userSnap.data() : null

    const variant = variants[index]
    if (!((variant.quantity ?? 0) >= line.qty)) throw codeError('sold_out')
    variant.quantity -= line.qty

    const now = Date.now()
    // Счётчик: сутки считаются с первой брони (book_from); прошли — счёт начинается заново.
    let counter = null
    if (account) {
      const from = typeof account.book_from?.toMillis === 'function' ? account.book_from.toMillis() : null
      const fresh = from === null || now - from > DAY + CLOCK_MARGIN
      const count = (fresh ? 0 : account.book_count ?? 0) + line.qty
      if (count > MAX_DAILY) throw codeError('too_many_today')
      counter = { book_count: count, book_ref: bookingRef.id, ...(fresh ? { book_from: fs.serverTimestamp() } : {}) }
    }
    const who = account ?? profile ?? {}
    const data = {
      code,
      group_id: groupId,
      qty: line.qty,
      status: 'new',
      created_at: fs.serverTimestamp(),
      updated_at: fs.serverTimestamp(),
      expires_at: fs.Timestamp.fromMillis(now + HOLD_DAYS * DAY),
      user_id: user.uid,
      buyer_name: ([who.name, who.surname].filter(Boolean).join(' ') || user.name || '').slice(0, 170) || null,
      buyer_phone: who.phone ?? null,
      buyer_email: account ? account.email ?? null : user.email ?? null,
      buyer_lang: document.documentElement.lang === 'ru' ? 'ru' : 'uz',
      product_id: line.product_id,
      variant_id: line.variant_id,
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
      product: {
        category: category
          ? { slug: String(category.slug ?? product.category_id).slice(0, 60), emoji: category.emoji ? String(category.emoji).slice(0, 16) : null }
          : null,
      },
    }
    tx.update(productRef, { variants, hold_ref: bookingRef.id, hold_op: 'take', hold_idx: index })
    if (counter) tx.update(userRef, counter)
    tx.set(bookingRef, data)
    const iso = new Date(now).toISOString()
    return { id: bookingRef.id, ...data, created_at: iso, updated_at: iso, expires_at: new Date(now + HOLD_DAYS * DAY).toISOString() }
  })
}

// Забронировать сразу один вариант (кнопка «Забронировать» на товаре) — та же корзина из одной строки.
// Возвращает бронь (строку с group_id) или ошибку с кодом.
export async function createBooking(variantId, productId, qty = 1) {
  const { orders } = await checkout([{ product_id: productId, variant_id: variantId, qty }])
  const order = orders.find((o) => o.booked.length)
  if (order) return order.booked[0]
  throw codeError(orders[0]?.failed[0]?.code ?? 'server')
}

// Отменить свою бронь целиком (все открытые строки этой брони) и вернуть вещи в наличие.
export async function cancelGroup(group) {
  me()
  const open = group.lines.filter(isActive)
  if (!open.length) return { ok: true }
  try {
    for (const line of open) await releaseOne(line.id, 'cancelled')
    notify('booking_cancelled', open[0].id)
    return { ok: true }
  } catch (error) {
    throw toCode(error)
  }
}

// Отменить одну строку (админка).
export async function cancelBooking(id) {
  me()
  try {
    await releaseOne(id, 'cancelled')
    notify('booking_cancelled', id)
    return { ok: true }
  } catch (error) {
    throw toCode(error)
  }
}

// Закрыть строку со статусом cancelled или expired и вернуть вещь (+qty к варианту).
// Правила базы разрешают покупателю и магазину закрыть бронь только вместе с возвратом вещи
// (иначе можно было бы обнулять остатки). Поэтому:
//   товар удалён совсем — просто закрываем строку (возвращать некуда);
//   магазин удалил только этот цвет/размер — закрыть строку может админ; у покупателя и магазина
//   просроченная бронь остаётся как есть (везде показывается «истекла» по сроку), а отмена — «недоступна».
export async function releaseOne(id, status) {
  const { db, fs } = await fire()
  const bookingRef = fs.doc(db, 'bookings', id)
  const returned = await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef)
    const booking = snap.exists() ? plain(snap.data()) : null
    if (!booking || !ACTIVE.includes(booking.status)) throw codeError('not_found')
    const expired = Date.parse(booking.expires_at) <= Date.now()
    if (status === 'expired' && !expired) throw codeError('not_found')
    const productRef = fs.doc(db, 'products', booking.product_id)
    const productSnap = await tx.get(productRef)
    const variants = productSnap.exists() ? (productSnap.data().variants ?? []).map((v) => ({ ...v })) : []
    const index = variants.findIndex((v) => v.id === booking.variant_id)
    if (productSnap.exists() && index < 0 && !currentAccount().profile?.isStaff) {
      if (status === 'expired') return null
      throw codeError('not_found')
    }
    tx.update(bookingRef, { status, updated_at: fs.serverTimestamp() })
    if (index < 0) return null
    variants[index].quantity = (variants[index].quantity ?? 0) + qtyOf(booking)
    tx.update(productRef, { variants, hold_ref: id, hold_op: 'give', hold_idx: index })
    return { product_id: booking.product_id, variant_id: booking.variant_id, qty: qtyOf(booking) }
  })
  // Вещь вернулась в наличие — правим остаток в запомненном каталоге (без его перезагрузки).
  if (returned) patchStock(returned.product_id, returned.variant_id, returned.qty)
}

// Просроченные действующие строки из списка → «expired», вещь — обратно. Ошибки по одной — не мешают.
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
}
