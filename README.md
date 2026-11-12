# KiyimTop

Каталог одежды Ташкента: сайт, Telegram Mini App (@KiyimTopBot) и приложение на телефон (PWA) из одного кода.
Покупатель находит вещь, видит, в каких магазинах она есть и почём, и бронирует её. Магазины платят подписку.

Описание проекта и правила — в [CLAUDE.md](CLAUDE.md).
**ИИ-помощникам (Claude и другим): сначала прочитать [START_HERE_FOR_AI.md](START_HERE_FOR_AI.md).**

## Из чего состоит

| Папка / файл | Что это |
|---|---|
| `src/` | Сайт (React + Vite): страницы, компоненты, переводы `src/locales/uz.json` и `ru.json` |
| `server/` | Сервер (Cloudflare Workers) — только Telegram-бот и фото товаров |
| `public/` | Картинки, иконки, файлы для установки на телефон (PWA) |
| `firebase/firestore.rules` | Правила доступа к базе Firebase |
| `wrangler.jsonc` | Настройки Cloudflare |

## Где работает

- Сайт и сервер — **Cloudflare Workers** (`kiyimtop.kiyimtop.workers.dev`), собирается сам после каждого изменения на GitHub.
- База и вход (Google / email) — **Firebase**. Как в TheStarth: сайт сам работает с базой, доступ решают
  правила `firebase/firestore.rules` (брони, кабинет магазина, админ-панель, роли, аналитика).
- Настройки Cloudflare: при сборке (Build variables) — `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`;
  секреты (Variables and Secrets, необязательные — для бота и фото) — `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_STORAGE_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT`.
- Первый админ: зарегистрироваться на сайте → Firebase → Firestore → `users` → свой документ → `role` = `admin`.

## Запуск на своём компьютере

```bash
npm install
cp .env.example .env   # и вписать настройки Firebase
npm run dev
```
