// Cloudflare Pages: /api/admin → server/seller.js
import { admin } from '../../server/seller.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('admin', admin)
