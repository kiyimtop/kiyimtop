// Сообщения бота @KiyimTopBot на узбекском и русском.
// (Сервер не читает src/locales — поэтому надписи бота здесь. Узбекский — только латиница.)
// Язык — по языку Telegram человека: русский → русский, остальное → узбекский.

const texts = {
  uz: {
    welcome:
      'Assalomu alaykum! KiyimTop — Toshkent do‘konlaridagi kiyimlar katalogi.\n' +
      'Kerakli kiyimni toping, qaysi do‘konda borligini ko‘ring va bron qiling.\n' +
      'Ochish uchun «Ochish» tugmasini bosing 👇',
    open: '🛍 Ochish',
    bookings: 'Bronlaringizni ko‘rish uchun tugmani bosing 👇',
    commandStart: 'KiyimTop’ni ochish',
    commandBookings: 'Mening bronlarim',
    commandShop: 'Do‘kon egalari uchun',
    loginAsk: (code, site) =>
      `KiyimTop saytiga kirish\nSaytdagi kod: ${code}\n\n` +
      `«Ha, kirish»ni faqat o‘zingiz hozir ${site} saytiga kirayotgan bo‘lsangiz va saytda shu kodni ko‘rsangiz bosing.`,
    loginYes: '✅ Ha, kirish',
    loginNo: 'Bekor qilish',
    loginDone: '✅ Tayyor! Siz KiyimTop saytiga kirdingiz. Brauzerga qayting.',
    loginCancelled: 'Kirish bekor qilindi.',
    loginExpired: 'Kirish havolasi eskirgan. Saytda «Telegram orqali kirish»ni yana bosing.',
    // --- Magazin va admin ---
    shopOpen: '🏪 Do‘kon kabineti',
    shopIntro: 'Do‘koningizni KiyimTop’ga qo‘shing yoki tovarlar va bronlarni boshqaring 👇',
    adminOpen: '⚙️ Admin panel',
    adminIntro: 'Admin panel 👇',
    newBooking: (b) =>
      `🛍 Yangi bron!\n${b.product_name_uz ?? b.product_name_ru}\n` +
      `${[b.color_uz, b.size].filter(Boolean).join(' · ')}\nNarxi: ${b.price} so‘m\n` +
      `Xaridor: ${b.buyer_name ?? ''}${b.buyer_username ? ' @' + b.buyer_username : ''}\nBron kodi: ${b.code}`,
    statusLine: { confirmed: '✅ Tasdiqlandi', unavailable: '❌ Mavjud emas', picked_up: '📦 Olib ketildi', cancelled: '🚫 Xaridor bekor qildi', expired: '⌛ Muddati tugadi' },
    btnConfirm: '✅ Tasdiqlash',
    btnUnavailable: '❌ Mavjud emas',
    btnPickedUp: '📦 Olib ketildi',
    buyerStatus: (b, status) =>
      ({
        confirmed: `✅ «${b.shop?.name}» do‘koni broningizni tasdiqladi: ${b.product_name_uz ?? b.product_name_ru}. Bron kodi: ${b.code}`,
        unavailable: `😔 «${b.shop?.name}» do‘konida bu narsa qolmagan ekan: ${b.product_name_uz ?? b.product_name_ru}. Boshqa do‘konni tanlang.`,
        picked_up: `📦 Xaridingiz bilan! ${b.product_name_uz ?? b.product_name_ru}`,
      })[status],
    application: (shop, from) =>
      `🆕 Yangi do‘kon arizasi\n${shop.name}\n${shop.address_uz ?? ''}\nTel: ${shop.phone ?? ''}\n` +
      `Kimdan: ${from.name ?? ''}${from.username ? ' @' + from.username : ''} (id ${from.id})`,
    btnApprove: '✅ Ruxsat berish',
    btnReject: '❌ Rad etish',
    approved: (name) => `🎉 «${name}» do‘koni tasdiqlandi! Endi kabinetda tovarlarni qo‘shishingiz mumkin.`,
    rejected: (name) => `«${name}» do‘koni arizasi rad etildi. Savollar bo‘lsa, administratorga yozing.`,
    notAllowed: 'Bu amal uchun ruxsat yo‘q.',
  },
  ru: {
    welcome:
      'Здравствуйте! KiyimTop — каталог одежды в магазинах Ташкента.\n' +
      'Найдите нужную вещь, посмотрите, в каком магазине она есть, и забронируйте.\n' +
      'Чтобы открыть, нажмите «Ochish» 👇',
    open: '🛍 Ochish',
    bookings: 'Чтобы посмотреть свои брони, нажмите кнопку 👇',
    commandStart: 'Открыть KiyimTop',
    commandBookings: 'Мои брони',
    commandShop: 'Для магазинов',
    loginAsk: (code, site) =>
      `Вход на сайт KiyimTop\nКод на сайте: ${code}\n\n` +
      `Нажимайте «Да, войти», только если вы сами сейчас входите на сайт ${site} и видите там этот код.`,
    loginYes: '✅ Да, войти',
    loginNo: 'Отмена',
    loginDone: '✅ Готово! Вы вошли на сайт KiyimTop. Вернитесь в браузер.',
    loginCancelled: 'Вход отменён.',
    loginExpired: 'Ссылка для входа устарела. Нажмите на сайте «Войти через Telegram» ещё раз.',
    // --- Магазин и админ ---
    shopOpen: '🏪 Кабинет магазина',
    shopIntro: 'Добавьте свой магазин в KiyimTop или управляйте товарами и бронями 👇',
    adminOpen: '⚙️ Админка',
    adminIntro: 'Админка 👇',
    newBooking: (b) =>
      `🛍 Новая бронь!\n${b.product_name_ru ?? b.product_name_uz}\n` +
      `${[b.color_ru, b.size].filter(Boolean).join(' · ')}\nЦена: ${b.price} сум\n` +
      `Покупатель: ${b.buyer_name ?? ''}${b.buyer_username ? ' @' + b.buyer_username : ''}\nКод брони: ${b.code}`,
    statusLine: { confirmed: '✅ Подтверждено', unavailable: '❌ Нет в наличии', picked_up: '📦 Выдано', cancelled: '🚫 Покупатель отменил', expired: '⌛ Срок истёк' },
    btnConfirm: '✅ Подтвердить',
    btnUnavailable: '❌ Нет в наличии',
    btnPickedUp: '📦 Выдан',
    buyerStatus: (b, status) =>
      ({
        confirmed: `✅ Магазин «${b.shop?.name}» подтвердил бронь: ${b.product_name_ru ?? b.product_name_uz}. Код брони: ${b.code}`,
        unavailable: `😔 В магазине «${b.shop?.name}» этой вещи не оказалось: ${b.product_name_ru ?? b.product_name_uz}. Выберите другой магазин.`,
        picked_up: `📦 С покупкой! ${b.product_name_ru ?? b.product_name_uz}`,
      })[status],
    application: (shop, from) =>
      `🆕 Новая заявка магазина\n${shop.name}\n${shop.address_ru ?? shop.address_uz ?? ''}\nТел: ${shop.phone ?? ''}\n` +
      `От: ${from.name ?? ''}${from.username ? ' @' + from.username : ''} (id ${from.id})`,
    btnApprove: '✅ Разрешить',
    btnReject: '❌ Отклонить',
    approved: (name) => `🎉 Магазин «${name}» одобрен! Теперь в кабинете можно добавлять товары.`,
    rejected: (name) => `Заявка магазина «${name}» отклонена. Если есть вопросы — напишите администратору.`,
    notAllowed: 'Нет прав на это действие.',
  },
}

export const botTexts = (languageCode) => (String(languageCode ?? '').startsWith('ru') ? texts.ru : texts.uz)
