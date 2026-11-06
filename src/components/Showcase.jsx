import { useEffect, useRef, useState } from 'react'
import { setChosenPalette } from '../lib/choices.js'
import { useI18n } from '../lib/i18n.jsx'
import { setScreenColor } from '../lib/platform.js'
import { navigate } from '../lib/router.jsx'
import { artHTML, photoOf, photosOf } from './showcaseArt.js'

// Витрина на главной: категории листаются свайпом, фон перекрашивается под категорию,
// сзади — огромное название категории. Анимации — как в образце design/kiyimtop-showcase.html.

// Запоминаем, где остановились, чтобы при возврате на главную не начинать сначала.
const memory = { index: 0, choices: null }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Showcase({ slides }) {
  const { language, t, formatPrice, plural } = useI18n()
  const count = slides.length
  const wrap = (i) => ((i % count) + count) % count

  const [index, setIndex] = useState(() => (memory.index < count ? memory.index : 0))
  const [choices, setChoices] = useState(() =>
    memory.choices?.length === count ? memory.choices : slides.map(() => ({ palette: 0, size: null })),
  )
  const [hintHidden, setHintHidden] = useState(false)

  // Ссылки на элементы и текущие значения — для анимаций и обработчиков свайпа.
  const stageRef = useRef(null)
  const itemsRef = useRef(null)
  const wordWrapRef = useRef(null)
  const wordRef = useRef(null)
  const tintRef = useRef(null)
  const infoRef = useRef(null)
  const metaRef = useRef(null)
  const navRef = useRef(null)
  const itemRef = useRef(null) // вещь, которая сейчас на сцене
  const indexRef = useRef(index)
  const choicesRef = useRef(choices)
  const languageRef = useRef(language)
  const busyRef = useRef(false)
  const dragRef = useRef(null)
  const directionRef = useRef(0)
  const hintHiddenRef = useRef(false)
  languageRef.current = language

  memory.index = index
  memory.choices = choices

  const nameOf = (i) => slides[i].category[`name_${languageRef.current}`]
  const paletteOf = (i) => slides[i].design.palettes[choicesRef.current[i].palette]
  // Наклон: у рисунка — свой, у фото — без наклона (вещь уже снята под углом).
  const poseOf = (i) => (photoOf(slides[i].design, choicesRef.current[i].palette) ? 0 : slides[i].design.pose)

  // Цвета страницы под категорию: фон, текст, кнопки, шапка Telegram.
  function applyTheme(i) {
    const p = paletteOf(i)
    const vars = p.light
      ? { ink: '#ffffff', soft: 'rgba(255,255,255,.74)', word: 'rgba(255,255,255,.12)', chip: 'rgba(255,255,255,.16)', on: '#ffffff', onInk: p.bg }
      : { ink: 'rgba(0,0,0,.88)', soft: 'rgba(0,0,0,.6)', word: 'rgba(255,255,255,.5)', chip: 'rgba(0,0,0,.08)', on: 'rgba(0,0,0,.88)', onInk: '#ffffff' }
    const root = document.documentElement.style
    root.setProperty('--showcase-bg', p.bg)
    root.setProperty('--showcase-ink', vars.ink)
    root.setProperty('--showcase-ink-soft', vars.soft)
    root.setProperty('--showcase-word', vars.word)
    root.setProperty('--showcase-chip', vars.chip)
    root.setProperty('--showcase-chip-on', vars.on)
    root.setProperty('--showcase-chip-on-ink', vars.onInk)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg)
    setScreenColor(p.bg)
  }

  // Полупрозрачный слой цвета следующей категории — проявляется во время свайпа.
  function setTint(color, opacity, animate) {
    const tint = tintRef.current
    if (color) tint.style.background = color
    tint.style.transition = animate ? 'opacity .6s ease' : 'none'
    tint.style.opacity = opacity
  }

  function makeItem(i) {
    const { design, category } = slides[i]
    const el = document.createElement('div')
    el.className = 'sc-item'
    el.style.setProperty('--w', design.w)
    el.innerHTML =
      `<div class="sc-tilt"><div class="sc-shadow"></div><div class="sc-float">` +
      `<div class="sc-pose" style="--pose:${poseOf(i)}deg">` +
      artHTML(design, choicesRef.current[i].palette, nameOf(i), category.emoji) +
      `</div></div></div>`
    return el
  }

  function redrawItem(i) {
    const pose = itemRef.current?.querySelector('.sc-pose')
    if (pose) {
      pose.style.setProperty('--pose', `${poseOf(i)}deg`)
      pose.innerHTML = artHTML(slides[i].design, choicesRef.current[i].palette, nameOf(i), slides[i].category.emoji)
    }
    return pose
  }

  // Огромное название сзади: подбираем размер, чтобы оно поместилось целиком
  // (длинное — на 2–3 строки).
  function setWord(i) {
    wordRef.current.dataset.text = nameOf(i)
    fitWord()
  }

  function fitWord() {
    const word = wordRef.current
    const stage = stageRef.current
    if (!word || !stage || !word.dataset.text) return
    const maxWidth = stage.clientWidth * 0.92
    const maxHeight = stage.clientHeight * 0.86
    const words = word.dataset.text.split(' ')
    let best = null
    for (let lines = 1; lines <= Math.min(3, words.length); lines++) {
      const split = splitIntoLines(words, lines)
      word.textContent = split.join('\n')
      word.style.fontSize = '100px'
      const size = Math.min(300, 100 * Math.min(maxWidth / word.scrollWidth, maxHeight / word.scrollHeight))
      // Больше строк — только если так слово заметно крупнее.
      if (!best || size > best.size * 1.15) best = { size, split }
    }
    word.textContent = best.split.join('\n')
    word.style.fontSize = `${best.size}px`
  }

  function hideHint() {
    if (hintHiddenRef.current) return
    hintHiddenRef.current = true
    setHintHidden(true)
  }

  function animateInfo(dir) {
    if (reducedMotion()) return
    infoRef.current?.querySelectorAll('[data-anim]').forEach((el, k) => {
      el.animate([{ transform: `translateX(${dir * 28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 520,
        delay: 120 + k * 55,
        easing: 'cubic-bezier(.2,.9,.2,1)',
        fill: 'backwards',
      })
    })
  }

  // Переход на другую категорию: старая вещь улетает, новая влетает с «пружинкой».
  function go(to, dir, fromDx = 0) {
    if (busyRef.current) return
    busyRef.current = true
    hideHint()
    const next = wrap(to)
    const reduce = reducedMotion()
    const width = stageRef.current.clientWidth
    const old = itemRef.current

    indexRef.current = next
    applyTheme(next)
    setTint(null, 0, true)

    const item = makeItem(next)
    itemsRef.current.appendChild(item)
    itemRef.current = item

    const out = old.animate(
      [
        { transform: `translateX(${fromDx}px) rotate(${fromDx * 0.03}deg)`, opacity: 1 },
        { transform: `translateX(${-dir * width * 1.1}px) rotate(${-dir * 30}deg) scale(.8)`, opacity: 0 },
      ],
      { duration: reduce ? 160 : 520, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'forwards' },
    )
    old.style.transform = ''
    out.finished.then(() => old.remove()).catch(() => old.remove())
    item.animate(
      [
        { transform: `translateX(${dir * width * 0.9}px) rotate(${dir * 26}deg) scale(.72)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: reduce ? 160 : 780, delay: reduce ? 0 : 80, easing: 'cubic-bezier(.2,1.25,.35,1)', fill: 'backwards' },
    )

    // Слово сзади уезжает, меняется и въезжает с другой стороны.
    const wordWrap = wordWrapRef.current
    const from = wordWrap.style.transform || 'none'
    wordWrap.style.transform = ''
    wordWrap
      .animate([{ transform: from, opacity: 1 }, { transform: `translateX(${-dir * 30}%)`, opacity: 0 }], {
        duration: reduce ? 80 : 260,
        easing: 'ease-in',
        fill: 'forwards',
      })
      .finished.then(() => {
        setWord(next)
        wordWrap.getAnimations().forEach((a) => a.cancel())
        wordWrap.animate([{ transform: `translateX(${dir * 30}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
          duration: reduce ? 80 : 620,
          easing: 'cubic-bezier(.2,.9,.2,1)',
        })
      })
      .catch(() => {})

    directionRef.current = dir
    setIndex(next)
    try {
      navigator.vibrate?.(8)
    } catch {
      // Вибрация есть не везде — это не важно.
    }
    setTimeout(() => {
      busyRef.current = false
    }, reduce ? 160 : 420)
  }

  const goBy = (dir) => go(indexRef.current + dir, dir)

  // ---------- Свайп ----------
  function onPointerDown(e) {
    if (busyRef.current || e.button > 0 || e.target.closest('button')) return
    dragRef.current = { x: e.clientX, y: e.clientY, dx: 0, axis: null, id: e.pointerId, px: e.clientX, pt: performance.now(), vx: 0 }
  }

  function onPointerMove(e) {
    const stage = stageRef.current
    const drag = dragRef.current
    if (!drag) {
      if (e.pointerType === 'mouse') {
        const r = stage.getBoundingClientRect()
        tiltTo((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
      }
      return
    }
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (drag.axis === 'y') {
        dragRef.current = null
        return
      }
      try {
        stage.setPointerCapture(drag.id)
      } catch {
        // Не во всех браузерах — свайп работает и без этого.
      }
      stage.classList.add('dragging')
      hideHint()
    }
    const now = performance.now()
    drag.vx = (e.clientX - drag.px) / Math.max(1, now - drag.pt)
    drag.px = e.clientX
    drag.pt = now
    drag.dx = dx
    itemRef.current.style.transform = `translateX(${dx}px) rotate(${dx * 0.03}deg)`
    wordWrapRef.current.style.transform = `translateX(${dx * 0.28}px)`
    const next = wrap(dx < 0 ? indexRef.current + 1 : indexRef.current - 1)
    setTint(paletteOf(next).bg, Math.min(Math.abs(dx) / stage.clientWidth, 1) * 0.9, false)
  }

  function endDrag() {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    stageRef.current.classList.remove('dragging')
    if (drag.axis !== 'x') return
    const width = stageRef.current.clientWidth
    if (Math.abs(drag.dx) > width * 0.18 || Math.abs(drag.vx) > 0.55) {
      const dir = drag.dx < 0 ? 1 : -1
      go(indexRef.current + dir, dir, drag.dx)
    } else {
      // Свайп короткий — вещь пружинкой возвращается на место.
      const item = itemRef.current
      const from = item.style.transform
      item.style.transform = ''
      item.animate([{ transform: from }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,1.5,.4,1)' })
      const wordWrap = wordWrapRef.current
      const wordFrom = wordWrap.style.transform
      wordWrap.style.transform = ''
      wordWrap.animate([{ transform: wordFrom }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,1.3,.4,1)' })
      setTint(null, 0, true)
    }
  }

  function onPointerLeave(e) {
    if (e.pointerType === 'mouse' && !dragRef.current) tiltTo(0, 0)
  }

  // 3D-наклон вещи: от мыши на компьютере и от наклона телефона (где разрешено).
  function tiltTo(x, y) {
    if (reducedMotion()) return
    const tilt = itemRef.current?.querySelector('.sc-tilt')
    if (tilt) tilt.style.transform = `rotateY(${x * 16}deg) rotateX(${-y * 12}deg)`
  }

  // ---------- Выбор цвета и размера ----------
  function updateChoice(i, change) {
    const next = choicesRef.current.map((choice, j) => (j === i ? { ...choice, ...change } : choice))
    choicesRef.current = next
    setChoices(next)
  }

  function chooseColor(k) {
    const i = indexRef.current
    if (choicesRef.current[i].palette === k) return
    updateChoice(i, { palette: k })
    setChosenPalette(slides[i].category.slug, k)
    applyTheme(i)
    const pose = redrawItem(i)
    if (pose && !reducedMotion()) {
      const angle = poseOf(i)
      pose.animate([{ transform: `rotate(${angle - 10}deg) scale(.86)` }, { transform: `rotate(${angle}deg) scale(1)` }], {
        duration: 560,
        easing: 'cubic-bezier(.2,1.4,.35,1)',
      })
    }
  }

  function chooseSize(size) {
    const i = indexRef.current
    updateChoice(i, { size: choicesRef.current[i].size === size ? null : size })
    if (!reducedMotion()) {
      metaRef.current?.animate([{ transform: 'scale(.96)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' })
    }
  }

  // ---------- Запуск и уборка ----------
  useEffect(() => {
    const html = document.documentElement
    const meta = document.querySelector('meta[name="theme-color"]')
    const originalThemeColor = meta?.getAttribute('content')
    const reduce = reducedMotion()

    // Первый цвет — сразу, без плавного перехода с бежевого.
    html.classList.add('showcase-active', 'showcase-instant')
    applyTheme(indexRef.current)
    requestAnimationFrame(() => html.classList.remove('showcase-instant'))

    const item = makeItem(indexRef.current)
    itemsRef.current.appendChild(item)
    itemRef.current = item
    setWord(indexRef.current)
    if (!reduce) {
      item.animate([{ transform: 'translateY(60px) scale(.85) rotate(8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 1000,
        delay: 150,
        easing: 'cubic-bezier(.2,1.2,.35,1)',
        fill: 'backwards',
      })
      wordWrapRef.current.animate([{ transform: 'translateX(12%)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 1100,
        easing: 'cubic-bezier(.2,.9,.2,1)',
      })
      animateInfo(1)
    }

    // Фото категорий загружаем заранее, чтобы при свайпе они появлялись сразу.
    for (const { design } of slides) for (const photo of photosOf(design)) new Image().src = photo

    const hintTimer = setTimeout(hideHint, 6000)
    // Шрифт загрузился или экран изменился — подгоняем слово заново.
    document.fonts?.ready.then(fitWord)
    const resize = new ResizeObserver(() => fitWord())
    resize.observe(stageRef.current)

    // Наклон телефона (Android; на iPhone браузер не даёт эти данные без разрешения).
    let frame = 0
    function onOrientation(e) {
      if (e.gamma == null || dragRef.current || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const gx = Math.max(-1, Math.min(1, e.gamma / 30))
        const gy = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 35))
        tiltTo(gx * 0.5, gy * 0.5)
      })
    }
    window.addEventListener('deviceorientation', onOrientation)

    // Стрелки на клавиатуре.
    function onKey(e) {
      if (e.target.closest?.('input, textarea')) return
      if (e.key === 'ArrowRight') goBy(1)
      if (e.key === 'ArrowLeft') goBy(-1)
    }
    document.addEventListener('keydown', onKey)

    return () => {
      clearTimeout(hintTimer)
      resize.disconnect()
      window.removeEventListener('deviceorientation', onOrientation)
      document.removeEventListener('keydown', onKey)
      html.classList.remove('showcase-active', 'showcase-instant')
      for (const name of ['bg', 'ink', 'ink-soft', 'word', 'chip', 'chip-on', 'chip-on-ink']) {
        html.style.removeProperty(`--showcase-${name}`)
      }
      if (originalThemeColor) meta.setAttribute('content', originalThemeColor)
      setScreenColor(null)
      itemRef.current?.remove()
      itemRef.current = null
    }
    // Запускается один раз при открытии главной.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Сменился язык — меняем слово сзади и подпись рисунка.
  useEffect(() => {
    if (!itemRef.current) return
    setWord(indexRef.current)
    redrawItem(indexRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Новая категория — текст справа/снизу въезжает, активная категория внизу — в центр.
  useEffect(() => {
    if (directionRef.current) animateInfo(directionRef.current)
    navRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // ---------- Текст под вещью ----------
  const slide = slides[index]
  const choice = choices[index]
  const { stats } = slide
  const sizeInfo = choice.size ? stats.sizes.find((s) => s.size === choice.size) : null
  let priceText
  let availText
  if (choice.size) {
    priceText = sizeInfo?.shopCount ? t('showcase.from', { price: formatPrice(sizeInfo.minPrice) }) : t('product.outOfStock')
    availText = sizeInfo?.shopCount
      ? t(`showcase.sizeInShops.${plural(sizeInfo.shopCount)}`, { size: choice.size, n: sizeInfo.shopCount })
      : t('showcase.sizeNone', { size: choice.size })
  } else {
    priceText = stats.shopCount ? t('showcase.from', { price: formatPrice(stats.minPrice) }) : t('product.outOfStock')
    availText = stats.shopCount ? t(`showcase.inShops.${plural(stats.shopCount)}`, { n: stats.shopCount }) : ''
  }

  return (
    <div className="showcase">
      <div className="sc-tint" ref={tintRef} aria-hidden="true" />

      <div className="sc-main">
        <section
          className="sc-stage"
          ref={stageRef}
          aria-roledescription="carousel"
          aria-label={t('showcase.carousel')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave}
        >
          <div className="sc-word-wrap" ref={wordWrapRef} aria-hidden="true">
            <div className="sc-word" ref={wordRef} />
          </div>
          <div className="sc-items" ref={itemsRef} />
          <button type="button" className="sc-arrow sc-prev" aria-label={t('showcase.prev')} onClick={() => goBy(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button type="button" className="sc-arrow sc-next" aria-label={t('showcase.next')} onClick={() => goBy(1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className={hintHidden ? 'sc-hint hidden' : 'sc-hint'} aria-hidden="true">
            ←&nbsp;&nbsp;{t('showcase.hint')}&nbsp;&nbsp;→
          </div>
        </section>

        <section className="sc-info" ref={infoRef}>
          <h1 className="sc-title" data-anim>
            {slide.category[`name_${language}`]}
          </h1>
          <div className="sc-meta" data-anim ref={metaRef}>
            <span className="sc-price">{priceText}</span>
            <span className="sc-avail">{availText}</span>
          </div>
          {stats.sizes.length > 0 && (
            <div className="sc-sizes" data-anim role="group" aria-label={t('product.size')}>
              {stats.sizes.map(({ size }) => (
                <button key={size} type="button" className="sc-chip" aria-pressed={choice.size === size} onClick={() => chooseSize(size)}>
                  {size}
                </button>
              ))}
            </div>
          )}
          <div className="sc-buy" data-anim>
            <div className="sc-swatches" role="group" aria-label={t('product.color')}>
              {slide.design.palettes.map((palette, k) => (
                <button
                  key={k}
                  type="button"
                  className="sc-swatch"
                  style={{ background: palette.photo || !slide.design.photo ? palette.c : palette.bg }}
                  aria-label={t('showcase.colorN', { n: k + 1 })}
                  aria-pressed={choice.palette === k}
                  onClick={() => chooseColor(k)}
                />
              ))}
            </div>
            <button type="button" className="sc-cta" onClick={() => navigate(`/c/${slide.category.slug}`)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              {t('showcase.cta')}
            </button>
          </div>
        </section>
      </div>

      <nav className="sc-cats" ref={navRef} aria-label={t('categories.title')}>
        {slides.map(({ category }, k) => (
          <button
            key={category.id}
            type="button"
            className="sc-cat"
            aria-current={k === index}
            onClick={() => k !== index && go(k, k > index ? 1 : -1)}
          >
            {category[`name_${language}`]}
          </button>
        ))}
      </nav>
    </div>
  )
}

// Делим название на n строк как можно ровнее: «AYOLLAR / KO‘YLAGI VA / YUBKALAR».
function splitIntoLines(words, n) {
  if (n === 1) return [words.join(' ')]
  let best = null
  for (let i = 1; i <= words.length - (n - 1); i++) {
    const lines = [words.slice(0, i).join(' '), ...splitIntoLines(words.slice(i), n - 1)]
    const longest = Math.max(...lines.map((line) => line.length))
    if (!best || longest < best.longest) best = { lines, longest }
  }
  return best.lines
}
