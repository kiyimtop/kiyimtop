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
export function forCloudflare(name, handler) {
  return async ({ request, env }) => {
    const text = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : ''
    const result = await safely(name, handler, {
      method: request.method,
      url: new URL(request.url),
      header: (key) => request.headers.get(key),
      body: parseJson(text),
      env,
    })
    const { body, type, response } = toResponseParts(result)
    if (response) return response
    return new Response(body, { status: result.status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
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
