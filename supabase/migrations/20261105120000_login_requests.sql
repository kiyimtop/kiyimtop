-- Вход на сайте через бота: сайт создаёт одноразовую ссылку t.me/KiyimTopBot?start=login_<token>,
-- человек нажимает в боте «Start» и «Да, войти», бот отмечает запрос подтверждённым,
-- а сайт забирает вход. Ссылка живёт 10 минут и срабатывает один раз.
-- Посетители сайта (anon, authenticated) таблицу не видят совсем — только сервер (папка api/).
--
-- Как запустить (один раз): Supabase → SQL Editor → New query → вставить весь файл → Run.

begin;

create table public.login_requests (
  token text primary key,                    -- случайная часть ссылки (её знает только браузер, который входит)
  code text not null,                        -- 4 цифры: показываются на сайте и в боте, чтобы сверить
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  -- Кто подтвердил вход в боте (из Telegram).
  telegram_user_id bigint,
  first_name text,
  last_name text,
  username text,
  confirmed_at timestamptz,                  -- нажал «Да, войти»
  cancelled_at timestamptz,                  -- нажал «Отмена»
  used_at timestamptz                        -- сайт уже забрал вход (второй раз ссылка не сработает)
);

create index login_requests_expires_idx on public.login_requests (expires_at);

-- Правила доступа: включены, правил для посетителей нет — посетителям ничего не видно.
alter table public.login_requests enable row level security;

-- С 30.10.2026 Supabase не открывает новые таблицы сам. Посетителям доступ специально НЕ даём,
-- серверу (секретный ключ) — всё.
revoke all on public.login_requests from anon, authenticated;
grant select, insert, update, delete on public.login_requests to service_role;

commit;
