import { asset } from './base.js'

// Вход в админку на сайте по логину и паролю (server/admin-auth.js).
// Пропуск админа хранится в этом браузере 12 часов (localStorage) и отдельно от входа покупателя/продавца.
const KEY = 'kiyimtop-admin'

export function getAdminSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (saved?.session && saved.exp > Date.now()) return saved.session
  } catch {
    // нет доступа к памяти браузера — просто не вошли
  }
  return null
}

export function adminLogout() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ничего
  }
}

// Ошибка с кодом: wrong, locked, not_configured, network, server.
export async function adminLogin(login, password) {
  let response
  try {
    response = await fetch(asset('/api/admin-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    })
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.session) {
    const code = data?.error ?? (response.status === 404 ? 'not_configured' : 'server')
    throw Object.assign(new Error(code), { code })
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ session: data.session, exp: Date.now() + 12 * 3600 * 1000 - 60_000 }))
  } catch {
    // без памяти браузера войти не получится — сообщим
    throw Object.assign(new Error('server'), { code: 'server' })
  }
  return data.session
}
