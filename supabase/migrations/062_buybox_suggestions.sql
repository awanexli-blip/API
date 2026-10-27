-- Rekabet önerileri (K, 27.10): her kontrolde güncel veriyle öneri (lower = 1 TL altına in, en az 40 TL net; raise = buybox bizde,
-- ikinci satıcı çok pahalı -> fiyatı artır; reset = rakip kalmadı, elle fiyattan formüle dön). Uygulama yalnızca panelden onayla
-- (worker/core/buybox.ts suggestFor, app/api/buybox).
alter table public.listing_buybox add column if not exists suggestion text;

create or replace function public.buybox_report(p_mp text, p_filter text default 'suggest', p_q text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with b as (
    select b.*, coalesce(l.title, p.title) title, l.product_id,
      (select coalesce(sum(ol.qty), 0) from public.order_lines ol join public.orders o on o.id = ol.order_id
        where o.marketplace = p_mp and ol.listing_key = b.listing_key and o.ordered_at > now() - interval '30 days' and o.status <> 'cancelled') sold30,
      (select ov.price_override from public.product_overrides ov where ov.marketplace = p_mp and ov.barcode = b.listing_key and ov.price_override is not null) override_price
    from public.listing_buybox b
    join public.marketplace_listings l on l.marketplace = b.marketplace and l.listing_key = b.listing_key
    left join public.products p on p.id = l.product_id
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
$$;
revoke execute on function public.buybox_report(text, text, text, int, int) from public, anon, authenticated;
