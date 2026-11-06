// Service worker KiyimTop — маленький помощник, который работает в фоне.
// Нужен, чтобы приложение можно было установить на телефон (PWA),
// и чтобы без интернета открывалась последняя загруженная версия, а не ошибка.

// При изменении этого файла увеличить номер версии — старые сохранённые копии удалятся.
const CACHE = 'kiyimtop-v3'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // Не трогаем: отправку данных, чужие сайты (Telegram, Firebase) и серверные функции.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return
  }

  // Сначала всегда берём свежую версию из интернета и сохраняем копию.
  // Если интернета нет — отдаём сохранённую копию.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') return caches.match(self.registration.scope) // главная страница сайта
        return Response.error()
      }),
  )
})
