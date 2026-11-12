// Подключение к Firebase (как в TheStarth): вход (Authentication) и база (Firestore) — прямо с сайта.
// Кто что может читать и менять, решают правила доступа firebase/firestore.rules, а не сервер.
// Библиотека Firebase большая, поэтому загружается отдельно, после главной страницы, —
// каталог от этого не тормозит (каталог читает базу сам, см. lib/firebase.js).
//
// Настройки (публичные): VITE_FIREBASE_PROJECT_ID и VITE_FIREBASE_API_KEY — в .env на компьютере
// и в Cloudflare → Settings → Build → Variables. Секретных ключей сайту не нужно.

export const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
export const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
export const firebaseConfigured = Boolean(projectId && apiKey)

let loading = null

// { auth, authLib, db, fs } — один раз на всё приложение. null — настроек нет.
export function loadFirebase() {
  if (!firebaseConfigured) return Promise.resolve(null)
  loading ??= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(
    ([app, authLib, fs]) => {
      const firebaseApp = app.initializeApp({ apiKey, projectId, authDomain: `${projectId}.firebaseapp.com` })
      return { auth: authLib.getAuth(firebaseApp), authLib, db: fs.getFirestore(firebaseApp), fs }
    },
  )
  return loading
}
