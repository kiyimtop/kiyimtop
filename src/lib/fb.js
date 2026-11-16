// Подключение к Firebase (как в TheStarth): вход (Authentication) и база (Firestore) — прямо с сайта.
// Кто что может читать и менять, решают правила доступа firebase/firestore.rules, а не сервер.
// Библиотека Firebase большая, поэтому загружается отдельно, после главной страницы, —
// каталог от этого не тормозит (каталог читает базу сам, см. lib/firebase.js).
//
// Настройки (публичные): VITE_FIREBASE_PROJECT_ID и VITE_FIREBASE_API_KEY — в .env на компьютере
// и в Cloudflare → Settings → Build → Variables. Секретных ключей сайту не нужно.
//
// «Невидимая капча» — Firebase App Check: к каждому запросу в базу сайт прикладывает пропуск
// «запрос пришёл с настоящего сайта KiyimTop, а не от скрипта». Пропуск выдаёт Google reCAPTCHA
// (людям ничего решать не нужно). Включается, когда заданы обе настройки (тоже публичные):
//   VITE_FIREBASE_APP_ID — «appId» из Firebase → Project settings → Your apps → firebaseConfig;
//   VITE_RECAPTCHA_ENTERPRISE_KEY — ключ сайта reCAPTCHA Enterprise (или VITE_RECAPTCHA_V3_KEY — ключ reCAPTCHA v3).
// Без них сайт работает как раньше, без App Check. Как настроить — CLAUDE.md, раздел «App Check».

export const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
export const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
export const firebaseConfigured = Boolean(projectId && apiKey)

const appId = import.meta.env.VITE_FIREBASE_APP_ID
const enterpriseKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY
const v3Key = import.meta.env.VITE_RECAPTCHA_V3_KEY
export const appCheckConfigured = Boolean(firebaseConfigured && appId && (enterpriseKey || v3Key))

let appLoading = null

// { app, appCheck, appCheckLib } — приложение Firebase и App Check (appCheck = null — не настроен или не запустился).
// App Check включается здесь, до входа и базы: так требует Firebase, иначе запросы уйдут без пропуска.
export function loadApp() {
  if (!firebaseConfigured) return Promise.resolve(null)
  appLoading ??= import('firebase/app').then(async (appLib) => {
    const app = appLib.initializeApp({ apiKey, projectId, authDomain: `${projectId}.firebaseapp.com`, ...(appId ? { appId } : {}) })
    let appCheck = null
    let appCheckLib = null
    if (appCheckConfigured) {
      try {
        // На своём компьютере (npm run dev) капча не работает — Firebase печатает в консоль отладочный
        // ключ, его вписывают в Firebase → App Check → Apps → Manage debug tokens.
        if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
        appCheckLib = await import('firebase/app-check')
        const provider = enterpriseKey ? new appCheckLib.ReCaptchaEnterpriseProvider(enterpriseKey) : new appCheckLib.ReCaptchaV3Provider(v3Key)
        appCheck = appCheckLib.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true })
      } catch (error) {
        // Капча не запустилась (например, её блокирует браузер) — сайт работает дальше без пропуска.
        console.error('App Check не запустился:', error)
        appCheck = null
      }
    }
    return { app, appCheck, appCheckLib }
  })
  return appLoading
}

// Пропуск App Check для запросов, которые сайт делает сам, без библиотеки базы (каталог, загрузка фото).
// null — App Check не настроен, не запустился или не успел за waitMs (тогда запрос идёт без пропуска).
export async function appCheckToken(waitMs = 3000) {
  if (!appCheckConfigured) return null
  const work = loadApp()
    .then(async (loaded) => (loaded?.appCheck ? (await loaded.appCheckLib.getToken(loaded.appCheck)).token || null : null))
    .catch(() => null)
  return Promise.race([work, new Promise((resolve) => setTimeout(() => resolve(null), waitMs))])
}

let loading = null

// { auth, authLib, db, fs } — один раз на всё приложение. null — настроек нет.
export function loadFirebase() {
  if (!firebaseConfigured) return Promise.resolve(null)
  loading ??= Promise.all([loadApp(), import('firebase/auth'), import('firebase/firestore')]).then(([{ app }, authLib, fs]) => ({
    auth: authLib.getAuth(app),
    authLib,
    db: fs.getFirestore(app),
    fs,
  }))
  return loading
}
