// Cloudflare Workers: главный файл сайта (см. wrangler.jsonc).
// Адреса /api/… обрабатывает сервер (server/handlers.js и server/seller.js),
// всё остальное — готовые страницы сайта из папки dist (env.ASSETS).
// Папка functions/ — то же самое для Cloudflare Pages (если сайт создан как Pages, а не как Worker).
import { botSetup, botWebhook, bookings, login } from './handlers.js'
import { forCloudflare } from './run.js'
import { admin, me, photo, shop } from './seller.js'

const routes = {
  '/api/bookings': forCloudflare('bookings', bookings),
  '/api/login': forCloudflare('login', login),
  '/api/bot-webhook': forCloudflare('bot-webhook', botWebhook),
  '/api/bot-setup': forCloudflare('bot-setup', botSetup),
  '/api/me': forCloudflare('me', me),
  '/api/shop': forCloudflare('shop', shop),
  '/api/admin': forCloudflare('admin', admin),
  '/api/photo': forCloudflare('photo', photo),
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    const route = routes[pathname.replace(/\/$/, '')]
    if (route) return route({ request, env, ctx })
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    return env.ASSETS.fetch(request)
  },
}
