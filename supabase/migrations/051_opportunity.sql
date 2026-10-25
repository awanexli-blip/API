-- Ürün seçimi / fırsat listesi (K, 25.10: Trendyol'da 50 bin ürün sınırı; Royal'den yalnızca satış potansiyeli yüksek, stoklu, kârlı ürünler).
-- 1) Tedarikçi stok düşüşü (satış hızı): her içe aktarmada ürün stoğu bir önceki kayıtla karşılaştırılır, düşüş günün toplamına eklenir
--    (tedarikçinin stoğu düşüyorsa ürün diğer bayilerde satılıyor demektir; stok artışı = yeniden stok, sayılmaz).
create table if not exists public.supplier_stock_snap (
  product_id uuid not null references public.products(id) on delete cascade,
  day date not null,
  stock int not null,
  drops int not null default 0,
  primary key (product_id, day)
);
create index if not exists supplier_stock_snap_day_idx on public.supplier_stock_snap (day);
alter table public.supplier_stock_snap enable row level security;

create or replace function public.snap_supplier_stock(p_source text) returns int
language sql security invoker set search_path = public as $$
  with cur as (
    select p.id, coalesce(sum(v.stock), 0)::int stock from public.products p join public.product_variants v on v.product_id = p.id
    where p.source = p_source group by p.id
  ), prev as (
    select distinct on (s.product_id) s.product_id, s.stock from public.supplier_stock_snap s
    join cur on cur.id = s.product_id order by s.product_id, s.day desc
  ), up as (
    insert into public.supplier_stock_snap (product_id, day, stock, drops)
    select cur.id, (now() at time zone 'Europe/Istanbul')::date, cur.stock, greatest(coalesce(prev.stock, cur.stock) - cur.stock, 0)
    from cur left join prev on prev.product_id = cur.id
    on conflict (product_id, day) do update set drops = supplier_stock_snap.drops + greatest(supplier_stock_snap.stock - excluded.stock, 0), stock = excluded.stock
    returning 1
  )
  select count(*)::int from up;
$$;
revoke execute on function public.snap_supplier_stock(text) from public, anon, authenticated;

-- 2) Fırsat puanı (worker/opportunity.ts günlük yazar): pazaryeri fiyatı/neti fiyat motoruyla, kategori/komisyon tahminiyle
create table if not exists public.product_opportunity (
  marketplace text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  source text,
  score numeric,
  price numeric, net numeric, margin numeric, commission numeric,
  stock int, sold7 int, variants int, images int,
  category_id text, category_name text, confidence numeric,
  brand text, brand_ok boolean,
  excluded text,                 -- elendiyse nedeni (mağazada var, stok az, zarar...)
  reasons jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (marketplace, product_id)
);
create index if not exists product_opportunity_score_idx on public.product_opportunity (marketplace, score desc) where excluded is null;
alter table public.product_opportunity enable row level security;

create or replace function public.opportunity_list(p_mp text, p_source text, p_q text default '', p_brand text default '', p_min_net numeric default 0, p_min_stock int default 0, p_only_ok_brand boolean default false, p_limit int default 50, p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with o as (
    select o.*, p.title, p.sku, (select url from public.product_images i where i.product_id = p.id order by position limit 1) image,
      (select l.status from public.marketplace_listings l where l.product_id = p.id and l.marketplace = p_mp limit 1) listing_status
    from public.product_opportunity o join public.products p on p.id = o.product_id
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
    'items', coalesce((select jsonb_agg(x) from (select product_id, title, sku, image, brand, brand_ok, category_name, confidence, price, net, margin, commission, stock, sold7, variants, images, score, reasons
      from f order by score desc limit greatest(1, least(p_limit, 500)) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
$$;
revoke execute on function public.opportunity_list(text, text, text, text, numeric, int, boolean, int, int) from public, anon, authenticated;
