// Cloudflare Workers: главный файл сайта (см. wrangler.jsonc).
// Адреса /api/… обрабатывает сервер (server/accounts.js, server/handlers.js и server/seller.js),
// всё остальное — готовые страницы сайта из папки dist (env.ASSETS).
import { account, tgSignin } from './accounts.js'
import { botSetup, botWebhook, bookings } from './handlers.js'
import { forCloudflare } from './run.js'
import { admin, me, photo, shop } from './seller.js'

const routes = {
  '/api/bookings': forCloudflare('bookings', bookings),
  '/api/account': forCloudflare('account', account),
  '/api/tg-signin': forCloudflare('tg-signin', tgSignin),
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
