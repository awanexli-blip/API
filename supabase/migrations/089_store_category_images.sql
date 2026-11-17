-- Vitrin yeniden tasarım (K 16.11: "kullanıcı dostu, modern, şık"): kategori kartlarında görsel.
-- Alt kategori başına en çok stoklu ürünün görseli; ana kategori görseli en büyük alt kategorininki (uygulamada).
-- Görselli toplama 1,2 sn sürdüğü için önceden hesaplanır (store_catalog ile birlikte yenilenir).
do $$ begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'store_category_counts') then drop view public.store_category_counts; end if;
  if exists (select 1 from pg_matviews where schemaname = 'public' and matviewname = 'store_category_counts') then drop materialized view public.store_category_counts; end if;
end $$;
create materialized view public.store_category_counts as
  select top, sub, coalesce(sub, '') as sub_key, count(*)::int as n, (array_agg(image order by stock desc nulls last) filter (where image is not null))[1] as image
  from public.store_catalog group by top, sub;
create unique index store_category_counts_key on public.store_category_counts (top, sub_key);
revoke all on public.store_category_counts from anon, authenticated;
grant select on public.store_category_counts to service_role;

create or replace function public.store_catalog_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.store_catalog limit 1) then
    refresh materialized view concurrently public.store_catalog;
  else
    refresh materialized view public.store_catalog;
  end if;
  refresh materialized view concurrently public.store_category_counts;
end $$;
revoke all on function public.store_catalog_refresh() from public, anon, authenticated;
grant execute on function public.store_catalog_refresh() to service_role;
