-- Район Ташкента у магазина — для фильтра «Район» на странице категории.
-- Хранится короткое имя района (например chilonzor); названия на uz/ru — в переводах сайта.
--
-- Как запустить (один раз): Supabase → SQL Editor → New query → вставить весь файл → Run.

begin;

alter table public.shops
  add column if not exists district text
    check (district in (
      'bektemir', 'chilonzor', 'mirobod', 'mirzo-ulugbek', 'olmazor', 'sergeli',
      'shayxontohur', 'uchtepa', 'yakkasaroy', 'yangihayot', 'yashnobod', 'yunusobod'
    ));

commit;
