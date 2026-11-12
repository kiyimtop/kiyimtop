import { setScreenColor } from './platform.js'

// Фон всей страницы в цвете категории (как на витрине) и шапка Telegram того же цвета.
// resetPageColor() возвращает обычный бежевый.
let originalThemeColor = null

export function setPageColor(background, darkBackground) {
  const html = document.documentElement
  const meta = document.querySelector('meta[name="theme-color"]')
  if (originalThemeColor === null) originalThemeColor = meta?.getAttribute('content') ?? ''
  html.classList.add('page-colored')
  html.style.setProperty('--page-bg', background)
  html.style.setProperty('--page-ink', darkBackground ? '#ffffff' : 'var(--color-text)')
  html.style.setProperty('--page-ink-soft', darkBackground ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.6)')
  meta?.setAttribute('content', background)
  setScreenColor(background)
}

export function resetPageColor() {
  const html = document.documentElement
  html.classList.remove('page-colored')
  for (const name of ['--page-bg', '--page-ink', '--page-ink-soft']) html.style.removeProperty(name)
  if (originalThemeColor) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', originalThemeColor)
  setScreenColor(null)
}
