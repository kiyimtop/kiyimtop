import ru from '../locales/ru.json'
import uz from '../locales/uz.json'

// Поиск по каталогу: категории, магазины, товары — сразу на узбекском и русском.
// «кроссовки» и «krossovka» находят одно и то же, потому что у товаров и категорий
// названия на двух языках. Ищем прямо на телефоне по уже загруженному списку
// (fetchSearchIndex в catalog.js). Когда товаров станет много — перенести поиск в базу.

// Узбекский кириллицей → латиницей: «кийим» → «kiyim», «қора» → «qora».
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

// Приводим текст к одному виду: маленькие буквы, ё → е, без апострофов
// (o‘, o', o`, oʻ — одно и то же: «ko'ylak», «koylak» и «ko‘ylak» совпадут), дефис — как пробел.
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‘’'`ʻʼ´]/g, '')
    .replace(/[-–—_.,/()«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const transliterate = (word) => [...word].map((letter) => CYRILLIC[letter] ?? letter).join('')

// Варианты слова: как написано, латиницей (если писали кириллицей) и без окончания
// («кроссовок» → «кроссов», «футболку» → «футболк»), чтобы находилось в любой форме.
function variants(word) {
  const forms = new Set([word, transliterate(word)])
  for (const form of [...forms]) {
    if (form.length >= 5) forms.add(form.slice(0, -1))
    if (form.length >= 7) forms.add(form.slice(0, -2))
  }
  return [...forms]
}

const fits = (text, wordForms) => wordForms.every((forms) => forms.some((form) => text.includes(form)))

const districtNames = (district) => (district ? [uz[`district.${district}`], ru[`district.${district}`]] : [])

// Готовим список для поиска один раз: у каждой записи — весь её текст на обоих языках.
export function buildIndex({ categories, shops, products }) {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const shopById = new Map(shops.map((shop) => [shop.id, shop]))
  return {
    categories: categories.map((category) => ({
      item: category,
      text: normalize([category.name_uz, category.name_ru, category.slug].join(' ')),
    })),
    shops: shops.map((shop) => ({
      item: shop,
      text: normalize(
        [shop.name, shop.address_uz, shop.address_ru, shop.landmark_uz, shop.landmark_ru, ...districtNames(shop.district)].join(' '),
      ),
    })),
    products: products
      .filter((product) => categoryById.has(product.category_id) && shopById.has(product.shop_id))
      .map((product) => {
        const category = categoryById.get(product.category_id)
        return {
          item: { ...product, category, shop: shopById.get(product.shop_id) },
          text: normalize(
            [
              product.name_uz,
              product.name_ru,
              product.brand,
              category.name_uz,
              category.name_ru,
              ...product.colors.flatMap((color) => [color.uz, color.ru]),
            ].join(' '),
          ),
        }
      }),
  }
}

// Что нашлось по запросу: { categories, shops, products }.
// Каждое слово запроса должно встретиться (в любом порядке). У товара — ещё и цвет из запроса
// («qora krossovka» → чёрный), чтобы показать вещь в этом цвете и сразу открыть её в нём.
export function searchCatalog(index, query) {
  const words = normalize(query).split(' ').filter(Boolean)
  if (words.join('').length < 2) return null
  const wordForms = words.map(variants)
  const found = (list) => list.filter((entry) => fits(entry.text, wordForms)).map((entry) => entry.item)

  const products = found(index.products)
    .map((product) => {
      const color = product.colors.find((c) =>
        wordForms.some((forms) => forms[0].length >= 3 && forms.some((form) => normalize(`${c.uz} ${c.ru}`).includes(form))),
      )
      return { ...product, matchedColor: color?.uz ?? null }
    })
    .sort((a, b) => b.inStock - a.inStock || a.price - b.price)

  return {
    categories: found(index.categories),
    shops: found(index.shops).sort((a, b) => a.name.localeCompare(b.name)),
    products,
  }
}
