-- Узбекское название категории «Платья и юбки»:
-- «Platya va yubkalar» → «Ayollar ko‘ylagi va yubkalar».
--
-- Как запустить (один раз): Supabase → SQL Editor → New query → вставить весь файл → Run.

begin;

update public.categories
set name_uz = 'Ayollar ko‘ylagi va yubkalar'
where slug = 'dresses';

commit;
