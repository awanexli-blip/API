-- Kod kopyaları (057) kapalı ilanları da sayar, ama en sona koyar (28.10). Önceden yalnızca satıştaki/onaydaki ilanlar sayılıyordu:
-- Hepsiburada stoğu 0 olan ilanı "satılamaz" (kapalı) döndürdüğü için stok 0 gönderilen kopyalar listeden düşüyor, kapalı sayılmayınca
-- (worker hepsiburada.ts düzeltmesi) bir tur kopya sayılmadan stok alacaklardı. Pazaryerinin kilitlediği ilan grubun açık kalanı seçilmez.
create or replace function public.dup_listing_losers(p_mp text, p_min_stock int default 1)
returns table (listing_key text) language sql stable security invoker set search_path = public as $$
  with l as (
    select l.listing_key, l.status, p.id pid, p.sku, p.cost_price cost, regexp_replace(p.sku, '-\d{1,2}$', '') stem, p.source,
      coalesce((select sum(greatest(v.stock - v.reserved, 0)) from public.product_variants v where v.product_id = p.id), 0) stock
    from public.marketplace_listings l
    join public.products p on p.id = l.product_id
    join public.suppliers s on 'xml:' || s.code = p.source and s.dedupe_code_suffix
    where l.marketplace = p_mp and l.status in ('live', 'pending_approval', 'closed')
  ), r as (
    select listing_key, row_number() over (partition by source, stem order by (status <> 'closed') desc, (stock >= greatest(p_min_stock, 1)) desc, cost nulls last, length(sku), sku, listing_key) rn,
      count(*) over (partition by source, stem) n
    from l
  )
  select listing_key from r where n > 1 and rn > 1
$$;
revoke execute on function public.dup_listing_losers(text, int) from public, anon, authenticated;
