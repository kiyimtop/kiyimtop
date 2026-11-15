import { useEffect, useState } from 'react'
import { onAccountChange } from './auth.js'
import { fire } from './db.js'

// Корзина: товары, которые покупатель хочет забронировать (можно из разных магазинов).
// Строка корзины: { product_id, variant_id, qty } — вариант = товар + цвет + размер, qty — 1…5 штук.
//
// Где хранится:
//   не вошли — в этом браузере (localStorage);
//   вошли    — в аккаунте, в базе (carts/<uid>): одна и та же корзина на сайте и в Telegram.
// При входе корзина из браузера переносится в аккаунт (одинаковые вещи складываются).
// При оформлении корзина делится по магазинам: одна бронь на магазин, у каждой свой код (lib/bookings.js).

export const MAX_LINE_QTY = 5
const MAX_LINES = 30
const LOCAL_KEY = 'kiyimtop-cart'

let items = []
let uid = null
let stopWatch = null
const listeners = new Set()

function setItems(next) {
  items = next
  listeners.forEach((listener) => listener(items))
}

const clean = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((line) => typeof line?.variant_id === 'string' && typeof line?.product_id === 'string')
    .map((line) => ({
      product_id: line.product_id,
      variant_id: line.variant_id,
      qty: Math.min(MAX_LINE_QTY, Math.max(1, Math.round(Number(line.qty) || 1))),
    }))
    .slice(0, MAX_LINES)

function readLocal() {
  try {
    return clean(JSON.parse(localStorage.getItem(LOCAL_KEY)))
  } catch {
    return []
  }
}

function writeLocal(list) {
  try {
    if (list.length) localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
    else localStorage.removeItem(LOCAL_KEY)
  } catch {
    // браузер не даёт сохранять — корзина живёт до закрытия страницы
  }
}

// Сложить две корзины: одинаковые варианты — сумма штук (не больше 5).
function merge(a, b) {
  const byVariant = new Map(a.map((line) => [line.variant_id, { ...line }]))
  for (const line of b) {
    const existing = byVariant.get(line.variant_id)
    if (existing) existing.qty = Math.min(MAX_LINE_QTY, existing.qty + line.qty)
    else byVariant.set(line.variant_id, { ...line })
  }
  return [...byVariant.values()].slice(0, MAX_LINES)
}

async function save(list) {
  setItems(list)
  if (!uid) return writeLocal(list)
  try {
    const { db, fs } = await fire()
    await fs.setDoc(fs.doc(db, 'carts', uid), { items: list, updated_at: fs.serverTimestamp() })
  } catch (error) {
    console.error('Корзина не сохранилась:', error)
  }
}

// Вход / выход: подключаем корзину аккаунта или браузера.
let started = false
function start() {
  if (started) return
  started = true
  setItems(readLocal())
  onAccountChange(async (account) => {
    const nextUid = account.status === 'in' ? account.user?.uid ?? null : null
    if (account.status === 'loading' || nextUid === uid) return
    stopWatch?.()
    stopWatch = null
    uid = nextUid
    if (!uid) {
      setItems(readLocal())
      return
    }
    try {
      const { db, fs } = await fire()
      const ref = fs.doc(db, 'carts', uid)
      const snap = await fs.getDoc(ref)
      const remote = clean(snap.exists() ? snap.data().items : [])
      const local = readLocal()
      const merged = merge(remote, local)
      if (local.length) {
        await fs.setDoc(ref, { items: merged, updated_at: fs.serverTimestamp() })
        writeLocal([])
      }
      setItems(merged)
      // Корзина могла поменяться в другой вкладке или в Telegram — следим.
      const watchedUid = uid
      stopWatch = fs.onSnapshot(
        ref,
        (doc) => {
          if (uid === watchedUid) setItems(clean(doc.exists() ? doc.data().items : []))
        },
        (error) => console.error('Корзина:', error),
      )
    } catch (error) {
      console.error('Корзина аккаунта не загрузилась:', error)
    }
  })
}

// Для экранов: { items, count } — count = всего штук.
export function useCart() {
  const [current, setCurrent] = useState(items)
  useEffect(() => {
    start()
    listeners.add(setCurrent)
    setCurrent(items)
    return () => listeners.delete(setCurrent)
  }, [])
  return { items: current, count: current.reduce((sum, line) => sum + line.qty, 0) }
}

export const cartItems = () => items

// Добавить штуку (или несколько). Возвращает, сколько этого варианта теперь в корзине.
export async function addToCart(productId, variantId, qty = 1) {
  start()
  const next = merge(items, [{ product_id: productId, variant_id: variantId, qty }])
  await save(next)
  return next.find((line) => line.variant_id === variantId)?.qty ?? 0
}

export function setCartQty(variantId, qty) {
  const q = Math.min(MAX_LINE_QTY, Math.max(1, Math.round(qty)))
  return save(items.map((line) => (line.variant_id === variantId ? { ...line, qty: q } : line)))
}

export const removeFromCart = (variantId) => save(items.filter((line) => line.variant_id !== variantId))

// Убрать забронированные строки (после оформления).
export const removeCartLines = (variantIds) => save(items.filter((line) => !variantIds.includes(line.variant_id)))
