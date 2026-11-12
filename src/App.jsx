import { useCallback, useEffect } from 'react'
import BackButton from './components/BackButton.jsx'
import CategoryMenu from './components/CategoryMenu.jsx'
import Icon from './components/Icon.jsx'
import LanguageSwitcher from './components/LanguageSwitcher.jsx'
import { useAccount } from './lib/auth.js'
import { fetchVariant } from './lib/catalog.js'
import { useI18n } from './lib/i18n.jsx'
import { getStartParam, isTelegram } from './lib/platform.js'
import { appPath, goBack, Link, openStartPage, useRoute } from './lib/router.jsx'
import Account from './pages/Account.jsx'
import Admin from './pages/Admin.jsx'
import CategoryShops from './pages/CategoryShops.jsx'
import Home from './pages/Home.jsx'
import MyBookings from './pages/MyBookings.jsx'
import Product from './pages/Product.jsx'
import Search from './pages/Search.jsx'
import SellerCabinet from './pages/SellerCabinet.jsx'
import Shop from './pages/Shop.jsx'

export default function App() {
  const { t } = useI18n()
  const route = useRoute()
  const onBack = useCallback(() => goBack(route.parent), [route.parent])
  const { status } = useAccount()

  // Открыли по ссылке t.me/KiyimTopBot?startapp=… — сразу нужная страница вместо главной:
  // «bookings» — мои брони, «sneakers__<номер товара>» — товар,
  // «book__<номер варианта>» — бронь, начатая на сайте: товар с этим цветом и размером
  // и сразу открытым подтверждением брони.
  useEffect(() => {
    const start = getStartParam()
    if (!start || appPath() !== '/') return
    try {
      if (sessionStorage.getItem('kiyimtop-start') === start) return // уже открывали в этот раз
      sessionStorage.setItem('kiyimtop-start', start)
    } catch {
      // Браузер не даёт запомнить — не страшно.
    }
    const book = start.match(/^book__([0-9a-f-]{36})$/i)
    const product = start.match(/^([\w-]+)__([0-9a-f-]{36})$/i)
    if (start === 'bookings') openStartPage('/bookings')
    else if (start === 'shop') openStartPage('/my-shop')
    else if (start === 'account') openStartPage('/account')
    else if (book) {
      fetchVariant(book[1])
        .then((target) => {
          if (target) openStartPage(`/c/${target.slug}/p/${target.productId}?variant=${target.variantId}&book=1`)
        })
        .catch((error) => console.error('Не удалось открыть бронь из ссылки:', error))
    } else if (product) openStartPage(`/c/${product[1]}/p/${product[2]}`)
  }, [])

  return (
    <div className={`page page-${route.name}`}>
      <header className="page-header">
        {route.parent && <BackButton onBack={onBack} />}
        {route.name === 'home' && <span className="header-logo">{t('app.name')}</span>}
        {/* Лупа — поиск по категориям, магазинам и товарам (на самой странице поиска не нужна). */}
        {route.name !== 'search' && (
          <Link to="/search" className="search-button" aria-label={t('search.title')}>
            <Icon name="search" />
          </Link>
        )}
        {/* Профиль: вход, брони, кабинет, админка. Точка — уже вошли. */}
        {route.name !== 'account' && (
          <Link to="/account" className="search-button account-button" aria-label={t(status === 'in' ? 'account.title' : 'account.loginTitle')}>
            <Icon name="user" />
            {status === 'in' && <span className="account-dot" aria-hidden="true" />}
          </Link>
        )}
        <LanguageSwitcher />
        {route.name === 'home' && <CategoryMenu />}
      </header>

      <main className="page-main">
        {route.name === 'product' && <Product key={route.id} id={route.id} slug={route.slug} />}
        {route.name === 'category' && <CategoryShops key={route.slug} slug={route.slug} />}
        {route.name === 'shop' && <Shop key={route.id} id={route.id} />}
        {route.name === 'search' && <Search />}
        {route.name === 'bookings' && <MyBookings />}
        {route.name === 'account' && <Account />}
        {route.name === 'my-shop' && <SellerCabinet />}
        {route.name === 'admin' && <Admin />}
        {route.name === 'home' && <Home />}
      </main>

      {route.name !== 'home' && (
        <footer className="page-footer">{t(isTelegram() ? 'platform.telegram' : 'platform.browser')}</footer>
      )}
    </div>
  )
}
