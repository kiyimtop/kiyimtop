-- Брони: покупатель бронирует вещь (размер + цвет) в магазине, бронь держится 2 дня.
-- Покупатель — пользователь Telegram (его номер в Telegram проверяет сервер, папка api/).
-- Посетители сайта (anon, authenticated) таблицу не видят совсем: читать и записывать
-- может только сервер с секретным ключом. Так чужие брони никто не увидит.
--
-- Как запустить (один раз): Supabase → SQL Editor → New query → вставить весь файл → Run.

begin;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- Короткий код брони, его покупатель показывает в магазине: первые 6 знаков номера (например A3F9C1).
  code text generated always as (upper(left(id::text, 6))) stored,
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  -- Что забронировали — копия на момент брони (если магазин потом изменит товар, бронь не «поплывёт»).
  product_name_uz text not null,
  product_name_ru text not null,
  size text,
  color_uz text,
  color_ru text,
  price integer not null,
  -- Кто забронировал (из Telegram).
  telegram_user_id bigint not null,
  buyer_name text,
  buyer_username text,
  -- new — новая, confirmed — магазин подтвердил, picked_up — забрали,
  -- cancelled — покупатель отменил, unavailable — магазин ответил «нет в наличии».
  -- Срок вышел (expires_at прошёл, а вещь не забрали) — бронь считается истёкшей сама, без отдельной отметки.
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'picked_up', 'cancelled', 'unavailable')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 days',
  updated_at timestamptz not null default now()
);

create index bookings_user_idx on public.bookings (telegram_user_id, created_at desc);
create index bookings_variant_active_idx on public.bookings (variant_id) where status in ('new', 'confirmed');

-- Правила доступа: включены, но правил для посетителей нет — значит, посетителям ничего не видно.
alter table public.bookings enable row level security;

-- С 30.10.2026 Supabase не открывает новые таблицы сам. Посетителям доступ специально НЕ даём,
-- серверу (секретный ключ) — чтение и запись.
revoke all on public.bookings from anon, authenticated;
grant select, insert, update on public.bookings to service_role;

-- Создать бронь. Вызывает только сервер. Проверяет:
--   товар и магазин видны в каталоге;
--   у покупателя меньше 3 действующих броней;
--   этот покупатель ещё не бронировал этот же вариант;
--   вещь не разобрана: действующих броней на этот вариант меньше, чем штук в наличии.
-- Ошибки (их понимает сайт): not_found, too_many, already_booked, sold_out.
create function public.create_booking(
  p_variant_id uuid,
  p_telegram_user_id bigint,
  p_buyer_name text,
  p_buyer_username text
) returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v record;
  result public.bookings;
begin
  -- Блокируем строку варианта, чтобы две брони одновременно не взяли последнюю штуку.
  select pv.id, pv.quantity, pv.size, pv.color_uz, pv.color_ru,
         p.id as product_id, p.name_uz, p.name_ru, p.price, p.shop_id
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id and p.is_active
    join public.shops s on s.id = p.shop_id and s.is_active
   where pv.id = p_variant_id
     for update of pv;
  if not found then
    raise exception 'not_found';
  end if;

  if (select count(*) from public.bookings b
       where b.telegram_user_id = p_telegram_user_id
         and b.status in ('new', 'confirmed') and b.expires_at > now()) >= 3 then
    raise exception 'too_many';
  end if;

  if exists (select 1 from public.bookings b
              where b.variant_id = p_variant_id and b.telegram_user_id = p_telegram_user_id
                and b.status in ('new', 'confirmed') and b.expires_at > now()) then
    raise exception 'already_booked';
  end if;

  if (select count(*) from public.bookings b
       where b.variant_id = p_variant_id
         and b.status in ('new', 'confirmed') and b.expires_at > now()) >= v.quantity then
    raise exception 'sold_out';
  end if;

  insert into public.bookings
    (shop_id, product_id, variant_id, product_name_uz, product_name_ru, size, color_uz, color_ru, price,
     telegram_user_id, buyer_name, buyer_username)
  values
    (v.shop_id, v.product_id, v.id, v.name_uz, v.name_ru, v.size, v.color_uz, v.color_ru, v.price,
     p_telegram_user_id, left(p_buyer_name, 200), left(p_buyer_username, 64))
  returning * into result;
  return result;
end;
$$;

-- Функцию может вызывать только сервер (по умолчанию в PostgreSQL её может вызвать любой).
revoke execute on function public.create_booking(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, bigint, text, text) to service_role;

commit;
