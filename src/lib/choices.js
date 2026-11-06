// Какой из 3 цветов категории выбран на витрине — чтобы страницы категории и товара
// открывались в том же цвете. Живёт, пока открыт сайт.
const chosen = {}

export const getChosenPalette = (slug) => chosen[slug] ?? 0

export function setChosenPalette(slug, index) {
  chosen[slug] = index
}
