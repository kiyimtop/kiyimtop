import { useEffect, useState } from 'react'
import { asset } from './base.js'
import { getTelegramInitData } from './platform.js'

// Аккаунты KiyimTop — Firebase Authentication: вход через Google или по email и паролю.
// Один аккаунт для всего: брони, кабинет магазина, админка. Админ — тот, кому выдали роль
// в админке (или чей email вписан в ADMIN_EMAILS на Cloudflare).
//
// Сервер узнаёт аккаунт по ID-токену Firebase (заголовок «Authorization: Bearer …») и сам проверяет подпись.
// В Telegram (Mini App): если этот Telegram привязан к аккаунту — вход происходит сам (/api/tg-signin).
//
// Библиотека Firebase загружается отдельно, после главной страницы, — каталог от этого не тормозит.

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
export const authConfigured = Boolean(projectId && apiKey)

// Общее состояние для всех экранов.
//   status: 'loading' — ещё не знаем; 'out' — не вошли; 'in' — вошли.
//   user: { uid, email, name, emailVerified, google } — из Firebase;
//   profile: { email, name, emailVerified, telegram, isAdmin, isOwnerAdmin } — с сервера (null — ещё не пришёл или ошибка).
let state = { status: 'loading', user: null, profile: null, profileError: null }
const listeners = new Set()
const setState = (change) => {
  state = { ...state, ...change }
  listeners.forEach((listener) => listener(state))
}

let firebase = null // { auth, lib } после загрузки
let ready = null

function load() {
  if (ready) return ready
  if (!authConfigured) {
    setState({ status: 'out' })
    ready = Promise.resolve(null)
    return ready
  }
  ready = Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, lib]) => {
    const firebaseApp = app.initializeApp({ apiKey, projectId, authDomain: `${projectId}.firebaseapp.com` })
    const auth = lib.getAuth(firebaseApp)
    firebase = { auth, lib }
    let first = true
    lib.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // В Telegram пробуем войти сами — по привязанному Telegram (только при первом запуске).
        if (first && getTelegramInitData()) {
          first = false
          if (await telegramSignIn()) return
        }
        first = false
        setState({ status: 'out', user: null, profile: null, profileError: null })
        return
      }
      first = false
      setState({ status: 'in', user: userOf(user) })
      refreshProfile()
    })
    return firebase
  })
  ready.catch((error) => {
    console.error('Не удалось загрузить вход Firebase:', error)
    setState({ status: 'out' })
  })
  return ready
}

const userOf = (user) => ({
  uid: user.uid,
  email: user.email,
  name: user.displayName,
  emailVerified: user.emailVerified,
  google: user.providerData.some((p) => p.providerId === 'google.com'),
})

// Вход в Mini App по привязанному Telegram. true — вошли.
async function telegramSignIn() {
  try {
    const response = await fetch(asset('/api/tg-signin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getTelegramInitData() }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.token) return false
    await firebase.lib.signInWithCustomToken(firebase.auth, data.token)
    return true
  } catch (error) {
    console.error('Вход через Telegram не удался:', error)
    return false
  }
}

// Начать загрузку сразу при запуске сайта (main.jsx).
export function initAuth() {
  load()
}

// Для экранов: состояние входа, обновляется само.
export function useAccount() {
  const [current, setCurrent] = useState(state)
  useEffect(() => {
    load()
    listeners.add(setCurrent)
    setCurrent(state)
    return () => listeners.delete(setCurrent)
  }, [])
  return current
}

// Заголовок для сервера или null (не вошли).
export async function authHeader() {
  await load()
  const user = firebase?.auth.currentUser
  return user ? `Bearer ${await user.getIdToken()}` : null
}

// --- Запросы к /api/account ---
async function accountCall(method, body) {
  const authorization = await authHeader()
  let response
  try {
    response = await fetch(asset('/api/account'), {
      method,
      headers: { Authorization: authorization ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code = data?.error ?? (response.status === 404 ? 'not_configured' : 'server')
    throw Object.assign(new Error(code), { code })
  }
  return data
}

// Данные аккаунта с сервера (админ ли, привязан ли Telegram).
export async function refreshProfile() {
  try {
    const { user } = await accountCall('GET')
    setState({ profile: user, profileError: null })
    return user
  } catch (error) {
    setState({ profileError: error.code ?? 'server' })
    return null
  }
}

export async function updateName(name) {
  const { user } = await accountCall('POST', { action: 'updateProfile', name })
  setState({ profile: user })
}

// Ссылка на бота для привязки Telegram: токен для t.me/KiyimTopBot?start=link_<token>.
export const startTelegramLink = () => accountCall('POST', { action: 'linkStart' }).then((d) => d.token)

// В Mini App — привязать этот Telegram одним нажатием.
export async function linkThisTelegram() {
  const { user } = await accountCall('POST', { action: 'linkMiniApp', initData: getTelegramInitData() })
  setState({ profile: user })
}

export async function unlinkTelegram() {
  const { user } = await accountCall('POST', { action: 'unlinkTelegram' })
  setState({ profile: user })
}

// --- Вход, регистрация, выход ---
// Ошибка с кодом для экрана (auth.error.<код>): wrong, exists, weak, email, popup, network, too_many,
// not_enabled, domain, server. code = null — человек сам закрыл окно Google (ошибку не показываем).
function authError(error) {
  if (error?.code && !String(error.code).startsWith('auth/')) return error // уже наша ошибка
  const code = String(error?.code ?? '')
  const map = {
    'auth/invalid-credential': 'wrong',
    'auth/wrong-password': 'wrong',
    'auth/user-not-found': 'wrong',
    'auth/invalid-login-credentials': 'wrong',
    'auth/email-already-in-use': 'exists',
    'auth/weak-password': 'weak',
    'auth/invalid-email': 'email',
    'auth/missing-email': 'email',
    'auth/popup-blocked': 'popup',
    'auth/network-request-failed': 'network',
    'auth/too-many-requests': 'too_many',
    'auth/operation-not-allowed': 'not_enabled',
    'auth/unauthorized-domain': 'domain',
    'auth/popup-closed-by-user': null,
    'auth/cancelled-popup-request': null,
    'auth/user-cancelled': null,
  }
  const result = code in map ? map[code] : 'server'
  if (result === 'server') console.error('Ошибка входа:', error)
  return Object.assign(new Error(result ?? 'cancelled'), { code: result })
}

async function withFirebase(work) {
  const loaded = await load()
  if (!loaded) throw Object.assign(new Error('not_configured'), { code: 'not_configured' })
  try {
    return await work(loaded.auth, loaded.lib)
  } catch (error) {
    throw authError(error)
  }
}

const setEmailLanguage = (auth) => {
  auth.languageCode = document.documentElement.lang === 'ru' ? 'ru' : 'uz'
}

export const signInWithGoogle = () =>
  withFirebase((auth, lib) => lib.signInWithPopup(auth, new lib.GoogleAuthProvider()))

export const signInWithEmail = (email, password) =>
  withFirebase((auth, lib) => lib.signInWithEmailAndPassword(auth, email.trim(), password))

// Регистрация: аккаунт, имя и письмо для подтверждения email.
export const registerWithEmail = (name, email, password) =>
  withFirebase(async (auth, lib) => {
    const { user } = await lib.createUserWithEmailAndPassword(auth, email.trim(), password)
    if (name.trim()) await lib.updateProfile(user, { displayName: name.trim() })
    setEmailLanguage(auth)
    await lib.sendEmailVerification(user).catch((error) => console.error('Письмо не отправилось:', error))
    // Имя появилось уже после входа — обновим токен, чтобы сервер его увидел.
    await user.getIdToken(true)
    setState({ user: userOf(user) })
    if (name.trim()) await updateName(name.trim()).catch(() => refreshProfile())
    else await refreshProfile()
  })

export const sendPasswordReset = (email) =>
  withFirebase((auth, lib) => {
    setEmailLanguage(auth)
    return lib.sendPasswordResetEmail(auth, email.trim())
  })

export const resendVerification = () =>
  withFirebase((auth, lib) => {
    setEmailLanguage(auth)
    return lib.sendEmailVerification(auth.currentUser)
  })

// «Я подтвердил» — заново спросить Firebase и обновить токен (в нём появится email_verified).
export const checkVerification = () =>
  withFirebase(async (auth) => {
    await auth.currentUser.reload()
    await auth.currentUser.getIdToken(true)
    setState({ user: userOf(auth.currentUser) })
    await refreshProfile()
    return auth.currentUser.emailVerified
  })

export const signOut = () => withFirebase((auth, lib) => lib.signOut(auth))
