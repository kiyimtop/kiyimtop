-- KiyimTop: каталог — категории, магазины, товары и их варианты (размер, цвет, наличие).
--
-- Как запустить (один раз): Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Всё выполняется целиком или не выполняется совсем (begin … commit).

begin;

-- 1. Категории: футболки, куртки, кроссовки и т.д.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- короткое имя для адреса страницы, например tshirts
  name_uz text not null,
  name_ru text not null,
  emoji text,                                -- значок категории, например 👕
  sort_order integer not null default 0,     -- порядок в списке: меньше — выше
  created_at timestamptz not null default now()
);

-- 2. Магазины.
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,                        -- название магазина (не переводится)
  description_uz text,
  description_ru text,
  address_uz text,
  address_ru text,
  landmark_uz text,                          -- ориентир, например «Chilonzor metrosi yonida»
  landmark_ru text,
  latitude double precision,                 -- место на карте
  longitude double precision,
  phone text,
  telegram_username text,
  logo_url text,
  opens_at time,                             -- часы работы
  closes_at time,
  owner_id uuid references auth.users (id) on delete set null,  -- аккаунт владельца (кабинет магазина — позже)
  is_active boolean not null default false,  -- в каталоге видны только активные магазины (подписка оплачена)
  created_at timestamptz not null default now()
);

-- 3. Товары.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  name_uz text not null,
  name_ru text not null,
  description_uz text,
  description_ru text,
  brand text,
  gender text not null default 'unisex'
    check (gender in ('men', 'women', 'kids', 'unisex')),  -- для кого: мужчины, женщины, дети, все
  price integer not null check (price >= 0), -- цена в сумах
  photo_urls text[] not null default '{}',   -- ссылки на фото
  is_active boolean not null default true,   -- магазин может скрыть товар, не удаляя его
  created_at timestamptz not null default now()
);

-- 4. Варианты товара: размер, цвет и сколько штук в наличии.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  size text,                                 -- S, M, L, 42 …
  color_uz text,
  color_ru text,
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now()
);

-- Ускоряют поиск товаров по магазину и категории.
create index products_shop_id_idx on public.products (shop_id);
create index products_category_id_idx on public.products (category_id);
create index product_variants_product_id_idx on public.product_variants (product_id);

-- Правила доступа (RLS). Без правила доступа к таблице нет ни у кого, кроме сервера.
alter table public.categories enable row level security;
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;

-- Посетители (anon — без входа, authenticated — вошедшие) могут только смотреть.
create policy "categories: public read"
  on public.categories for select to anon, authenticated
  using (true);

create policy "shops: public read active"
  on public.shops for select to anon, authenticated
  using (is_active);

create policy "products: public read active"
  on public.products for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.shops s where s.id = shop_id and s.is_active)
  );

create policy "variants: public read visible"
  on public.product_variants for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.shops s on s.id = p.shop_id
      where p.id = product_id and p.is_active and s.is_active
    )
  );

-- С 30.10.2026 Supabase не открывает новые таблицы для сайта сам — даём доступ явно.
-- Посетителям — только чтение (что именно видно, решают правила выше).
grant select on public.categories, public.shops, public.products, public.product_variants
  to anon, authenticated;
-- Серверу (секретный ключ) — всё: понадобится для кабинета магазина и админки.
grant select, insert, update, delete
  on public.categories, public.shops, public.products, public.product_variants
  to service_role;

-- Стартовый список категорий.
insert into public.categories (slug, name_uz, name_ru, emoji, sort_order) values
  ('tshirts',     'Futbolkalar',             'Футболки',          '👕', 10),
  ('shirts',      'Ko‘ylaklar va bluzkalar', 'Рубашки и блузки',  '👔', 20),
  ('hoodies',     'Xudi va sviterlar',       'Худи и свитеры',    '🧶', 30),
  ('jackets',     'Kurtka va paltolar',      'Куртки и пальто',   '🧥', 40),
  ('suits',       'Kostyumlar',              'Костюмы',           '🤵', 50),
  ('trousers',    'Shimlar va jinsilar',     'Брюки и джинсы',    '👖', 60),
  ('dresses',     'Platya va yubkalar',      'Платья и юбки',     '👗', 70),
  ('shorts',      'Shortilar',               'Шорты',             '🩳', 80),
  ('sneakers',    'Krossovkalar',            'Кроссовки',         '👟', 90),
  ('shoes',       'Tufli va botinkalar',     'Туфли и ботинки',   '👞', 100),
  ('accessories', 'Aksessuarlar',            'Аксессуары',        '👜', 110);

commit;
