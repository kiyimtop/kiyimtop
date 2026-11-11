// Cloudflare Pages: /api/photo → server/seller.js
import { photo } from '../../server/seller.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('photo', photo)
