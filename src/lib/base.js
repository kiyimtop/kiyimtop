// Сайт открывается с корня адреса («/»). BASE задаёт сборка (vite.config.js) — на случай,
// если сайт когда-нибудь будет открываться из подпапки (например, «/kiyimtop/»).
export const BASE = import.meta.env.BASE_URL

// Файл из папки public/ или адрес сервера с учётом BASE: asset('/categories/x.webp') → '/categories/x.webp'.
export const asset = (path) => BASE + path.replace(/^\//, '')
