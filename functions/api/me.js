// Cloudflare Pages: /api/me → server/seller.js
import { me } from '../../server/seller.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('me', me)
