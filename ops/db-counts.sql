-- public şemasındaki her tablonun satır sayısı ("tablo sayı" satırları). Yedek doğrulaması kullanır (.github/workflows/backup.yml).
select c.relname || ' ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relkind in ('r', 'p')
order by 1;
