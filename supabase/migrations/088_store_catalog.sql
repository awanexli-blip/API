-- ozsaraytr.com vitrin kataloğu (K 16.11: "siteyi gösterme amaçlı kuralım; kargo ve sanal POS sonra").
-- Kaynak: Trendyol'da yayında + stoklu + ürüne bağlı ilanlar (satış kısıtı ve kalite elemeleri o ilanlarda zaten uygulanmış).
-- Fiyat: Trendyol satış fiyatı (ürünün en düşük varyant fiyatı). Kategori: Trendyol kategori yolu (mp_categories).
-- Saatte bir yenilenir (trentakip-store-refresh.timer -> store_catalog_refresh()).
create materialized view if not exists public.store_catalog as
with l as (
  select product_id, min(price) as price, sum(stock) as stock, max(category_id) as category_id
  from public.marketplace_listings
  where marketplace = 'trendyol' and status = 'live' and product_id is not null and stock > 0 and price > 0
  group by product_id
)
select p.id as product_id,
  trim(both '-' from left(regexp_replace(translate(lower(p.title), 'çğıöşüâîûİ', 'cgiosuaiui'), '[^a-z0-9]+', '-', 'g'), 80)) || '-' || left(p.id::text, 8) as slug,
  p.title, l.price, l.stock, c.path,
  coalesce(nullif(split_part(c.path, ' > ', 1), ''), 'Diğer') as top,
  nullif(split_part(c.path, ' > ', 2), '') as sub,
  c.name as leaf,
  (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1) as image,
  p.created_at
from l
join public.products p on p.id = l.product_id and p.status = 'active'
left join public.mp_categories c on c.marketplace = 'trendyol' and c.id = l.category_id
with no data;

create unique index if not exists store_catalog_pid on public.store_catalog (product_id);
create index if not exists store_catalog_slug on public.store_catalog (slug);
create index if not exists store_catalog_top on public.store_catalog (top, sub, price);
create index if not exists store_catalog_new on public.store_catalog (created_at desc);
create index if not exists store_catalog_title_trgm on public.store_catalog using gin (title gin_trgm_ops); -- PostgREST ilike

-- Kategori sayaçları (menü ve kategori sayfası alt kategori çipleri)
create or replace view public.store_category_counts as
  select top, sub, count(*)::int as n from public.store_catalog group by top, sub;

create or replace function public.store_catalog_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.store_catalog limit 1) then
    refresh materialized view concurrently public.store_catalog;
  else
    refresh materialized view public.store_catalog;
  end if;
end $$;

revoke all on public.store_catalog, public.store_category_counts from anon, authenticated;
grant select on public.store_catalog, public.store_category_counts to service_role;
revoke all on function public.store_catalog_refresh() from public, anon, authenticated;
grant execute on function public.store_catalog_refresh() to service_role;

refresh materialized view public.store_catalog;
