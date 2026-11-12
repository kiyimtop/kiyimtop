import { useEffect, useState } from 'react'
import { BASE } from './base.js'

// Внутри приложения адреса пишем от корня (/c/sneakers), а в строке браузера к ним добавляется BASE
// (на GitHub Pages — /kiyimtop/c/sneakers). withBase добавляет, appPath убирает.
const prefix = BASE.replace(/\/$/, '')
export const withBase = (path) => prefix + path
export function appPath(pathname = window.location.pathname) {
  return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname
}

// Адреса страниц без отдельной библиотеки:
//   /             — главная (категории)
//   /c/<slug>     — категория: магазины и их товары, например /c/sneakers
//   /c/<slug>/p/<id> — товар этой категории
//   /s/<id>       — магазин: адрес, часы и все его товары
//   /search       — поиск (/search?q=krossovka)
//   /bookings     — мои брони
//   /account      — профиль: вход и регистрация, имя, Telegram, ссылки на кабинет и админку
//   /my-shop      — кабинет магазина (заявка, товары, брони)
//   /admin        — админка (заявки магазинов, подписки)
function parse(pathname) {
  const product = pathname.match(/^\/c\/([\w-]+)\/p\/([\w-]+)\/?$/)
  if (product) return { name: 'product', slug: product[1], id: product[2], parent: `/c/${product[1]}` }
  const category = pathname.match(/^\/c\/([\w-]+)\/?$/)
  if (category) return { name: 'category', slug: category[1], parent: '/' }
  const shop = pathname.match(/^\/s\/([\w-]+)\/?$/)
  if (shop) return { name: 'shop', id: shop[1], parent: '/' }
  if (/^\/search\/?$/.test(pathname)) return { name: 'search', parent: '/' }
  if (/^\/bookings\/?$/.test(pathname)) return { name: 'bookings', parent: '/' }
  if (/^\/account\/?$/.test(pathname)) return { name: 'account', parent: '/' }
  if (/^\/my-shop\/?$/.test(pathname)) return { name: 'my-shop', parent: '/' }
  if (/^\/admin\/?$/.test(pathname)) return { name: 'admin', parent: '/account' }
  return { name: 'home', parent: null }
}

// Перейти на страницу внутри приложения (без перезагрузки).
export function navigate(path, { replace = false } = {}) {
  const state = { inApp: true } // отметка: на эту страницу пришли изнутри приложения
  if (replace) window.history.replaceState(state, '', withBase(path))
  else window.history.pushState(state, '', withBase(path))
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

// Открыть страницу при запуске (например, по ссылке из Telegram) вместо главной.
// Без отметки «изнутри приложения»: «Назад» отсюда ведёт на уровень выше, а не закрывает приложение.
export function openStartPage(path) {
  window.history.replaceState(null, '', withBase(path))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// «Назад»: если пришли изнутри приложения — шаг назад в истории,
// если открыли ссылку сразу на эту страницу — на страницу уровнем выше.
export function goBack(parent) {
  if (window.history.state?.inApp) window.history.back()
  else navigate(parent ?? '/', { replace: true })
}

// Поменять часть адреса после «?» (например, выбранные фильтры), не создавая новую запись
// в истории: «Назад» по-прежнему ведёт на прошлую страницу, а при возврате фильтры на месте.
export function replaceSearch(search) {
  const url = window.location.pathname + (search ? `?${search}` : '')
  window.history.replaceState(window.history.state, '', url)
}

// Текущая страница. Обновляется при переходах и при кнопке «Назад» браузера.
export function useRoute() {
  const [pathname, setPathname] = useState(appPath)

  useEffect(() => {
    const onChange = () => setPathname(appPath())
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  return parse(pathname)
}

// Ссылка внутри приложения. Обычная ссылка <a>: её можно открыть в новой вкладке.
export function Link({ to, ...props }) {
  function onClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={withBase(to)} onClick={onClick} {...props} />
}
