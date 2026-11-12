import { asset } from '../lib/base.js'
// Рисунки вещей для витрины на главной и цвета каждой категории.
// Рисунки (SVG) перекрашиваются кружками цвета. Настоящее фото (без фона, обрезанное по вещи)
// кладём в public/categories/ и вписываем:
//   photo: asset('/categories/<slug>.webp') у категории — одно фото на все 3 цвета (кружки меняют только фон);
//   photo: '…' у каждого цвета — своё фото на каждый кружок (кружок показывает цвет вещи).
//
// В каждой категории 3 цвета: c — вещь, a — детали, bg — фон, light — фон тёмный (текст белый).

import { isLight } from '../lib/colors.js'

let uid = 0

const defs = (u) =>
  `<defs><linearGradient id="sh${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="sd${u}" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></linearGradient></defs>`
// Деталь вещи с объёмом: цвет + тень снизу + блик сверху.
const layer = (d, c, u, extra = '') =>
  `<path d="${d}" fill="${c}" ${extra}/><path d="${d}" fill="url(#sd${u})"/><path d="${d}" fill="url(#sh${u})"/>`
const svg = (viewBox, body, label) =>
  `<svg viewBox="${viewBox}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`

const drawings = {
  sneaker(c, a, label) {
    const u = ++uid
    const up = 'M40 214 C36 188 58 172 96 166 L172 156 C192 148 206 126 216 96 L226 58 C230 48 240 44 252 46 L322 58 C334 60 340 70 338 82 L344 160 C358 172 368 192 368 212 Z'
    let laces = ''
    for (let k = 0; k < 6; k++) {
      const x = 152 + k * 14
      const y = 168 - k * 15
      laces += `<line x1="${x - 11}" y1="${y - 5}" x2="${x + 11}" y2="${y + 5}"/>`
    }
    return svg('0 0 400 280', defs(u) +
      `<path d="M222 72 C212 40 228 26 248 30 L254 48 Z" fill="${c}"/><path d="M222 72 C212 40 228 26 248 30 L254 48 Z" fill="rgba(0,0,0,.12)"/>` +
      layer(up, c, u) +
      `<path d="M40 214 C36 188 58 172 96 166 L128 162 C116 182 114 200 120 214 Z" fill="#fff" opacity=".92"/>` +
      `<path d="M196 212 L246 104 L278 104 L232 212 Z" fill="${a}" opacity=".92"/>` +
      `<path d="M302 150 C322 150 340 160 352 176 C360 190 366 200 368 212 L302 212 Z" fill="${a}" opacity=".85"/>` +
      `<path d="M226 58 C230 48 240 44 252 46 L322 58 C334 60 340 70 338 82" fill="none" stroke="#262626" stroke-width="9" stroke-linecap="round"/>` +
      `<g stroke="#fff" stroke-width="5" stroke-linecap="round">${laces}</g>` +
      `<path d="M36 212 C30 232 40 246 64 248 L344 250 C366 250 378 240 372 222 L369 210 Z" fill="#F6F4EF"/>` +
      `<path d="M42 232 L370 234" stroke="rgba(0,0,0,.12)" stroke-width="3"/>` +
      `<path d="M38 242 C42 252 54 257 70 257 L342 259 C362 259 374 253 376 240" fill="none" stroke="${a}" stroke-width="6" stroke-linecap="round"/>`, label)
  },
  moccasin(c, a, label) {
    const u = ++uid
    const up = 'M48 198 C42 168 74 146 128 140 C180 134 240 136 290 146 C330 154 356 172 358 198 Z'
    return svg('0 0 400 240', defs(u) +
      layer(up, c, u) +
      `<path d="M70 170 C90 136 170 128 210 150 C190 170 120 184 70 170 Z" fill="rgba(0,0,0,.1)"/>` +
      `<path d="M70 170 C90 136 170 128 210 150 C190 170 120 184 70 170 Z" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2.5" stroke-dasharray="6 6"/>` +
      `<path d="M206 150 C244 138 300 144 332 166 C300 160 242 158 208 162 Z" fill="rgba(0,0,0,.5)"/>` +
      `<path d="M146 150 C162 138 186 138 200 150" fill="none" stroke="${a}" stroke-width="7" stroke-linecap="round"/>` +
      `<circle cx="150" cy="160" r="6" fill="${a}"/><circle cx="165" cy="164" r="6" fill="${a}"/>` +
      `<path d="M44 196 C40 212 52 222 74 222 L332 222 C356 222 366 212 360 196 Z" fill="${a}"/>` +
      `<path d="M50 206 L356 206" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="5 5"/>`, label)
  },
  blazer(c, a, label) {
    const u = ++uid
    const body = 'M120 70 L168 50 L200 140 L232 50 L280 70 L318 110 L330 360 L70 360 L82 110 Z'
    return svg('0 0 400 400', defs(u) +
      layer('M120 70 L82 110 L56 330 L92 338 L112 170 Z', c, u) +
      layer('M280 70 L318 110 L344 330 L308 338 L288 170 Z', c, u) +
      `<path d="M120 70 L82 110 L56 330 L92 338 L112 170 Z M280 70 L318 110 L344 330 L308 338 L288 170 Z" fill="rgba(0,0,0,.14)"/>` +
      layer(body, c, u) +
      `<path d="M168 50 L200 140 L232 50 L216 44 L200 60 L184 44 Z" fill="#fff"/>` +
      `<path d="M168 50 L200 140 L186 232 L150 122 L162 96 L146 84 Z" fill="rgba(0,0,0,.2)"/>` +
      `<path d="M232 50 L200 140 L214 232 L250 122 L238 96 L254 84 Z" fill="rgba(0,0,0,.2)"/>` +
      `<path d="M200 140 L200 360" stroke="rgba(0,0,0,.22)" stroke-width="2"/>` +
      `<circle cx="200" cy="262" r="6.5" fill="${a}"/><circle cx="200" cy="300" r="6.5" fill="${a}"/>` +
      `<path d="M100 292 L150 288 M250 288 L300 292 M246 156 L282 153" stroke="rgba(0,0,0,.28)" stroke-width="4" stroke-linecap="round"/>`, label)
  },
  polo(c, a, label) {
    const u = ++uid
    const body = 'M128 66 L172 50 C186 62 214 62 228 50 L272 66 L338 116 L308 158 L280 140 L282 360 L118 360 L120 140 L92 158 L62 116 Z'
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u, 'stroke="rgba(0,0,0,.08)" stroke-width="2"') +
      `<path d="M92 158 L62 116 L70 106 L100 148 Z M308 158 L338 116 L330 106 L300 148 Z" fill="rgba(0,0,0,.12)"/>` +
      `<rect x="193" y="66" width="14" height="62" rx="4" fill="rgba(0,0,0,.08)"/>` +
      `<circle cx="200" cy="84" r="4" fill="${a}"/><circle cx="200" cy="108" r="4" fill="${a}"/>` +
      `<path d="M172 50 L200 68 L186 98 L158 62 Z" fill="${c}" stroke="rgba(0,0,0,.14)" stroke-width="2"/>` +
      `<path d="M228 50 L200 68 L214 98 L242 62 Z" fill="${c}" stroke="rgba(0,0,0,.14)" stroke-width="2"/>` +
      `<path d="M120 344 L282 344" stroke="rgba(0,0,0,.1)" stroke-width="3"/>` +
      `<rect x="236" y="150" width="16" height="10" rx="2" fill="${a}"/>`, label)
  },
  tee(c, a, label) {
    const u = ++uid
    const body = 'M130 80 L170 64 C182 80 218 80 230 64 L270 80 L330 128 L300 168 L274 150 L276 340 L124 340 L126 150 L100 168 L70 128 Z'
    let star = ''
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 20 : 46
      const t = -Math.PI / 2 + (i * Math.PI) / 5
      star += (i ? 'L' : 'M') + (200 + r * Math.cos(t)).toFixed(1) + ' ' + (222 + r * Math.sin(t)).toFixed(1) + ' '
    }
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<path d="M100 168 L70 128 L78 120 L106 158 Z M300 168 L330 128 L322 120 L294 158 Z" fill="${a}"/>` +
      `<path d="M170 64 C182 80 218 80 230 64" fill="none" stroke="${a}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="${star}Z" fill="${a}"/>`, label)
  },
  cap(c, a, label) {
    const u = ++uid
    const crown = 'M70 200 C66 120 130 64 210 64 C286 64 330 120 332 196 Z'
    return svg('0 0 400 260', defs(u) +
      `<path d="M300 186 C344 184 384 196 398 214 C370 226 326 222 290 208 Z" fill="${c}"/><path d="M300 186 C344 184 384 196 398 214 C370 226 326 222 290 208 Z" fill="rgba(0,0,0,.28)"/>` +
      layer(crown, c, u) +
      `<path d="M70 200 L332 196 L330 210 L72 214 Z" fill="rgba(0,0,0,.16)"/>` +
      `<path d="M210 64 C190 110 180 160 182 200 M210 64 C250 110 270 150 276 198" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2.5"/>` +
      `<ellipse cx="210" cy="64" rx="15" ry="7" fill="${c}" stroke="rgba(0,0,0,.2)" stroke-width="2"/>` +
      `<rect x="104" y="128" width="62" height="36" rx="9" fill="${a}"/>` +
      `<text x="135" y="153" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-weight="900" font-size="17" fill="${c}">KT</text>` +
      `<circle cx="150" cy="96" r="4" fill="rgba(0,0,0,.25)"/><circle cx="262" cy="96" r="4" fill="rgba(0,0,0,.25)"/>`, label)
  },
  hoodie(c, a, label) {
    const u = ++uid
    const body = 'M128 92 C140 60 170 44 200 44 C230 44 260 60 272 92 L322 118 C338 126 346 140 348 158 L360 330 L320 338 L300 190 L300 360 L100 360 L100 190 L80 338 L40 330 L52 158 C54 140 62 126 78 118 Z'
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<path d="M200 70 C176 70 160 90 160 112 L200 150 L240 112 C240 90 224 70 200 70 Z" fill="rgba(0,0,0,.32)"/>` +
      `<path d="M186 142 L183 196 M214 142 L217 196" stroke="${a}" stroke-width="5" stroke-linecap="round"/>` +
      `<circle cx="183" cy="198" r="5" fill="${a}"/><circle cx="217" cy="198" r="5" fill="${a}"/>` +
      `<path d="M148 270 L252 270 L270 334 L130 334 Z" fill="rgba(0,0,0,.12)" stroke="rgba(0,0,0,.14)" stroke-width="2"/>` +
      `<path d="M100 342 L300 342 L300 360 L100 360 Z M40 330 L80 338 L78 352 L38 344 Z M360 330 L320 338 L322 352 L362 344 Z" fill="${a}" opacity=".85"/>`, label)
  },
  jacket(c, a, label) {
    const u = ++uid
    const body = 'M130 70 L170 56 L200 96 L230 56 L270 70 L320 104 L338 340 L298 348 L286 196 L290 372 L110 372 L114 196 L102 348 L62 340 L80 104 Z'
    let quilt = ''
    for (const y of [150, 210, 270, 330]) quilt += `<path d="M114 ${y} C150 ${y + 8} 250 ${y + 8} 286 ${y}"/>`
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<g fill="none" stroke="rgba(0,0,0,.16)" stroke-width="3">${quilt}</g>` +
      `<path d="M102 348 L62 340 L80 104 L114 196 Z M298 348 L338 340 L320 104 L286 196 Z" fill="rgba(0,0,0,.1)"/>` +
      `<path d="M170 56 L200 96 L230 56 L222 38 L200 50 L178 38 Z" fill="${a}"/>` +
      `<path d="M200 96 L200 372" stroke="rgba(0,0,0,.38)" stroke-width="4"/>` +
      `<rect x="194" y="104" width="12" height="20" rx="3" fill="${a}"/>` +
      `<path d="M130 286 L170 280 M270 286 L230 280" stroke="${a}" stroke-width="5" stroke-linecap="round"/>`, label)
  },
  jeans(c, a, label) {
    const u = ++uid
    const body = 'M128 46 L272 46 L288 364 L220 364 L200 150 L180 364 L112 364 Z'
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<path d="M128 46 L272 46 L273 72 L127 72 Z" fill="rgba(0,0,0,.2)"/>` +
      `<path d="M150 46 L150 74 M200 46 L200 74 M250 46 L250 74" stroke="rgba(0,0,0,.25)" stroke-width="5"/>` +
      `<circle cx="200" cy="60" r="5" fill="${a}"/>` +
      `<path d="M200 74 L200 150" stroke="rgba(0,0,0,.25)" stroke-width="3"/>` +
      `<path d="M136 74 C146 106 166 112 184 110 M264 74 C254 106 234 112 216 110" fill="none" stroke="${a}" stroke-width="3" stroke-dasharray="6 4"/>` +
      `<path d="M114 340 L180 340 M220 340 L286 340" stroke="rgba(255,255,255,.45)" stroke-width="4"/>`, label)
  },
  dress(c, a, label) {
    const u = ++uid
    const body = 'M164 50 L182 50 L190 96 L210 96 L218 50 L236 50 L246 118 C250 140 246 160 238 176 L322 356 C262 374 138 374 78 356 L162 176 C154 160 150 140 154 118 Z'
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<path d="M158 170 L242 170 L240 190 L160 190 Z" fill="${a}"/>` +
      `<g fill="none" stroke="rgba(0,0,0,.12)" stroke-width="3"><path d="M180 192 L140 362"/><path d="M200 192 L200 368"/><path d="M220 192 L260 362"/></g>` +
      `<path d="M190 96 C194 108 206 108 210 96" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="3"/>`, label)
  },
  shorts(c, a, label) {
    const u = ++uid
    const body = 'M110 90 L290 90 L312 284 L216 294 L200 190 L184 294 L88 284 Z'
    return svg('0 0 400 400', defs(u) +
      layer(body, c, u) +
      `<path d="M110 90 L290 90 L292 120 L108 120 Z" fill="${a}"/>` +
      `<path d="M192 120 C188 142 182 152 176 164 M208 120 C212 142 218 152 224 164" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M98 160 L90 284 M302 160 L310 284" stroke="${a}" stroke-width="8" stroke-linecap="round" opacity=".85"/>`, label)
  },
}

// Внешний вид каждой категории (ключ — slug из базы). pose — наклон рисунка, w — относительный размер.
const designs = {
  tshirts: { drawing: 'tee', pose: 0, w: 0.8, palettes: [
    { c: '#F3F2EC', a: '#4A5BD6', bg: '#B9C4FF', light: false, photo: asset('/categories/tshirts.webp') },
    { c: '#FF9B5E', a: '#1F2340', bg: '#FFD6B8', light: false, photo: asset('/categories/tshirts-orange.webp') },
    { c: '#1F7A55', a: '#F5F1E8', bg: '#A8D8C0', light: false, photo: asset('/categories/tshirts-green.webp') },
  ] },
  shirts: { drawing: 'polo', pose: 0, w: 0.82, palettes: [
    { c: '#F3F2EC', a: '#2E4A3A', bg: '#A9CBB5', light: false },
    { c: '#6C7B38', a: '#EDE6CF', bg: '#CBD69C', light: false },
    { c: '#7E1F30', a: '#F0D9DC', bg: '#E6A3AC', light: false },
  ] },
  hoodies: { drawing: 'hoodie', pose: 0, w: 0.86, palettes: [
    { c: '#8A8F99', a: '#F2F2F2', bg: '#D3D7E0', light: false },
    { c: '#E8543F', a: '#FFE3DC', bg: '#FFB8A1', light: false },
    { c: '#2F4F80', a: '#C9D8F0', bg: '#9EB8DA', light: false },
  ] },
  jackets: { drawing: 'jacket', pose: 0, w: 0.84, palettes: [
    { c: '#2B2D33', a: '#FF9B5E', bg: '#6E6F7A', light: true },
    { c: '#C9A15C', a: '#3B2A14', bg: '#F0DDB4', light: false },
    { c: '#3E6B4F', a: '#E7F0E9', bg: '#A9CBB5', light: false },
  ] },
  suits: { drawing: 'blazer', pose: 0, w: 0.82, palettes: [
    { c: '#1F2B57', a: '#C9A55C', bg: '#4A5DA3', light: true },
    { c: '#35353B', a: '#BFBFC6', bg: '#8D8D97', light: true },
    { c: '#A8733F', a: '#3A2616', bg: '#E6C49B', light: false },
  ] },
  trousers: { drawing: 'jeans', pose: 0, w: 0.78, palettes: [
    { c: '#3A5A8C', a: '#E8A33D', bg: '#A9C1E6', light: false },
    { c: '#2B2B2E', a: '#C8C8CC', bg: '#B5B5BC', light: false },
    { c: '#C2B59B', a: '#5A4A2E', bg: '#EDE3CC', light: false },
  ] },
  dresses: { drawing: 'dress', pose: 0, w: 0.8, palettes: [
    { c: '#E8547A', a: '#FFE1EA', bg: '#FFC2D1', light: false },
    { c: '#4A5BD6', a: '#FFFFFF', bg: '#B9C4FF', light: false },
    { c: '#F2C94C', a: '#7A5A00', bg: '#FFF0B3', light: false },
  ] },
  shorts: { drawing: 'shorts', pose: 0, w: 0.8, palettes: [
    { c: '#1FA3C8', a: '#FFFFFF', bg: '#9FE0F2', light: false },
    { c: '#FF9B5E', a: '#1F2340', bg: '#FFD6B8', light: false },
    { c: '#5E6278', a: '#DDF57E', bg: '#C5C8D6', light: false },
  ] },
  sneakers: { drawing: 'sneaker', pose: -12, w: 1, palettes: [
    { c: '#F3F3F0', a: '#1E1E1E', bg: '#DDF57E', light: false, photo: asset('/categories/sneakers.webp') },
    { c: '#7A8A64', a: '#F2F2F2', bg: '#E8E1CF', light: false, photo: asset('/categories/sneakers-olive.webp') },
    { c: '#2C3A68', a: '#F2F2F2', bg: '#A9C1E6', light: false, photo: asset('/categories/sneakers-navy.webp') },
  ] },
  shoes: { drawing: 'moccasin', pose: -8, w: 0.96, palettes: [
    { c: '#A5643A', a: '#5A3219', bg: '#E9C39D', light: false },
    { c: '#2B2523', a: '#111111', bg: '#B9AB9E', light: false },
    { c: '#2F4F80', a: '#1A2C4A', bg: '#9EB8DA', light: false },
  ] },
  accessories: { drawing: 'cap', pose: -6, w: 0.9, palettes: [
    { c: '#D8342B', a: '#FFFFFF', bg: '#FF9E8C', light: false },
    { c: '#232326', a: '#F0F0F0', bg: '#C7C7CD', light: false },
    { c: '#CBB78C', a: '#3B3021', bg: '#F0E4C5', light: false },
  ] },
}

// Для новой категории, которой ещё нет в списке выше: большое эмодзи и спокойные цвета.
const fallbackDesign = { drawing: null, pose: 0, w: 0.6, palettes: [
  { c: '#4A5BD6', a: '#FFFFFF', bg: '#B9C4FF', light: false },
  { c: '#FF9B5E', a: '#1F2340', bg: '#FFD6B8', light: false },
  { c: '#1F7A55', a: '#FFFFFF', bg: '#A8D8C0', light: false },
] }

export function designFor(slug) {
  return designs[slug] ?? fallbackDesign
}

// Фото для выбранного цвета: своё у цвета, иначе общее у категории, иначе нет (рисунок).
export function photoOf(design, paletteIndex) {
  return design.palettes[paletteIndex]?.photo ?? design.photo ?? null
}

// Все фото категории — чтобы загрузить их заранее.
export function photosOf(design) {
  return [design.photo, ...design.palettes.map((palette) => palette.photo)].filter(Boolean)
}

const escapeHTML = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

// Рисунок вещи в любом цвете товара (для страниц категории и товара, пока нет фото от магазина).
export function itemHTML(design, color, label, emoji) {
  const safeLabel = escapeHTML(label)
  if (!design.drawing) return `<span class="sc-emoji" role="img" aria-label="${safeLabel}">${emoji ?? ''}</span>`
  return drawings[design.drawing](color, isLight(color) ? '#1F2340' : '#F5F1E8', safeLabel)
}

// HTML рисунка: фото, если есть; иначе SVG нужного цвета; иначе эмодзи категории.
export function artHTML(design, paletteIndex, label, emoji) {
  const safeLabel = escapeHTML(label)
  const photo = photoOf(design, paletteIndex)
  if (photo) return `<img src="${photo}" alt="${safeLabel}" draggable="false">`
  const palette = design.palettes[paletteIndex]
  if (design.drawing) return drawings[design.drawing](palette.c, palette.a, safeLabel)
  return `<span class="sc-emoji" role="img" aria-label="${safeLabel}">${emoji ?? ''}</span>`
}
