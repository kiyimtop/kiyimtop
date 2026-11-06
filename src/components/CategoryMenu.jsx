import { useEffect, useState } from 'react'
import { fetchCategories } from '../lib/catalog.js'
import { getChosenPalette } from '../lib/choices.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import Icon from './Icon.jsx'
import Sheet from './Sheet.jsx'
import { artHTML, designFor } from './showcaseArt.js'

// Кнопка «⋮» на главной: открывает шторку-меню — «Мои брони» и все категории плитками
// (цвет категории, фото или рисунок, название). Нажатие на плитку — страница категории.
export default function CategoryMenu() {
  const { language, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState([])

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch((error) => console.error('Не удалось загрузить категории для меню:', error))
  }, [])

  return (
    <>
      <button
        type="button"
        className="menu-button"
        aria-label={t('menu.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="dots" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('menu.title')}>
        <Link to="/bookings" className="menu-link">
          <Icon name="bag" />
          {t('booking.title')}
          <Icon name="chevron" className="icon menu-link-chevron" />
        </Link>
        <h3 className="filter-label">{t('categories.title')}</h3>
        <ul className="menu-grid">
          {categories.map((category) => {
            const design = designFor(category.slug)
            const paletteIndex = getChosenPalette(category.slug)
            const palette = design.palettes[paletteIndex]
            const name = category[`name_${language}`]
            return (
              <li key={category.id}>
                <Link
                  to={`/c/${category.slug}`}
                  className="menu-tile"
                  style={{ background: palette.bg, color: palette.light ? '#ffffff' : 'var(--color-text)' }}
                >
                  <span
                    className="menu-tile-art"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: artHTML(design, paletteIndex, name, category.emoji) }}
                  />
                  <span className="menu-tile-name">{name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Sheet>
    </>
  )
}
