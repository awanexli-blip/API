-- Rekabet / buybox takibi (Trendyol "Ürün Buybox Kontrol" servisi): ilan başına sıra, buybox fiyatı, 2./3. fiyat, başka satıcı var mı.
-- Worker kâr hesabını da yazar: bugünkü net, buybox'ın 1 TL altına inersek net (fiyat motoruyla). Panel: Pazaryeri > Rekabet.
create table if not exists public.listing_buybox (
  marketplace text not null,
  listing_key text not null,
  buybox_order int,               -- 1 = buybox bizde
  buybox_price numeric,
  second_price numeric,
  third_price numeric,
  multiple boolean,               -- başka satıcı da satıyor
  our_price numeric,
  cost numeric,                   -- KDV dahil maliyet
  commission numeric,
  net_now numeric,
  target_price numeric,           -- önerilen: buybox fiyatının 1 TL altı (buybox bizdeyse null)
  net_at_target numeric,
  checked_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
create index if not exists listing_buybox_order_idx on public.listing_buybox (marketplace, buybox_order);
alter table public.listing_buybox enable row level security;

-- Özet + liste (son 30 günde satılan adet öncelik için)
create or replace function public.buybox_report(p_mp text, p_filter text default 'lost', p_q text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with b as (
    select b.*, coalesce(l.title, p.title) title, l.product_id,
      (select coalesce(sum(ol.qty), 0) from public.order_lines ol join public.orders o on o.id = ol.order_id
        where o.marketplace = p_mp and ol.listing_key = b.listing_key and o.ordered_at > now() - interval '30 days' and o.status <> 'cancelled') sold30,
      exists (select 1 from public.product_overrides ov where ov.marketplace = p_mp and ov.barcode = b.listing_key and ov.price_override is not null) overridden
    from public.listing_buybox b
    join public.marketplace_listings l on l.marketplace = b.marketplace and l.listing_key = b.listing_key
    left join public.products p on p.id = l.product_id
    where b.marketplace = p_mp
  ), f as (
    select * from b where
      case p_filter when 'lost' then buybox_order > 1 when 'winnable' then buybox_order > 1 and net_at_target > 0 when 'won' then buybox_order = 1 and multiple when 'alone' then not coalesce(multiple, false) else true end
      and (p_q = '' or title ilike '%' || p_q || '%' or listing_key ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('checked', count(*), 'competition', count(*) filter (where multiple), 'won', count(*) filter (where buybox_order = 1 and multiple),
        'lost', count(*) filter (where buybox_order > 1), 'winnable', count(*) filter (where buybox_order > 1 and net_at_target > 0), 'alone', count(*) filter (where not coalesce(multiple, false)),
        'last', max(checked_at)) from b),
    'total', (select count(*) from f),
    'items', coalesce((select jsonb_agg(x) from (select listing_key, title, buybox_order, buybox_price, second_price, our_price, cost, net_now, target_price, net_at_target, sold30, overridden, checked_at
      from f order by sold30 desc, (our_price - buybox_price) desc nulls last limit greatest(1, least(p_limit, 200)) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
$$;
revoke execute on function public.buybox_report(text, text, text, int, int) from public, anon, authenticated;
