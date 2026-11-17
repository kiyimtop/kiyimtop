// Аналитика для магазина: считается из броней и товаров, которые кабинет уже загрузил, —
// дополнительных чтений базы не требует. Период — последние 30 дней.
import { bookingState, groupBookings, qtyOf } from './bookings.js'

const DAY = 24 * 60 * 60 * 1000
export const STATS_DAYS = 30
const CHART_DAYS = 14

const top = (map, max = 5) =>
  [...map.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)))
    .slice(0, max)

// products — товары магазина, bookings — строки броней магазина, language — 'uz' | 'ru' (для названий).
export function shopStats(products, bookings, language = 'ru', now = Date.now()) {
  const since = now - STATS_DAYS * DAY
  const lines = bookings.filter((b) => Date.parse(b.created_at) >= since)
  const groups = groupBookings(lines)
  const count = (state) => groups.filter((g) => g.state === state).length
  const pickedUp = count('picked_up')
  const noShow = count('expired')
  const cancelled = count('cancelled')
  const unavailable = count('unavailable')
  const closed = pickedUp + noShow + cancelled + unavailable

  // Выручка — только выданные строки.
  const revenue = lines.filter((l) => bookingState(l, now) === 'picked_up').reduce((sum, l) => sum + (l.price ?? 0) * qtyOf(l), 0)

  // Что и какие размеры бронируют чаще всего (спрос — считаем все брони, даже отменённые).
  const byProduct = new Map()
  const bySize = new Map()
  for (const line of lines) {
    const name = line[`product_name_${language}`] ?? line.product_name_ru ?? line.product_name_uz ?? '—'
    byProduct.set(name, (byProduct.get(name) ?? 0) + qtyOf(line))
    if (line.size) bySize.set(line.size, (bySize.get(line.size) ?? 0) + qtyOf(line))
  }

  // Брони по дням за две недели (для графика).
  const dayKey = (time) => {
    const d = new Date(time)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const perDay = new Map()
  for (const group of groups) perDay.set(dayKey(Date.parse(group.created_at)), (perDay.get(dayKey(Date.parse(group.created_at))) ?? 0) + 1)
  const days = Array.from({ length: CHART_DAYS }, (_, i) => {
    const key = dayKey(now - (CHART_DAYS - 1 - i) * DAY)
    return { day: key, label: String(Number(key.slice(8))), value: perDay.get(key) ?? 0 }
  })

  // Остатки: что закончилось и чего осталось мало (1–2 штуки) — пора пополнить.
  const visible = products.filter((p) => p.is_active !== false)
  const pieces = (p) => (Array.isArray(p.variants) ? p.variants : []).reduce((sum, v) => sum + (Number.isInteger(v?.quantity) && v.quantity > 0 ? v.quantity : 0), 0)
  const nameOf = (p) => p[`name_${language}`] ?? p.name_ru ?? p.name_uz ?? '—'
  const soldOut = visible.filter((p) => pieces(p) === 0)
  const low = visible.filter((p) => pieces(p) > 0 && pieces(p) <= 2)

  return {
    total: groups.length,
    active: groups.filter((g) => g.active).length,
    pickedUp,
    noShow,
    cancelled,
    unavailable,
    // Из закрытых броней — сколько закончились выдачей, %.
    pickupRate: closed ? Math.round((pickedUp / closed) * 100) : null,
    revenue,
    topProducts: top(byProduct),
    topSizes: top(bySize),
    days,
    soldOut: { count: soldOut.length, names: soldOut.slice(0, 5).map(nameOf) },
    low: { count: low.length, names: low.slice(0, 5).map(nameOf) },
  }
}
