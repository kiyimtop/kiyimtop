// Сообщения бота @KiyimTopBot на узбекском и русском.
// (Сервер не читает src/locales — поэтому надписи бота здесь. Узбекский — только латиница.)
// Язык — по языку Telegram человека: русский → русский, остальное → узбекский.

const texts = {
  uz: {
    welcome:
      'Assalomu alaykum! KiyimTop — Toshkent do‘konlaridagi kiyimlar katalogi.\n' +
      'Ochish uchun pastdagi «Ochish» tugmasini bosing.',
    loginAsk: (code, site) =>
      `KiyimTop saytiga kirish\nSaytdagi kod: ${code}\n\n` +
      `«Ha, kirish»ni faqat o‘zingiz hozir ${site} saytiga kirayotgan bo‘lsangiz va saytda shu kodni ko‘rsangiz bosing.`,
    loginYes: '✅ Ha, kirish',
    loginNo: 'Bekor qilish',
    loginDone: '✅ Tayyor! Siz KiyimTop saytiga kirdingiz. Brauzerga qayting.',
    loginCancelled: 'Kirish bekor qilindi.',
    loginExpired: 'Kirish havolasi eskirgan. Saytda «Telegram orqali kirish»ni yana bosing.',
  },
  ru: {
    welcome:
      'Здравствуйте! KiyimTop — каталог одежды в магазинах Ташкента.\n' +
      'Чтобы открыть, нажмите кнопку «Ochish» внизу.',
    loginAsk: (code, site) =>
      `Вход на сайт KiyimTop\nКод на сайте: ${code}\n\n` +
      `Нажимайте «Да, войти», только если вы сами сейчас входите на сайт ${site} и видите там этот код.`,
    loginYes: '✅ Да, войти',
    loginNo: 'Отмена',
    loginDone: '✅ Готово! Вы вошли на сайт KiyimTop. Вернитесь в браузер.',
    loginCancelled: 'Вход отменён.',
    loginExpired: 'Ссылка для входа устарела. Нажмите на сайте «Войти через Telegram» ещё раз.',
  },
}

export const botTexts = (languageCode) => (String(languageCode ?? '').startsWith('ru') ? texts.ru : texts.uz)
