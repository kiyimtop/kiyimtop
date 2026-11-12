// Цвета товаров: название цвета из базы (по-узбекски) → цвет для кружков и рисунков.
// Новый цвет в базе — добавить сюда. Неизвестный цвет показывается серым.
const COLORS = {
  Oq: '#F3F3F0',
  Qora: '#232326',
  Kulrang: '#8A8F99',
  'Ko‘k': '#3A6FD8',
  Bej: '#D9C3A0',
  Yashil: '#3E8E5A',
  Qizil: '#D8342B',
  Jigarrang: '#8B5A2B',
  Pushti: '#F28DB2',
  'To‘q ko‘k': '#24345F',
}

// Порядок цветов в фильтре — как в этом списке; незнакомые — в конце.
export function compareColors(a, b) {
  const order = Object.keys(COLORS)
  const index = (name) => (order.includes(name) ? order.indexOf(name) : order.length)
  return index(a) - index(b) || a.localeCompare(b)
}

export function colorHex(nameUz) {
  return COLORS[nameUz] ?? '#A0A4B0'
}

// Светлый ли цвет (на нём нужен тёмный текст/детали).
export function isLight(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6
}

// Цвет, разбавленный белым (amount 0 — как есть, 1 — белый): для фона плитки товара.
export function tint(hex, amount) {
  const mix = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount))
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
