-- Satıştaki tedarikçi kod kopyaları (K, 27.10: "kapatabilirsin"): kopya bayrağı açık tedarikçide (migration 056) aynı kod gövdesinin
-- pazaryerinde açık birden çok ilanı varsa yalnızca stokta (en az p_min_stock) olan en ucuzu satışta kalır, diğerlerine stok 0 gider
-- (worker/core/db-products.ts dbInventory). Silme yok: en ucuzun stoğu biterse sıradaki kendiliğinden açılır.
create or replace function public.dup_listing_losers(p_mp text, p_min_stock int default 1)
returns table (listing_key text) language sql stable security invoker set search_path = public as $$
  with l as (
    select l.listing_key, p.id pid, p.sku, p.cost_price cost, regexp_replace(p.sku, '-\d{1,2}$', '') stem, p.source,
      coalesce((select sum(greatest(v.stock - v.reserved, 0)) from public.product_variants v where v.product_id = p.id), 0) stock
    from public.marketplace_listings l
    join public.products p on p.id = l.product_id
    join public.suppliers s on 'xml:' || s.code = p.source and s.dedupe_code_suffix
    where l.marketplace = p_mp and l.status in ('live', 'pending_approval')
  ), r as (
    select listing_key, row_number() over (partition by source, stem order by (stock >= greatest(p_min_stock, 1)) desc, cost nulls last, length(sku), sku, listing_key) rn,
      count(*) over (partition by source, stem) n
    from l
  )
  select listing_key from r where n > 1 and rn > 1
$$;
revoke execute on function public.dup_listing_losers(text, int) from public, anon, authenticated;
