// Cloudflare Pages: /api/bookings. Сама логика — в server/handlers.js.
import { bookings } from '../../server/handlers.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('bookings', bookings)
