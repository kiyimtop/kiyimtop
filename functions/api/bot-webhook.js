// Cloudflare Pages: /api/bot-webhook. Сама логика — в server/handlers.js.
import { botWebhook } from '../../server/handlers.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('bot-webhook', botWebhook)
