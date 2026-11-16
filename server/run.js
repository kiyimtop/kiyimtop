// Переходник: общий обработчик сервера ({ method, url, header, body, env } → { status, json | html })
// → запрос и ответ Cloudflare Workers (см. server/worker.js).

function toResponseParts(result) {
  // Готовый ответ (например, фото из Telegram) — отдаём как есть.
  if (result.response) return { response: result.response }
  if (result.html !== undefined) return { body: result.html, type: 'text/html; charset=utf-8' }
  return { body: JSON.stringify(result.json), type: 'application/json; charset=utf-8' }
}

async function safely(name, handler, req) {
  try {
    return await handler(req)
  } catch (error) {
    console.error(`${name}:`, error)
    return { status: 500, json: { error: 'server' } }
  }
}

// server/worker.js: '/api/notify': forCloudflare('notify', notify)
// Самый большой запрос — фото товара (до 5 МБ, в JSON это до ~7 МБ). Больше не читаем вообще.
const MAX_BODY = 8 * 1024 * 1024
const tooBig = () =>
  new Response(JSON.stringify({ error: 'too_big' }), { status: 413, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

export function forCloudflare(name, handler) {
  return async ({ request, env }) => {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method)
    if (hasBody && Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return tooBig()
    const text = hasBody ? await request.text() : ''
    if (text.length > MAX_BODY) return tooBig()
    const result = await safely(name, handler, {
      method: request.method,
      url: new URL(request.url),
      header: (key) => request.headers.get(key),
      body: parseJson(text),
      env,
    })
    const { body, type, response } = toResponseParts(result)
    if (response) return response
    return new Response(body, { status: result.status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
}

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
