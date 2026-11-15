// Сообщения бота @KiyimTopBot на узбекском и русском.
// (Сервер не читает src/locales — поэтому надписи бота здесь. Узбекский — только латиница.)
// Язык — по языку Telegram человека: русский → русский, остальное → узбекский.

// Строки брони для сообщений: «• Худи — Чёрный · XL × 2 — 600 000 so‘m».
const money = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const lineName = (b, lang) => (lang === 'ru' ? b.product_name_ru ?? b.product_name_uz : b.product_name_uz ?? b.product_name_ru) ?? ''
const lineDetails = (b, lang) => [lang === 'ru' ? b.color_ru : b.color_uz, b.size].filter(Boolean).join(' · ')
const linesText = (lines, lang, { prices = true } = {}) =>
  lines
    .map((b) => {
      const qty = b.qty ?? 1
      const details = lineDetails(b, lang)
      const price = prices ? ` — ${money((b.price ?? 0) * qty)} ${lang === 'ru' ? 'сум' : 'so‘m'}` : ''
      return `• ${lineName(b, lang)}${details ? ` — ${details}` : ''}${qty > 1 ? ` × ${qty}` : ''}${price}`
    })
    .join('\n')
const totalOf = (lines) => lines.reduce((sum, b) => sum + (b.price ?? 0) * (b.qty ?? 1), 0)
const buyerLine = (b) => [b.buyer_name, b.buyer_phone, b.buyer_username ? '@' + b.buyer_username : null].filter(Boolean).join(' · ')
// Короткое название строки для кнопки «❌ Нет: …» (Telegram показывает кнопку в одну строку).
export const shortLine = (b, lang) => {
  const text = [lineName(b, lang), b.size].filter(Boolean).join(' ')
  return text.length > 28 ? `${text.slice(0, 27)}…` : text
}

const texts = {
  uz: {
    lang: 'uz',
    welcome:
      'Assalomu alaykum! KiyimTop — Toshkent do‘konlaridagi kiyimlar katalogi.\n' +
      'Kerakli kiyimni toping, qaysi do‘konda borligini ko‘ring va bron qiling.\n' +
      'Ochish uchun «Ochish» tugmasini bosing 👇',
    open: '🛍 Ochish',
    bookings: 'Bronlaringizni ko‘rish uchun tugmani bosing 👇',
    commandStart: 'KiyimTop’ni ochish',
    commandBookings: 'Mening bronlarim',
    commandShop: 'Do‘kon egalari uchun',
    commandAccount: 'Mening akkauntim',
    accountOpen: '👤 Akkaunt',
    accountIntro: 'Akkauntingiz: profil, bronlar va Telegram 👇',
    linkAsk: (email) =>
      `Bu Telegramni KiyimTop akkauntiga ulaysizmi?\nAkkaunt: ${email || '—'}\n\n` +
      'Ulangandan keyin bron va do‘kon xabarlari shu yerga keladi, KiyimTop esa Telegramda o‘zi ochiladi.',
    linkYes: '✅ Ha, ulash',
    linkNo: 'Bekor qilish',
    linkDone: (email) => `✅ Tayyor! Telegram ${email || 'akkauntingiz'} akkauntiga ulandi. Saytga qaytishingiz mumkin.`,
    linkCancelled: 'Ulash bekor qilindi.',
    linkExpired: 'Havola eskirgan. Saytda profil sahifasida «Telegramni ulash»ni yana bosing.',
    // --- Magazin va admin ---
    shopOpen: '🏪 Do‘kon kabineti',
    shopIntro: 'Do‘koningizni KiyimTop’ga qo‘shing yoki tovarlar va bronlarni boshqaring 👇',
    adminOpen: '⚙️ Admin panel',
    adminIntro: 'Admin panel 👇',
    newOrder: (lines) =>
      `🛍 Yangi bron! Kod: ${lines[0].code}\n\n${linesText(lines, 'uz')}\n\n` +
      `Jami: ${money(totalOf(lines))} so‘m\nXaridor: ${buyerLine(lines[0])}`,
    shopCancelled: (lines) => `🚫 Xaridor bronni bekor qildi (kod ${lines[0].code}):\n${linesText(lines, 'uz', { prices: false })}`,
    statusLine: { confirmed: '✅ Tasdiqlandi', unavailable: '❌ Mavjud emas', picked_up: '📦 Olib ketildi', cancelled: '🚫 Xaridor bekor qildi', expired: '⌛ Muddati tugadi' },
    btnConfirm: '✅ Tasdiqlash',
    btnUnavailable: '❌ Mavjud emas',
    btnPickedUp: '📦 Olib ketildi',
    btnConfirmAll: '✅ Hammasini tasdiqlash',
    btnPickedUpAll: '📦 Berildi',
    btnLineUnavailable: (name) => `❌ Yo‘q: ${name}`,
    buyerUpdate: (lines, status, othersOpen) =>
      ({
        confirmed: `✅ «${lines[0].shop?.name}» do‘koni broningizni tasdiqladi (kod ${lines[0].code}):\n${linesText(lines, 'uz', { prices: false })}`,
        unavailable:
          `😔 «${lines[0].shop?.name}» do‘konida qolmagan ekan:\n${linesText(lines, 'uz', { prices: false })}\n` +
          (othersOpen ? 'Brondagi qolgan narsalar kuchda.' : 'Boshqa do‘konni tanlang.'),
        picked_up: `📦 Xaridingiz bilan! «${lines[0].shop?.name}»:\n${linesText(lines, 'uz', { prices: false })}`,
      })[status],
    application: (shop, from) =>
      `🆕 Yangi do‘kon arizasi\n${shop.name}\n${shop.address_uz ?? ''}\nTel: ${shop.phone ?? ''}\n` +
      `Kimdan: ${from.name ?? ''}${from.email ? ' · ' + from.email : ''}${from.telegram_username ? ' · @' + from.telegram_username : ''}`,
    btnApprove: '✅ Ruxsat berish',
    btnReject: '❌ Rad etish',
    approved: (name) => `🎉 «${name}» do‘koni tasdiqlandi! Endi kabinetda tovarlarni qo‘shishingiz mumkin.`,
    rejected: (name) => `«${name}» do‘koni arizasi rad etildi. Savollar bo‘lsa, administratorga yozing.`,
    notAllowed: 'Bu amal uchun ruxsat yo‘q.',
  },
  ru: {
    lang: 'ru',
    welcome:
      'Здравствуйте! KiyimTop — каталог одежды в магазинах Ташкента.\n' +
      'Найдите нужную вещь, посмотрите, в каком магазине она есть, и забронируйте.\n' +
      'Чтобы открыть, нажмите «Ochish» 👇',
    open: '🛍 Ochish',
    bookings: 'Чтобы посмотреть свои брони, нажмите кнопку 👇',
    commandStart: 'Открыть KiyimTop',
    commandBookings: 'Мои брони',
    commandShop: 'Для магазинов',
    commandAccount: 'Мой аккаунт',
    accountOpen: '👤 Аккаунт',
    accountIntro: 'Ваш аккаунт: профиль, брони и Telegram 👇',
    linkAsk: (email) =>
      `Привязать этот Telegram к аккаунту KiyimTop?\nАккаунт: ${email || '—'}\n\n` +
      'После привязки сюда будут приходить сообщения о бронях и магазине, а в Telegram KiyimTop будет открываться без входа.',
    linkYes: '✅ Да, привязать',
    linkNo: 'Отмена',
    linkDone: (email) => `✅ Готово! Telegram привязан к аккаунту ${email || ''}. Можно вернуться на сайт.`,
    linkCancelled: 'Привязка отменена.',
    linkExpired: 'Ссылка устарела. На сайте в профиле нажмите «Привязать Telegram» ещё раз.',
    // --- Магазин и админ ---
    shopOpen: '🏪 Кабинет магазина',
    shopIntro: 'Добавьте свой магазин в KiyimTop или управляйте товарами и бронями 👇',
    adminOpen: '⚙️ Админка',
    adminIntro: 'Админка 👇',
    newOrder: (lines) =>
      `🛍 Новая бронь! Код: ${lines[0].code}\n\n${linesText(lines, 'ru')}\n\n` +
      `Итого: ${money(totalOf(lines))} сум\nПокупатель: ${buyerLine(lines[0])}`,
    shopCancelled: (lines) => `🚫 Покупатель отменил бронь (код ${lines[0].code}):\n${linesText(lines, 'ru', { prices: false })}`,
    statusLine: { confirmed: '✅ Подтверждено', unavailable: '❌ Нет в наличии', picked_up: '📦 Выдано', cancelled: '🚫 Покупатель отменил', expired: '⌛ Срок истёк' },
    btnConfirm: '✅ Подтвердить',
    btnUnavailable: '❌ Нет в наличии',
    btnPickedUp: '📦 Выдан',
    btnConfirmAll: '✅ Подтвердить всё',
    btnPickedUpAll: '📦 Выдано',
    btnLineUnavailable: (name) => `❌ Нет: ${name}`,
    buyerUpdate: (lines, status, othersOpen) =>
      ({
        confirmed: `✅ Магазин «${lines[0].shop?.name}» подтвердил бронь (код ${lines[0].code}):\n${linesText(lines, 'ru', { prices: false })}`,
        unavailable:
          `😔 В магазине «${lines[0].shop?.name}» не оказалось:\n${linesText(lines, 'ru', { prices: false })}\n` +
          (othersOpen ? 'Остальное в брони в силе.' : 'Выберите другой магазин.'),
        picked_up: `📦 С покупкой! Магазин «${lines[0].shop?.name}»:\n${linesText(lines, 'ru', { prices: false })}`,
      })[status],
    application: (shop, from) =>
      `🆕 Новая заявка магазина\n${shop.name}\n${shop.address_ru ?? shop.address_uz ?? ''}\nТел: ${shop.phone ?? ''}\n` +
      `От: ${from.name ?? ''}${from.email ? ' · ' + from.email : ''}${from.telegram_username ? ' · @' + from.telegram_username : ''}`,
    btnApprove: '✅ Разрешить',
    btnReject: '❌ Отклонить',
    approved: (name) => `🎉 Магазин «${name}» одобрен! Теперь в кабинете можно добавлять товары.`,
    rejected: (name) => `Заявка магазина «${name}» отклонена. Если есть вопросы — напишите администратору.`,
    notAllowed: 'Нет прав на это действие.',
  },
}

export const botTexts = (languageCode) => (String(languageCode ?? '').startsWith('ru') ? texts.ru : texts.uz)
