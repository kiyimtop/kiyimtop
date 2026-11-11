// Cloudflare Pages: /api/shop → server/seller.js
import { shop } from '../../server/seller.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('shop', shop)
