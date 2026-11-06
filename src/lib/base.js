// Сайт может открываться не с корня адреса: на GitHub Pages — https://kiyimtop.github.io/kiyimtop/.
// BASE — эта часть адреса («/» или «/kiyimtop/»), её задаёт сборка (vite.config.js).
export const BASE = import.meta.env.BASE_URL

// Файл из папки public/ или адрес сервера с учётом BASE: asset('/categories/x.webp') → '/kiyimtop/categories/x.webp'.
export const asset = (path) => BASE + path.replace(/^\//, '')
