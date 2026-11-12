import { useEffect, useState } from 'react'
import { asset } from './base.js'
import { firebaseConfigured, loadFirebase } from './fb.js'
import { getTelegramInitData } from './platform.js'

// Аккаунты KiyimTop — как в TheStarth: Firebase Authentication + профиль в базе (коллекция users).
// Вход: Google или email + пароль. Регистрация: имя, фамилия, телефон, email и пароль.
//
// Профиль users/<uid> пишет сам сайт (правила firebase/firestore.rules следят, чтобы человек
// не выдал себе роль и не снял блокировку):
//   email, name, surname, phone, role (null | 'seller' | 'moderator' | 'admin'), blocked,
//   telegram_id / telegram_username / telegram_name (пишет только сервер бота), created_at.
// Первого админа владелец назначает сам: Firebase → Firestore → users → свой документ → role = "admin".
// Дальше роли выдаются в админ-панели.
//
// В Telegram (Mini App): если этот Telegram привязан к аккаунту — вход происходит сам (/api/tg-signin,
// работает, когда на Cloudflare вписан ключ сервисного аккаунта — см. CLAUDE.md).

export const authConfigured = firebaseConfigured

// Общее состояние для всех экранов.
//   status: 'loading' — ещё не знаем; 'out' — не вошли; 'in' — вошли.
//   user: { uid, email, name, emailVerified, google } — из Firebase;
//   profile: { uid, email, name, surname, phone, role, blocked, telegram, isAdmin, isStaff, … } — из базы
//   (null — ещё не пришёл; profileError — не удалось загрузить).
let state = { status: 'loading', user: null, profile: null, profileError: null }
const listeners = new Set()
const setState = (change) => {
  state = { ...state, ...change }
  listeners.forEach((listener) => listener(state))
}

let firebase = null
let ready = null
let stopProfile = null
// Данные из формы регистрации — профиль создаётся сразу с ними.
let pendingProfile = null

function load() {
  if (ready) return ready
  if (!authConfigured) {
    setState({ status: 'out' })
    ready = Promise.resolve(null)
    return ready
  }
  ready = loadFirebase().then((loaded) => {
    firebase = loaded
    const { auth, authLib } = loaded
    let first = true
    authLib.onAuthStateChanged(auth, async (user) => {
      stopProfile?.()
      stopProfile = null
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
      setState({ status: 'in', user: userOf(user), profile: null, profileError: null })
      watchProfile(user)
    })
    return loaded
  })
  ready.catch((error) => {
    console.error('Не удалось загрузить Firebase:', error)
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

const STAFF = ['admin', 'moderator']

// Профиль для экранов.
function profileOf(uid, data, user) {
  const role = data.role ?? null
  return {
    uid,
    email: data.email ?? user.email ?? null,
    name: data.name ?? null,
    surname: data.surname ?? null,
    phone: data.phone ?? null,
    role,
    blocked: data.blocked === true,
    emailVerified: user.emailVerified,
    telegram: Number.isSafeInteger(data.telegram_id)
      ? { id: data.telegram_id, username: data.telegram_username ?? null, name: data.telegram_name ?? null }
      : null,
    isAdmin: role === 'admin',
    isModerator: role === 'moderator',
    isStaff: STAFF.includes(role),
    // Главного админа (из ADMIN_EMAILS) больше нет: все админы равны, себя снять нельзя.
    isOwnerAdmin: false,
  }
}

// Профиль из базы: создаём при первом входе, дальше следим за изменениями (роль, блокировка, Telegram).
async function watchProfile(user) {
  const { db, fs } = firebase
  const ref = fs.doc(db, 'users', user.uid)
  try {
    const snap = await fs.getDoc(ref)
    const extra = pendingProfile
    pendingProfile = null
    if (!snap.exists()) {
      await fs.setDoc(ref, {
        email: user.email ?? null,
        email_verified: user.emailVerified,
        name: (extra?.name || user.displayName || (user.email ? user.email.split('@')[0] : '') || 'KiyimTop').slice(0, 80),
        surname: extra?.surname ?? null,
        phone: extra?.phone ?? null,
        role: null,
        blocked: false,
        lang: document.documentElement.lang === 'ru' ? 'ru' : 'uz',
        created_at: fs.serverTimestamp(),
      })
    } else {
      // Email и его подтверждение — как в Firebase; данные регистрации — если пришли.
      const data = snap.data()
      const change = {}
      if (user.email && data.email !== user.email) change.email = user.email
      if (data.email_verified !== user.emailVerified) change.email_verified = user.emailVerified
      if (!data.name) change.name = (user.displayName || (user.email ? user.email.split('@')[0] : '') || 'KiyimTop').slice(0, 80)
      if (extra) Object.assign(change, extra)
      if (Object.keys(change).length) await fs.updateDoc(ref, change)
    }
  } catch (error) {
    console.error('Профиль не загрузился:', error)
    setState({ profileError: error?.code === 'permission-denied' ? 'forbidden' : 'server' })
  }
  if (firebase.auth.currentUser?.uid !== user.uid) return
  stopProfile = fs.onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return
      setState({ profile: profileOf(user.uid, snap.data(), firebase.auth.currentUser ?? user), profileError: null })
    },
    (error) => {
      console.error('Профиль:', error)
      setState({ profileError: 'server' })
    },
  )
}

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
    await firebase.authLib.signInWithCustomToken(firebase.auth, data.token)
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

// Текущее состояние без подписки (для функций, не для экранов).
export const currentAccount = () => state

// Заголовок для сервера (фото, сообщения бота) или null (не вошли).
export async function authHeader() {
  await load()
  const user = firebase?.auth.currentUser
  return user ? `Bearer ${await user.getIdToken()}` : null
}

// Профиль приходит сам (следим за ним); оставлено для экранов, которые просят «обновить».
export async function refreshProfile() {
  return state.profile
}

// Имя, фамилия и телефон.
export async function updateProfile({ name, surname, phone }) {
  const loaded = await load()
  const uid = loaded?.auth.currentUser?.uid
  if (!uid) throw Object.assign(new Error('auth'), { code: 'auth' })
  const clean = {
    name: String(name ?? '').trim().slice(0, 80),
    surname: String(surname ?? '').trim().slice(0, 80) || null,
    phone: normalizePhone(phone),
  }
  if (!clean.name) throw Object.assign(new Error('bad_request'), { code: 'bad_request' })
  try {
    await loaded.fs.updateDoc(loaded.fs.doc(loaded.db, 'users', uid), clean)
  } catch (error) {
    console.error('Профиль не сохранился:', error)
    throw Object.assign(new Error('server'), { code: error?.code === 'permission-denied' ? 'forbidden' : 'server' })
  }
}

// Прежнее название — для старых экранов.
export const updateName = (name) => updateProfile({ name, surname: state.profile?.surname, phone: state.profile?.phone })

// ---------- Телефон ----------
// Храним полностью: «+998901234567». Пустой — null. Узбекский номер без кода дополняем +998.
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 9) digits = `998${digits}`
  return `+${digits}`.slice(0, 16)
}

export const phoneValid = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.startsWith('998') ? digits.length === 12 : digits.length >= 10 && digits.length <= 15
}

// «+998 90 123 45 67» для показа.
export function formatPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('998')) {
    const d = digits.slice(3)
    return ['+998', d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ')
  }
  return `+${digits}`
}

// ---------- Telegram (работает, когда на Cloudflare настроен бот и ключ сервисного аккаунта) ----------
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

// Ссылка на бота для привязки Telegram: токен для t.me/KiyimTopBot?start=link_<token>.
export const startTelegramLink = () => accountCall('POST', { action: 'linkStart' }).then((d) => d.token)

// В Mini App — привязать этот Telegram одним нажатием (профиль обновится сам).
export const linkThisTelegram = () => accountCall('POST', { action: 'linkMiniApp', initData: getTelegramInitData() })

// Отвязать — сам сайт (правила разрешают только очистить эти поля).
export async function unlinkTelegram() {
  const loaded = await load()
  const uid = loaded?.auth.currentUser?.uid
  if (!uid) throw Object.assign(new Error('auth'), { code: 'auth' })
  await loaded.fs.updateDoc(loaded.fs.doc(loaded.db, 'users', uid), { telegram_id: null, telegram_username: null, telegram_name: null })
}

// ---------- Вход, регистрация, выход ----------
// Ошибка с кодом для экрана (auth.error.<код>): wrong, exists, weak, email, popup, network, too_many,
// not_enabled, domain, phone, server. code = null — человек сам закрыл окно Google (ошибку не показываем).
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
    return await work(loaded.auth, loaded.authLib)
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

// Регистрация (как в TheStarth): имя, фамилия, телефон, email и пароль. Потом — письмо для подтверждения email.
export const registerWithEmail = ({ name, surname, phone, email, password }) =>
  withFirebase(async (auth, lib) => {
    if (!phoneValid(phone)) throw Object.assign(new Error('phone'), { code: 'phone' })
    pendingProfile = {
      name: String(name ?? '').trim().slice(0, 80),
      surname: String(surname ?? '').trim().slice(0, 80) || null,
      phone: normalizePhone(phone),
    }
    let user
    try {
      ;({ user } = await lib.createUserWithEmailAndPassword(auth, email.trim(), password))
    } catch (error) {
      pendingProfile = null
      throw error
    }
    const fullName = [pendingProfile?.name, pendingProfile?.surname].filter(Boolean).join(' ')
    if (fullName) await lib.updateProfile(user, { displayName: fullName }).catch(() => {})
    setEmailLanguage(auth)
    await lib.sendEmailVerification(user).catch((error) => console.error('Письмо не отправилось:', error))
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

// «Я подтвердил» — заново спросить Firebase и обновить пропуск (в нём появится email_verified —
// его проверяют правила базы при брони).
export const checkVerification = () =>
  withFirebase(async (auth) => {
    await auth.currentUser.reload()
    await auth.currentUser.getIdToken(true)
    const user = auth.currentUser
    setState({ user: userOf(user), profile: state.profile && { ...state.profile, emailVerified: user.emailVerified } })
    if (user.emailVerified && firebase) {
      await firebase.fs.updateDoc(firebase.fs.doc(firebase.db, 'users', user.uid), { email_verified: true }).catch(() => {})
    }
    return user.emailVerified
  })

export const signOut = () => withFirebase((auth, lib) => lib.signOut(auth))
