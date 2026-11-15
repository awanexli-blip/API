-- Rekabet sayfası 10-13 sn (K 15.11 "panel yavaş"): buybox_report her ilan için ayrı satış alt sorgusu çalıştırıyordu (54 bin satır).
-- Satışlar ve elle fiyatlar tek seferde toplanıp birleştirilir; sonuç aynı.
create or replace function public.buybox_report(p_mp text, p_filter text default 'suggest', p_q text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable set search_path to 'public' as $function$
  with sold as (
    select ol.listing_key, sum(ol.qty) qty from public.order_lines ol join public.orders o on o.id = ol.order_id
    where o.marketplace = p_mp and o.ordered_at > now() - interval '30 days' and o.status <> 'cancelled' and ol.listing_key is not null
    group by ol.listing_key
  ), ov as (
    select barcode, price_override from public.product_overrides where marketplace = p_mp and price_override is not null
  ), b as (
    select b.*, coalesce(l.title, p.title) title, l.product_id, coalesce(s.qty, 0) sold30, ov.price_override override_price
    from public.listing_buybox b
    join public.marketplace_listings l on l.marketplace = b.marketplace and l.listing_key = b.listing_key
    left join public.products p on p.id = l.product_id
    left join sold s on s.listing_key = b.listing_key
    left join ov on ov.barcode = b.listing_key
    where b.marketplace = p_mp
  ), f as (
    select * from b where
      case p_filter when 'suggest' then suggestion is not null when 'winnable' then suggestion = 'lower' when 'raise' then suggestion = 'raise' when 'reset' then suggestion = 'reset'
        when 'lost' then buybox_order > 1 when 'won' then buybox_order = 1 and multiple when 'alone' then not coalesce(multiple, false) when 'overridden' then override_price is not null else true end
      and (p_q = '' or title ilike '%' || p_q || '%' or listing_key ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('checked', count(*), 'competition', count(*) filter (where multiple), 'won', count(*) filter (where buybox_order = 1 and multiple),
        'lost', count(*) filter (where buybox_order > 1), 'winnable', count(*) filter (where suggestion = 'lower'), 'raise', count(*) filter (where suggestion = 'raise'),
        'reset', count(*) filter (where suggestion = 'reset'), 'suggest', count(*) filter (where suggestion is not null), 'overridden', count(*) filter (where override_price is not null),
        'alone', count(*) filter (where not coalesce(multiple, false)), 'last', max(checked_at)) from b),
    'total', (select count(*) from f),
    'items', coalesce((select jsonb_agg(x) from (select listing_key, title, buybox_order, buybox_price, second_price, our_price, cost, net_now, target_price, net_at_target, suggestion,
        sold30, override_price is not null overridden, override_price, checked_at
      from f order by sold30 desc, (case suggestion when 'lower' then 0 when 'raise' then 1 else 2 end), abs(coalesce(net_at_target, 0) - coalesce(net_now, 0)) desc nulls last
      limit greatest(1, least(p_limit, 200)) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
$function$;
revoke execute on function public.buybox_report(text, text, text, integer, integer) from public, anon, authenticated;
