// Единственное место в коде, которое знает про Telegram.
// Остальные файлы спрашивают отсюда: «мы в Telegram?», «какой язык у пользователя?».

// Цвет фона для шапки Telegram — такой же, как --color-bg в styles/global.css.
const BRAND_BACKGROUND = '#F5F1E8'

function getTelegram() {
  const webApp = window.Telegram?.WebApp
  // Скрипт Telegram загружается и в обычном браузере,
  // но данные пользователя (initData) есть только внутри Telegram.
  return webApp && webApp.initData ? webApp : null
}

export function isTelegram() {
  return getTelegram() !== null
}

// Имя бота — для ссылок «Открыть в Telegram».
const BOT_USERNAME = 'KiyimTopBot'

// Подписанные Telegram данные о пользователе (initData). Сервер проверяет подпись и узнаёт,
// кто бронирует. В браузере — пустая строка (там вход через Telegram появится позже).
export function getTelegramInitData() {
  return getTelegram()?.initData ?? ''
}

// С какой страницы открыли Mini App по ссылке t.me/KiyimTopBot?startapp=… (или '').
export function getStartParam() {
  return getTelegram()?.initDataUnsafe?.start_param ?? ''
}

// Ссылка, которая открывает KiyimTop в Telegram сразу на нужной странице.
// Нужен включённый «главный» Mini App бота: @BotFather → /mybots → бот → Bot Settings →
// Configure Mini App → Enable Mini App (адрес сайта). Без этого Telegram показывает ошибку BOT_INVALID.
export function telegramAppLink(startParam = '') {
  return `https://t.me/${BOT_USERNAME}${startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''}`
}

// Ссылка на чат с ботом с «Start»-параметром: t.me/KiyimTopBot?start=login_… — для входа на сайте.
// Такие ссылки открываются во всех версиях Telegram, и на компьютере тоже (в отличие от startapp).
export function telegramBotLink(start) {
  return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(start)}`
}

// Телефон или планшет (палец вместо мыши): там ссылки t.me/…?startapp открывают приложение Telegram.
// На компьютере Telegram Desktop такие ссылки не открывает (ошибка BOT_INVALID), поэтому там их не показываем.
export function isTouchScreen() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

// Язык пользователя: из Telegram, а в браузере — из настроек браузера.
export function getUserLanguage() {
  const telegram = getTelegram()
  if (telegram) {
    return telegram.initDataUnsafe?.user?.language_code || ''
  }
  return navigator.language || ''
}

// Кнопка «Назад» в шапке Telegram. Возвращает функцию, которая её убирает.
// В браузере и в старых версиях Telegram ничего не делает.
// Если открыта шторка поверх страницы, «Назад» закрывает только шторку:
// срабатывает последний добавленный обработчик, а кнопка прячется, когда их не осталось.
const backHandlers = []
const onTelegramBack = () => backHandlers[backHandlers.length - 1]?.()

export function setTelegramBackButton(onClick) {
  const telegram = getTelegram()
  if (!telegram?.BackButton || !telegram.isVersionAtLeast?.('6.1')) return () => {}
  if (backHandlers.length === 0) {
    telegram.BackButton.onClick(onTelegramBack)
    telegram.BackButton.show()
  }
  backHandlers.push(onClick)
  return () => {
    const index = backHandlers.lastIndexOf(onClick)
    if (index !== -1) backHandlers.splice(index, 1)
    if (backHandlers.length === 0) {
      telegram.BackButton.offClick(onTelegramBack)
      telegram.BackButton.hide()
    }
  }
}

// Где сейчас пользователь — для сортировки «Сначала ближе».
// Возвращает { latitude, longitude } или null (не разрешил, нет GPS и т.п.).
// Координаты никуда не отправляются: расстояние до магазинов считается на телефоне.
// В Telegram — через его LocationManager (версия 8.0+), иначе — через браузер.
// Если за 30 секунд ответа нет (например, на вопрос о доступе не ответили) — null.
export function getUserLocation() {
  const noAnswer = new Promise((resolve) => setTimeout(() => resolve(null), 30000))
  return Promise.race([askLocation(), noAnswer])
}

function askLocation() {
  const manager = getTelegram()?.isVersionAtLeast?.('8.0') ? getTelegram().LocationManager : null
  if (!manager) return browserLocation()
  return new Promise((resolve) => {
    const ask = () => {
      if (!manager.isLocationAvailable) return browserLocation().then(resolve)
      try {
        manager.getLocation((data) => resolve(data ? { latitude: data.latitude, longitude: data.longitude } : null))
      } catch {
        resolve(null)
      }
    }
    try {
      if (manager.isInited) ask()
      else manager.init(ask)
    } catch {
      browserLocation().then(resolve)
    }
  })
}

function browserLocation() {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { timeout: 15000, maximumAge: 5 * 60 * 1000 },
    )
  })
}

// Открыть внешнюю ссылку (карта, сайт). Telegram требует открывать их через себя.
// Возвращает true, если ссылку открыл Telegram; false — пусть откроет браузер.
export function openExternalLink(url) {
  const telegram = getTelegram()
  if (!telegram?.openLink) return false
  telegram.openLink(url)
  return true
}

// Цвет шапки и фона Telegram под экран (витрина меняет его под категорию).
// null — вернуть фирменный бежевый. В браузере ничего не делает.
export function setScreenColor(color) {
  const telegram = getTelegram()
  if (!telegram) return
  try {
    telegram.setHeaderColor(color ?? BRAND_BACKGROUND)
    telegram.setBackgroundColor(color ?? BRAND_BACKGROUND)
  } catch {
    // Старые версии Telegram не умеют менять цвета — это не страшно.
  }
}

// Настройка Telegram при запуске. В обычном браузере ничего не делает.
export function initPlatform() {
  const telegram = getTelegram()
  if (!telegram) return

  telegram.ready()
  telegram.expand()
  // Чтобы Mini App не закрывался случайно, когда листают страницу вниз.
  if (telegram.isVersionAtLeast?.('7.7')) telegram.disableVerticalSwipes?.()
  try {
    telegram.setHeaderColor(BRAND_BACKGROUND)
    telegram.setBackgroundColor(BRAND_BACKGROUND)
  } catch {
    // Старые версии Telegram не умеют менять цвета — это не страшно.
  }
}
