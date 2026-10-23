-- Panel hızı (23.10): gösterge paneli 10 ayrı "count exact" sorgusu atıyordu; en ağırı 807 bin satırlık marketplace_brands
-- (her açılışta 2,5-8 sn, senkron sırasında daha da uzun). Tek sorguda sayım; büyük marka tablosu için planlayıcı tahmini (reltuples).
create or replace function public.dashboard_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'products', (select count(*) from products),
    'active', (select count(*) from products where status = 'active'),
    'variants', (select count(*) from product_variants),
    'in_stock_variants', (select count(*) from product_variants where stock > 0),
    'brands', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.marketplace_brands'::regclass),
    'listings', (select jsonb_build_object(
        'live', count(*) filter (where status = 'live'),
        'pending', count(*) filter (where status = 'pending_approval'),
        'closed', count(*) filter (where status = 'closed'),
        'linked', count(*) filter (where variant_id is not null))
      from marketplace_listings where marketplace = 'trendyol')
  );
$$;
revoke execute on function public.dashboard_counts() from public, anon, authenticated;
