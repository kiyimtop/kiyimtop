// Cloudflare Workers: главный файл сайта (см. wrangler.jsonc).
// Сайт (брони, кабинет, админка) работает прямо с Firebase — как в TheStarth. Сервер нужен только
// Telegram-боту: адреса /api/… (server/accounts.js, server/handlers.js, server/notify.js, server/seller.js),
// всё остальное — готовые страницы сайта из папки dist (env.ASSETS).
import { account, tgSignin } from './accounts.js'
import { botSetup, botWebhook } from './handlers.js'
import { notify } from './notify.js'
import { forCloudflare } from './run.js'
import { photo } from './seller.js'

const routes = {
  '/api/account': forCloudflare('account', account), // привязка Telegram
  '/api/tg-signin': forCloudflare('tg-signin', tgSignin), // вход в Mini App по привязанному Telegram
  '/api/notify': forCloudflare('notify', notify), // сообщения в бот о бронях и заявках
  '/api/bot-webhook': forCloudflare('bot-webhook', botWebhook),
  '/api/bot-setup': forCloudflare('bot-setup', botSetup),
  '/api/photo': forCloudflare('photo', photo), // фото товаров (хранятся в Telegram)
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
