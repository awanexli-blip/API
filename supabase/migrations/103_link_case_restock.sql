-- K 27.11 iki onay:
-- (1) HB merchantSku'yu BÜYÜK harfe çeviriyor (CLZ133-10548-Xs -> ...-XS); listings_link tam eşleşme yaptığı için ~219 canlı ilan bağsız
--     kalıyordu (~203'ü bizde stoklu, HB'de 0: kayıp satış). Harf duyarsız bağlama, YALNIZCA tek varyanta denk gelirse.
-- (2) Stok koruyucu geri açma: koruyucunun sıfırladığı ilan, tedarikçide stok geri gelince (XML geçici bozulup düzelince) 3 dakikada
--     geri açılır (yalnızca stok; fiyat ana senkronda). 26.11 Colezium XML düşüşünde geri açma ~3 saat sürmüştü.

-- Sunucuda yük altında: create index concurrently ile ayrıca çalıştırılır
create index if not exists product_variants_barcode_upper_idx on public.product_variants (upper(barcode));

create or replace function public.listings_link(mp text) returns int
language plpgsql set search_path to 'public' as $$
declare n int; m int; k int;
begin
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v join products p on p.id = v.product_id
  where ml.marketplace = mp and ml.variant_id is null and p.source = 'xml:bayilik'
    and v.sku = regexp_replace(ml.listing_key, '^(ÖS13-|OS13-)', '');
  get diagnostics n = row_count;
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v
  where ml.marketplace = mp and ml.variant_id is null and v.barcode = ml.listing_key;
  get diagnostics m = row_count;
  -- Harf duyarsız: yalnızca canlı, bağsız ve TEK varyanta denk gelen ilan (belirsizse bağlanmaz)
  update marketplace_listings ml set variant_id = x.id, product_id = x.product_id, updated_at = now()
  from (
    select ml2.listing_key, (array_agg(v.id))[1] as id, (array_agg(v.product_id))[1] as product_id
    from marketplace_listings ml2 join product_variants v on upper(v.barcode) = upper(ml2.listing_key)
    where ml2.marketplace = mp and ml2.variant_id is null and ml2.status = 'live'
    group by ml2.listing_key having count(*) = 1
  ) x
  where ml.marketplace = mp and ml.listing_key = x.listing_key and ml.variant_id is null;
  get diagnostics k = row_count;
  return n + m + k;
end $$;

-- Koruyucunun sıfırladığı ilanlar (geri açma yalnızca bunlara)
create table if not exists public.stock_guard_zeroed (
  marketplace text not null,
  listing_key text not null,
  zeroed_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
alter table public.stock_guard_zeroed enable row level security;

create or replace function public.stock_guard_mark(p_mp text, p_keys text[])
returns int language plpgsql as $$
declare n int;
begin
  update public.marketplace_listings set sent_qty = 0, pushed_at = now(), stock = 0
  where marketplace = p_mp and listing_key = any(p_keys);
  get diagnostics n = row_count;
  insert into public.stock_guard_zeroed (marketplace, listing_key) select p_mp, unnest(p_keys)
  on conflict (marketplace, listing_key) do update set zeroed_at = now();
  return n;
end $$;
grant execute on function public.stock_guard_mark(text, text[]) to service_role;

-- Geri açılacaklar: koruyucunun sıfırladığı, hâlâ yayında, pazaryerinde 0, ürün aktif ve stok - rezerv >= en az stok.
-- Temizlik: ana senkron zaten açtıysa / ilan yayından kalktıysa / 7 günden eskiyse kayıt silinir.
create or replace function public.stock_guard_restock_candidates(p_mp text, p_min_stock int)
returns table (listing_key text, qty int)
language plpgsql as $$
begin
  delete from public.stock_guard_zeroed z
  where z.marketplace = p_mp and (
    z.zeroed_at < now() - interval '7 days'
    or not exists (select 1 from public.marketplace_listings l where l.marketplace = z.marketplace and l.listing_key = z.listing_key and l.status = 'live')
    or exists (select 1 from public.marketplace_listings l where l.marketplace = z.marketplace and l.listing_key = z.listing_key
               and (case when l.pushed_at is not null and l.pushed_at >= l.seen_at then coalesce(l.sent_qty, 0) else coalesce(l.stock, 0) end) > 0)
  );
  return query
  select z.listing_key, least(greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0)), 20000)::int
  from public.stock_guard_zeroed z
  join public.marketplace_listings l on l.marketplace = z.marketplace and l.listing_key = z.listing_key and l.status = 'live'
  join public.product_variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id
  where z.marketplace = p_mp and p.status = 'active'
    and coalesce(p.source, '') not in ('manual', 'xml:bayilik')
    and greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0)) >= greatest(1, p_min_stock);
end $$;
grant execute on function public.stock_guard_restock_candidates(text, int) to service_role;

create or replace function public.stock_guard_restocked(p_mp text, p_keys text[], p_qtys int[])
returns int language plpgsql as $$
declare n int;
begin
  update public.marketplace_listings l set sent_qty = x.q, pushed_at = now(), stock = x.q
  from (select unnest(p_keys) k, unnest(p_qtys) q) x
  where l.marketplace = p_mp and l.listing_key = x.k;
  get diagnostics n = row_count;
  delete from public.stock_guard_zeroed where marketplace = p_mp and listing_key = any(p_keys);
  return n;
end $$;
grant execute on function public.stock_guard_restocked(text, text[], int[]) to service_role;
