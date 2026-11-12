// Размеры по порядку: XS, S, M, L … и 30, 32, 40, 41 …
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']

export function compareSizes(a, b) {
  const letterA = LETTER_SIZES.indexOf(a)
  const letterB = LETTER_SIZES.indexOf(b)
  if (letterA !== -1 && letterB !== -1) return letterA - letterB
  if (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}
