// Cloudflare Pages: /api/admin-login → server/admin-auth.js
import { adminLogin } from '../../server/admin-auth.js'
import { forCloudflare } from '../../server/run.js'

export const onRequest = forCloudflare('admin-login', adminLogin)
