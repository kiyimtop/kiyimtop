-- KiyimTop: ТЕСТОВЫЕ магазины и товары — чтобы проверять экраны каталога и витрину.
-- 8 выдуманных магазинов (в названии «(demo)», телефоны несуществующие: +998 00 …),
-- в каждой категории товары в 5 магазинах из 8 (по 2 вида), у каждого товара 3 цвета и полный набор размеров.
-- У магазинов — районы Ташкента, у товаров — выдуманные бренды (для фильтров).
-- Нужен запущенный файл supabase/migrations/20261103120000_shop_district.sql (поле «район»).
-- Перед запуском для покупателей удалить файлом remove_demo_data.sql из этой же папки.
--
-- Как запустить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Файл можно запускать повторно: сначала он удаляет прошлые тестовые данные.
-- У всех тестовых магазинов номер (id) начинается с d0000000 — так их легко найти и удалить.

begin;

-- 0. Убираем прошлые тестовые данные (товары и размеры удалятся вместе с магазинами).
delete from public.shops where id::text like 'd0000000-0000-4000-8000-%';

-- 1. Магазины
insert into public.shops
  (id, name, description_uz, description_ru, address_uz, address_ru, landmark_uz, landmark_ru,
   latitude, longitude, phone, opens_at, closes_at, is_active, district)
values
  ('d0000000-0000-4000-8000-000000000001', 'Chilonzor Style (demo)',
   'Har kuni uchun qulay kiyimlar.', 'Удобная одежда на каждый день.',
   'Chilonzor tumani, 9-kvartal', 'Чиланзарский район, 9-й квартал',
   'Chilonzor metrosi yonida', 'Рядом с метро Чиланзар', 41.2756, 69.2040, '+998 00 000 00 01', '10:00', '21:00', true, 'chilonzor'),
  ('d0000000-0000-4000-8000-000000000002', 'Yunusobod Sport (demo)',
   'Sport kiyimlari va krossovkalar.', 'Спортивная одежда и кроссовки.',
   'Yunusobod tumani, 4-kvartal', 'Юнусабадский район, 4-й квартал',
   'Minor metrosi yonida', 'Рядом с метро Минор', 41.3352, 69.2843, '+998 00 000 00 02', '09:00', '20:00', true, 'yunusobod'),
  ('d0000000-0000-4000-8000-000000000003', 'Mirobod Classic (demo)',
   'Klassik kostyumlar, ko‘ylaklar va tufli.', 'Классические костюмы, рубашки и туфли.',
   'Mirobod tumani, Amir Temur ko‘chasi', 'Мирабадский район, улица Амира Темура',
   'Oybek metrosi yonida', 'Рядом с метро Ойбек', 41.2995, 69.2797, '+998 00 000 00 03', '10:00', '20:00', true, 'mirobod'),
  ('d0000000-0000-4000-8000-000000000004', 'Sergeli Moda (demo)',
   'Butun oila uchun arzon kiyimlar.', 'Недорогая одежда для всей семьи.',
   'Sergeli tumani', 'Сергелийский район',
   'Sergeli metrosi yonida', 'Рядом с метро Сергели', 41.2280, 69.2190, '+998 00 000 00 04', '09:00', '21:00', true, 'sergeli'),
  ('d0000000-0000-4000-8000-000000000005', 'Yakkasaroy Market (demo)',
   'Zamonaviy kiyimlar va aksessuarlar.', 'Современная одежда и аксессуары.',
   'Yakkasaroy tumani', 'Яккасарайский район',
   'Bobur bog‘i yonida', 'Рядом с парком Бабура', 41.2870, 69.2560, '+998 00 000 00 05', '10:00', '22:00', true, 'yakkasaroy'),
  ('d0000000-0000-4000-8000-000000000006', 'Mirzo Ulug‘bek Wear (demo)',
   'Ko‘cha uslubidagi kiyimlar.', 'Одежда в уличном стиле.',
   'Mirzo Ulug‘bek tumani', 'Мирзо-Улугбекский район',
   'Buyuk Ipak Yo‘li metrosi yonida', 'Рядом с метро Буюк Ипак Йули', 41.3260, 69.3290, '+998 00 000 00 06', '10:00', '21:00', true, 'mirzo-ulugbek'),
  ('d0000000-0000-4000-8000-000000000007', 'Shayxontohur Urban (demo)',
   'Yoshlar uchun kiyimlar.', 'Одежда для молодёжи.',
   'Shayxontohur tumani', 'Шайхантахурский район',
   'Chorsu bozori yonida', 'Рядом с базаром Чорсу', 41.3260, 69.2340, '+998 00 000 00 07', '08:00', '19:00', true, 'shayxontohur'),
  ('d0000000-0000-4000-8000-000000000008', 'Olmazor Family (demo)',
   'Kattalar va bolalar uchun kiyimlar.', 'Одежда для взрослых и детей.',
   'Olmazor tumani', 'Алмазарский район',
   'Olmazor metrosi yonida', 'Рядом с метро Алмазар', 41.3480, 69.2140, '+998 00 000 00 08', '09:00', '20:00', true, 'olmazor');

-- 2. Шаблоны товаров: по 2 вида на категорию (временные таблицы — исчезнут после запуска).
create temp table demo_items (
  slug text, k int, name_uz text, name_ru text, description_uz text, description_ru text, gender text, base_price int
) on commit drop;

insert into demo_items values
  ('tshirts', 0, 'Oddiy paxta futbolka', 'Базовая хлопковая футболка', '100% paxta, erkin bichim.', '100% хлопок, свободный крой.', 'unisex', 89000),
  ('tshirts', 1, 'Oversize futbolka', 'Футболка оверсайз', 'Keng bichim, qalin paxta.', 'Широкий крой, плотный хлопок.', 'unisex', 129000),
  ('shirts', 0, 'Oq klassik ko‘ylak', 'Белая классическая рубашка', 'Paxta, dazmollash oson.', 'Хлопок, легко гладить.', 'men', 199000),
  ('shirts', 1, 'Ayollar bluzkasi', 'Женская блузка', 'Yengil va nafis mato.', 'Лёгкая струящаяся ткань.', 'women', 179000),
  ('hoodies', 0, 'Kapyushonli xudi', 'Худи с капюшоном', 'Issiq, ichi yumshoq.', 'Тёплое, мягкое внутри.', 'unisex', 249000),
  ('hoodies', 1, 'Jun sviter', 'Шерстяной свитер', 'Jun aralash, qish uchun.', 'С шерстью, для зимы.', 'unisex', 299000),
  ('jackets', 0, 'Kuzgi kurtka', 'Осенняя куртка', 'Yengil, shamoldan himoya qiladi.', 'Лёгкая, защищает от ветра.', 'women', 459000),
  ('jackets', 1, 'Qishki palto', 'Зимнее пальто', 'Issiq jun palto.', 'Тёплое шерстяное пальто.', 'men', 990000),
  ('suits', 0, 'Klassik erkaklar kostyumi', 'Классический мужской костюм', 'Pidjak va shim.', 'Пиджак и брюки.', 'men', 1490000),
  ('suits', 1, 'Ayollar kostyumi', 'Женский костюм', 'Pidjak va shim, nafis bichim.', 'Пиджак и брюки, приталенный крой.', 'women', 1190000),
  ('trousers', 0, 'Klassik jinsi shim', 'Классические джинсы', 'To‘g‘ri bichim, mustahkam mato.', 'Прямой крой, плотная ткань.', 'men', 299000),
  ('trousers', 1, 'Klassik shim', 'Классические брюки', 'Ofis uchun qulay.', 'Удобные для офиса.', 'women', 259000),
  ('dresses', 0, 'Yozgi ko‘ylak', 'Летнее платье', 'Yengil mato, issiq kunlar uchun.', 'Лёгкая ткань, для жарких дней.', 'women', 219000),
  ('dresses', 1, 'Plisse yubka', 'Юбка плиссе', 'Midi uzunlikda.', 'Длина миди.', 'women', 189000),
  ('shorts', 0, 'Sport shortisi', 'Спортивные шорты', 'Tez quriydigan mato.', 'Быстросохнущая ткань.', 'men', 129000),
  ('shorts', 1, 'Bolalar shortisi', 'Детские шорты', 'Yumshoq paxta, o‘yin uchun qulay.', 'Мягкий хлопок, удобно играть.', 'kids', 99000),
  ('sneakers', 0, 'Yugurish uchun krossovka', 'Беговые кроссовки', 'Yengil va yumshoq taglik.', 'Лёгкие, с мягкой подошвой.', 'unisex', 549000),
  ('sneakers', 1, 'Baland krossovka', 'Высокие кроссовки', 'Ko‘cha uslubi, qalin taglik.', 'Уличный стиль, толстая подошва.', 'unisex', 459000),
  ('shoes', 0, 'Charm tufli', 'Кожаные туфли', 'Tabiiy charm.', 'Натуральная кожа.', 'men', 690000),
  ('shoes', 1, 'Mokasinlar', 'Мокасины', 'Yumshoq, kun bo‘yi qulay.', 'Мягкие, удобные весь день.', 'men', 389000),
  ('accessories', 0, 'Beysbolka', 'Бейсболка', 'O‘lchami sozlanadi.', 'Регулируемый размер.', 'unisex', 79000),
  ('accessories', 1, 'Charm kamar', 'Кожаный ремень', 'Tabiiy charm, metall to‘qa.', 'Натуральная кожа, металлическая пряжка.', 'men', 119000);

create temp table demo_sizes (slug text, sizes text[]) on commit drop;
insert into demo_sizes values
  ('tshirts', array['XS','S','M','L','XL','XXL']),
  ('shirts', array['XS','S','M','L','XL','XXL']),
  ('hoodies', array['S','M','L','XL','XXL']),
  ('jackets', array['XS','S','M','L','XL','XXL']),
  ('suits', array['44','46','48','50','52','54']),
  ('trousers', array['28','30','32','34','36','38']),
  ('dresses', array['XS','S','M','L','XL']),
  ('shorts', array['S','M','L','XL','XXL']),
  ('sneakers', array['38','39','40','41','42','43','44','45']),
  ('shoes', array['39','40','41','42','43','44','45']),
  ('accessories', array['S/M','L/XL']);

create temp table demo_colors (n int, color_uz text, color_ru text) on commit drop;
insert into demo_colors values
  (0, 'Oq', 'Белый'), (1, 'Qora', 'Чёрный'), (2, 'Kulrang', 'Серый'), (3, 'Ko‘k', 'Синий'),
  (4, 'Bej', 'Бежевый'), (5, 'Yashil', 'Зелёный'), (6, 'Qizil', 'Красный'),
  (7, 'Jigarrang', 'Коричневый'), (8, 'Pushti', 'Розовый'), (9, 'To‘q ko‘k', 'Тёмно-синий');

-- 3. Какой магазин что продаёт: в каждой категории — 5 магазинов из 8, в каждом оба вида товара.
create temp table demo_products on commit drop as
select
  row_number() over (order by s.n, c.sort_order, i.k) as n,
  s.id as shop_id, s.n as shop_n, c.id as category_id, c.sort_order / 10 as cat_n, i.*
from (
  select id, right(id::text, 2)::int as n
  from public.shops
  where id::text like 'd0000000-0000-4000-8000-%'
) s
cross join public.categories c
join demo_items i on i.slug = c.slug
where (s.n * 7 + c.sort_order / 10 * 3) % 8 < 5;

-- 4. Товары. Цена — от базовой до +24%, округлённая до тысячи сумов.
insert into public.products
  (id, shop_id, category_id, name_uz, name_ru, description_uz, description_ru, brand, gender, price, is_active)
select
  ('d0000000-0000-4000-8000-' || lpad(to_hex(1000 + n), 12, '0'))::uuid,
  shop_id, category_id, name_uz, name_ru, description_uz, description_ru,
  (array['Navo', 'Urban Toshkent', 'Bahor', 'Zarafshon', 'Shahar Style'])[1 + (n % 5)::int],  -- выдуманные бренды
  gender,
  round(base_price * (1 + ((shop_n * 37 + cat_n * 11) % 25) / 100.0) / 1000) * 1000,
  true
from demo_products;

-- 5. Размеры и цвета: у каждого товара 3 цвета × все размеры категории, количество 0–5 штук.
insert into public.product_variants (product_id, size, color_uz, color_ru, quantity)
select
  ('d0000000-0000-4000-8000-' || lpad(to_hex(1000 + p.n), 12, '0'))::uuid,
  sz.size, col.color_uz, col.color_ru,
  (p.n * 13 + sz.i * 7 + three.j * 5) % 6
from demo_products p
join demo_sizes ds on ds.slug = p.slug
cross join lateral unnest(ds.sizes) with ordinality as sz(size, i)
cross join generate_series(0, 2) as three(j)
join demo_colors col on col.n = (p.n + three.j * 3) % 10;

-- 6. Для проверки: один товар полностью без наличия…
update public.product_variants
set quantity = 0
where product_id = (select ('d0000000-0000-4000-8000-' || lpad(to_hex(1000 + max(n)), 12, '0'))::uuid from demo_products);

-- …и один скрытый товар: в базе есть, но на сайте его быть НЕ должно (проверка правил доступа).
insert into public.products (id, shop_id, category_id, name_uz, name_ru, gender, price, is_active)
values ('d0000000-0000-4000-8000-000000009999', 'd0000000-0000-4000-8000-000000000003',
        (select id from public.categories where slug = 'suits'),
        'Yashirin mahsulot (test)', 'Скрытый товар (тест)', 'men', 1000, false);
insert into public.product_variants (product_id, size, quantity)
values ('d0000000-0000-4000-8000-000000009999', '50', 1);

commit;
