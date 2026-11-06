// Cloudflare Pages: /api/login. Сама логика — в server/handlers.js.
import { login } from '../../server/handlers.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('login', login)
