-- Ürün seçimi sayfası 5-6 sn (K 15.11 "panel yavaş"): opportunity_list her ürün için görsel ve ilan durumu alt sorgusu çalıştırıyordu (118 bin satır).
-- İlan durumu tek seferde birleştirilir, görsel yalnızca sayfadaki ürünler için alınır; sonuç aynı.
create or replace function public.opportunity_list(p_mp text, p_source text, p_q text default '', p_brand text default '', p_min_net numeric default 0, p_min_stock integer default 0, p_only_ok_brand boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable set search_path to 'public' as $function$
  with ls as ( -- yalnızca "ilanı var mı" için kullanılır (sıralama yok, karma gruplama)
    select product_id, min(status) status from public.marketplace_listings where marketplace = p_mp and product_id is not null group by product_id
  ), o as (
    select o.*, p.title, p.sku, ls.status listing_status
    from public.product_opportunity o join public.products p on p.id = o.product_id left join ls on ls.product_id = o.product_id
    where o.marketplace = p_mp and (p_source = '' or o.source = p_source)
  ), f as (
    select * from o where excluded is null and listing_status is null and net >= p_min_net and stock >= p_min_stock
      and (not p_only_ok_brand or brand_ok) and (p_brand = '' or brand = p_brand)
      and (p_q = '' or title ilike '%' || p_q || '%' or category_name ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('total', count(*), 'candidates', count(*) filter (where excluded is null and listing_status is null),
        'excluded', count(*) filter (where excluded is not null), 'sent', count(*) filter (where listing_status is not null), 'last', max(computed_at),
        'reasons', (select jsonb_object_agg(excluded, n) from (select excluded, count(*) n from o where excluded is not null group by 1) x)) from o),
    'total', (select count(*) from f),
    'brands', coalesce((select jsonb_agg(x) from (select brand, count(*) n, bool_or(brand_ok) ok from f group by brand order by 2 desc limit 40) x), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x) from (select product_id, title, sku, (select url from public.product_images i where i.product_id = y.product_id order by position limit 1) image,
        brand, brand_ok, category_name, confidence, price, net, margin, commission, stock, sold7, variants, images, score, reasons
      from (select * from f order by score desc limit greatest(1, least(p_limit, 500)) offset greatest(p_offset, 0)) y order by score desc) x), '[]'::jsonb)
  );
$function$;
revoke execute on function public.opportunity_list(text, text, text, text, numeric, integer, boolean, integer, integer) from public, anon, authenticated;
