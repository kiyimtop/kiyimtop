import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './lib/i18n.jsx'
import { initAuth } from './lib/auth.js'
import { asset } from './lib/base.js'
import { initPlatform, isTelegram } from './lib/platform.js'
import './styles/global.css'

// Если приложение открыто в Telegram — настраиваем его (цвет шапки, полный экран).
initPlatform()
// Вход (аккаунт Firebase) — загружается в фоне, чтобы меню и профиль сразу знали, кто вошёл.
initAuth()

// Помощник для установки на телефон (PWA). Только в готовой версии сайта и не в Telegram:
// из Telegram приложение не устанавливают.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isTelegram()) {
  window.addEventListener('load', () => navigator.serviceWorker.register(asset('/sw.js')))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
