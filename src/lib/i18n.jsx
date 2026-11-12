import { createContext, useContext, useEffect, useState } from 'react'
import uz from '../locales/uz.json'
import ru from '../locales/ru.json'
import { getUserLanguage } from './platform.js'

export const LANGUAGES = ['uz', 'ru']

const dictionaries = { uz, ru }
const STORAGE_KEY = 'kiyimtop-language'

// Выбираем язык при запуске: сохранённый выбор → язык Telegram/браузера → узбекский.
function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (LANGUAGES.includes(saved)) return saved
  } catch {
    // Браузер может запрещать сохранение — тогда просто определяем язык заново.
  }
  return getUserLanguage().toLowerCase().startsWith('ru') ? 'ru' : 'uz'
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [language, setLanguage] = useState(detectLanguage)

  useEffect(() => {
    document.documentElement.lang = language
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Не получилось сохранить — выбор просто не запомнится.
    }
  }, [language])

  // t('ключ') возвращает надпись на текущем языке.
  // t('ключ', { n: 3 }) — подставляет значения вместо {n} в надписи.
  // t('ключ', {}, 'запасной текст') — если такой надписи нет (например, новый код ошибки).
  const t = (key, values = {}, fallback) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      dictionaries[language][key] ?? fallback ?? key,
    )

  // 549000 → «549 000 so‘m» / «549 000 сум» (пробелы неразрывные — цена не переносится).
  const formatPrice = (amount) => `${formatNumber(amount)}\u00A0${t('price.currency')}`

  // Расстояние: 0.42 → «450 м» / «450 m», 1.26 → «1,3 км», 12.4 → «12 км».
  const formatDistance = (km) => {
    if (km < 1) return t('distance.m', { n: Math.max(50, Math.round((km * 1000) / 50) * 50) })
    const rounded = km < 10 ? km.toFixed(1).replace('.', ',').replace(',0', '') : String(Math.round(km))
    return t('distance.km', { n: rounded })
  }

  // Дата и время по Ташкенту: «6 ноября, 14:30» / «6-noyabr, 14:30».
  const formatDateTime = (value) => {
    const tashkent = new Date(new Date(value).getTime() + 5 * 60 * 60 * 1000) // UTC+5, без летнего времени
    const pad = (n) => String(n).padStart(2, '0')
    return t('date.format', {
      day: tashkent.getUTCDate(),
      month: t(`month.${tashkent.getUTCMonth() + 1}`),
      time: `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`,
    })
  }

  // Только дата по Ташкенту: «31 декабря» / «31-dekabr».
  const formatDate = (value) => {
    const tashkent = new Date(new Date(value).getTime() + 5 * 60 * 60 * 1000)
    return t('date.day', { day: tashkent.getUTCDate(), month: t(`month.${tashkent.getUTCMonth() + 1}`) })
  }

  // Форма слова для числа: 'one' (1, 21, 31 …) или 'many'. В узбекском форма одна.
  const plural = (n) => (language === 'ru' && n % 10 === 1 && n % 100 !== 11 ? 'one' : 'many')

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, formatPrice, formatDistance, formatDateTime, formatDate, plural }}>
      {children}
    </I18nContext.Provider>
  )
}

// 549000 → «549 000» (пробелы неразрывные).
export function formatNumber(amount) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
}

export function useI18n() {
  return useContext(I18nContext)
}
