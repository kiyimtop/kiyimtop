import { useEffect, useState } from 'react'
import { useAccount } from '../lib/auth.js'
import { fetchCategories } from '../lib/catalog.js'
import { getChosenPalette } from '../lib/choices.js'
import { useI18n } from '../lib/i18n.jsx'
import { Link } from '../lib/router.jsx'
import Icon from './Icon.jsx'
import Sheet from './Sheet.jsx'
import { artHTML, designFor } from './showcaseArt.js'

// Кнопка «⋮» на главной: открывает шторку-меню — профиль, «Мои брони», админ-панель (только админу),
// все категории плитками (цвет категории, фото или рисунок, название) и внизу — «Для магазинов».
export default function CategoryMenu() {
  const { language, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState([])
  const account = useAccount()

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
        <div className="menu-links">
          <Link to="/account" className="menu-link">
            <Icon name="user" />
            {account.status === 'in' ? (
              <span>
                {t('account.title')}
                <small>{account.user?.email}</small>
              </span>
            ) : (
              t('account.loginTitle')
            )}
            <Icon name="chevron" className="icon menu-link-chevron" />
          </Link>
          <Link to="/bookings" className="menu-link">
            <Icon name="bag" />
            {t('booking.title')}
            <Icon name="chevron" className="icon menu-link-chevron" />
          </Link>
          {/* Админ-панель видят только админы. */}
          {account.profile?.isStaff && (
            <Link to="/admin" className="menu-link profile-admin">
              <Icon name="shield" />
              {t('account.adminPanel')}
              <Icon name="chevron" className="icon menu-link-chevron" />
            </Link>
          )}
        </div>
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
        {/* Для владельцев магазинов — внизу, чтобы не мешать покупателям. */}
        <Link to="/my-shop" className="menu-link menu-link-quiet">
          <Icon name="store" />
          <span>
            {t('seller.menu')}
            <small>{t('seller.menuHint')}</small>
          </span>
          <Icon name="chevron" className="icon menu-link-chevron" />
        </Link>
      </Sheet>
    </>
  )
}
