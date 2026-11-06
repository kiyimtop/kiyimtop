// Cloudflare Pages: /api/bot-setup. Сама логика — в server/handlers.js.
import { botSetup } from '../../server/handlers.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('bot-setup', botSetup)
