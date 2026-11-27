-- Tedarikçiler arası "en ucuz kaynak" (K 28.11): aynı ürün birden çok tedarikçide varsa pazaryerinde (Hepsiburada, Pazarama) yalnızca
-- stokta en ucuz kaynağın ilanı stokta kalır, diğerlerine stok 0 gider (fiyat kazananın maliyetinden doğal olarak düşer).
-- Trendyol kapsam dışı. Anahtar: app_state 'cross_supplier_dedupe' (JSON metin), VARSAYILAN KAPALI.
--   {"enabled": false, "marketplaces": ["hepsiburada","pazarama"], "min_gain_pct": 3, "source_min_stock": {"xml:akillibayi": 5}}
-- Eşleşme sıkı: aynı gerçek barkod (GTIN) ya da aynı başlık imzası VE ilk görselin algısal özeti yakın (worker/xsup-groups.ts, ops/xsup/hash_images.py).
-- Yalnızca tek varyantlı ürünler eşleşir (beden/renk varyantlı ürünün maliyeti ürün düzeyinde karşılaştırılamaz).
-- Eski dup_listing_losers gövdesi dup_code_losers olur; dup_listing_losers = dup_code_losers + xsup_losers (bayrak kapalıyken xsup_losers boş döner).

create table if not exists public.product_xkeys (
  product_id uuid primary key references public.products(id) on delete cascade,
  sig text not null,
  img_url text,
  ph text,
  dh text,
  hashed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists product_xkeys_sig_idx on public.product_xkeys (sig);
create index if not exists product_xkeys_unhashed_idx on public.product_xkeys (product_id) where ph is null and img_url is not null;

create table if not exists public.product_xgroups (
  product_id uuid primary key references public.products(id) on delete cascade,
  group_key text not null,
  method text not null,
  updated_at timestamptz not null default now()
);
create index if not exists product_xgroups_key_idx on public.product_xgroups (group_key);
alter table public.product_xkeys enable row level security;
alter table public.product_xgroups enable row level security;

-- Ayar (bozuk JSON'da hata vermez: stok koruyucu bu işlevi 3 dakikada bir çağırır). Kapalıysa ya da yoksa null.
create or replace function public.xsup_cfg() returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v text; j jsonb;
begin
  select value into v from public.app_state where key = 'cross_supplier_dedupe';
  if v is null then return null; end if;
  j := v::jsonb;
  if jsonb_typeof(j) <> 'object' or coalesce(j->>'enabled', 'false') <> 'true' then return null; end if;
  return j;
exception when others then return null;
end $$;

create or replace function public.xsup_jarr(p_key text) returns text[] language plpgsql stable security invoker set search_path = public as $$
declare v text;
begin
  select value into v from public.app_state where key = p_key;
  if v is null then return '{}'; end if;
  return coalesce(array(select jsonb_array_elements_text(v::jsonb)), '{}');
exception when others then return '{}';
end $$;

-- Eşleşme adayı ürünler (anahtar sıralı sayfalama: aynı çağrı 160 kez tüm tabloyu taramasın)
create or replace function public.xsup_members(p_after uuid default null, p_limit int default 1000)
returns table (id uuid, source text, sku text, title text, cost numeric, stock bigint, gtin text, img_url text, ph text, dh text, live text[])
language sql stable security invoker set search_path = public as $$
  select p.id, p.source, p.sku, p.title, coalesce(v.cost_price, p.cost_price), greatest(v.stock - v.reserved, 0)::bigint, v.barcode,
    (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1), k.ph, k.dh,
    coalesce((select array_agg(distinct l.marketplace) from public.marketplace_listings l
      where l.product_id = p.id and l.status = 'live' and l.marketplace in ('hepsiburada', 'pazarama')), '{}')
  from public.products p
  join public.product_variants v on v.product_id = p.id
  left join public.product_xkeys k on k.product_id = p.id
  where p.status = 'active' and p.currency = 'TRY' and p.source like 'xml:%' and (p_after is null or p.id > p_after)
    and (select count(*) from public.product_variants x where x.product_id = p.id) = 1
  order by p.id limit greatest(1, least(p_limit, 5000))
$$;

-- Kopya (aynı tedarikçi kod gövdesi) kaybedenleri: eski dup_listing_losers gövdesi (056/057)
create or replace function public.dup_code_losers(p_mp text, p_min_stock int default 1)
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
revoke execute on function public.dup_code_losers(text, int) from public, anon, authenticated;

-- Tedarikçiler arası kaybedenler. Kaybeden L: aynı grupta, aynı pazaryerinde YAYINDA, stokta (kaynağın en az stoğu), engelli olmayan,
-- kopya kuralıyla da sıfırlanmayan bir W var ve W.maliyet * (1 + kazanç) < L.maliyet. Yani L'nin yerine satışta kalacak bir ilan her zaman vardır
-- (kazananın ilanı yoksa kimse sıfırlanmaz; kazanan xsup_send_candidates ile gönderim kuyruğuna aday olur).
-- p_force: bayrak kapalıyken etki raporu için (yazmaz; yalnızca okur). p_gain: yüzde, boşsa ayardan (varsayılan 3).
create or replace function public.xsup_losers(p_mp text, p_min_stock int default 1, p_gain numeric default null, p_force boolean default false)
returns table (listing_key text, group_key text, winner_key text, loser_cost numeric, winner_cost numeric)
language plpgsql stable security invoker set search_path = public as $$
declare c jsonb := public.xsup_cfg(); gain numeric; smin jsonb; ex_s text[]; ex_p text[];
begin
  if c is null and not p_force then return; end if;
  if c is not null and not p_force and not (coalesce(c->'marketplaces', '["hepsiburada","pazarama"]'::jsonb) ? p_mp) then return; end if;
  if p_mp not in ('hepsiburada', 'pazarama') then return; end if;
  gain := coalesce(p_gain, (c->>'min_gain_pct')::numeric, 3) / 100.0;
  smin := coalesce(c->'source_min_stock', '{}'::jsonb);
  ex_s := public.xsup_jarr('exclude_sources:' || p_mp); ex_p := public.xsup_jarr('exclude_products:' || p_mp);
  return query
  with m as (
    select g.group_key gk, l.listing_key lk, p.id pid, p.source src, coalesce(v.cost_price, p.cost_price) cost,
      greatest(v.stock - v.reserved, 0) stock
    from public.product_xgroups g
    join public.products p on p.id = g.product_id and p.status = 'active' and p.currency = 'TRY'
    join public.product_variants v on v.product_id = p.id
    join public.marketplace_listings l on l.product_id = p.id and l.variant_id = v.id and l.marketplace = p_mp and l.status = 'live'
  ), grp as (select m.gk from m group by m.gk having count(*) > 1),
  mm as (select m.* from m where m.gk in (select grp.gk from grp)),
  w as (
    select mm.* from mm
    where mm.cost > 0 and mm.stock >= greatest(p_min_stock, coalesce((smin->>mm.src)::int, 1), 1)
      and not (mm.src = any (ex_s)) and not (mm.pid::text = any (ex_p))
      and mm.lk not in (select d.listing_key from public.dup_code_losers(p_mp, p_min_stock) d)
  )
  select distinct on (l.lk) l.lk, l.gk, w.lk, l.cost, w.cost
  from mm l join w on w.gk = l.gk and w.lk <> l.lk and w.cost * (1 + gain) < l.cost
  where l.cost > 0
  order by l.lk, w.cost, w.lk;
end $$;
revoke execute on function public.xsup_losers(text, int, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.xsup_members(uuid, int) from public, anon, authenticated;

-- Gönderim adayı: grupta stokta en ucuz ürün bu pazaryerinde hiç ilan satırı yokken, yayındaki (stokta) başka bir üye ondan pahalıysa.
-- Otomatik açılmaz: ana gönderim kuyruğuna (panel / jobs) elle ya da normal akışla alınır; ilan yayına girince eskisi kendiliğinden sıfırlanır.
create or replace function public.xsup_send_candidates(p_mp text, p_min_stock int default 1, p_gain numeric default null, p_force boolean default false)
returns table (product_id uuid, group_key text, source text, sku text, cost numeric, ref_key text, ref_cost numeric)
language plpgsql stable security invoker set search_path = public as $$
declare c jsonb := public.xsup_cfg(); gain numeric; smin jsonb; ex_s text[]; ex_p text[];
begin
  if c is null and not p_force then return; end if;
  if p_mp not in ('hepsiburada', 'pazarama') then return; end if;
  gain := coalesce(p_gain, (c->>'min_gain_pct')::numeric, 3) / 100.0;
  smin := coalesce(c->'source_min_stock', '{}'::jsonb);
  ex_s := public.xsup_jarr('exclude_sources:' || p_mp); ex_p := public.xsup_jarr('exclude_products:' || p_mp);
  return query
  with m as (
    select g.group_key gk, p.id pid, p.source src, p.sku sku, coalesce(v.cost_price, p.cost_price) cost, greatest(v.stock - v.reserved, 0) stock,
      (select l.listing_key from public.marketplace_listings l where l.product_id = p.id and l.marketplace = p_mp and l.status = 'live' limit 1) live_key,
      exists (select 1 from public.marketplace_listings l where l.product_id = p.id and l.marketplace = p_mp) has_any
    from public.product_xgroups g
    join public.products p on p.id = g.product_id and p.status = 'active' and p.currency = 'TRY'
    join public.product_variants v on v.product_id = p.id
  ), ok as (
    select m.* from m where m.cost > 0 and m.stock >= greatest(p_min_stock, coalesce((smin->>m.src)::int, 1), 1)
      and not (m.src = any (ex_s)) and not (m.pid::text = any (ex_p))
  ), best as (select distinct on (ok.gk) ok.* from ok order by ok.gk, ok.cost, ok.sku)
  select b.pid, b.gk, b.src, b.sku, b.cost, o.live_key, o.cost
  from best b
  join lateral (select ok.live_key, ok.cost from ok where ok.gk = b.gk and ok.live_key is not null order by ok.cost limit 1) o on true
  where not b.has_any and b.live_key is null and b.cost * (1 + gain) < o.cost;
end $$;
revoke execute on function public.xsup_send_candidates(text, int, numeric, boolean) from public, anon, authenticated;

-- Bayrak kapalıyken davranış eskisiyle aynı: xsup_losers boş döner.
create or replace function public.dup_listing_losers(p_mp text, p_min_stock int default 1)
returns table (listing_key text) language sql stable security invoker set search_path = public as $$
  select d.listing_key from public.dup_code_losers(p_mp, p_min_stock) d
  union
  select x.listing_key from public.xsup_losers(p_mp, p_min_stock) x
$$;
revoke execute on function public.dup_listing_losers(text, int) from public, anon, authenticated;

-- Eşleşme tablolarını tek işlemde yenile (kazanan hesabı yarım grupla çalışmasın)
create or replace function public.xsup_replace_groups(p_rows jsonb)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  create temp table _xg on commit drop as
    select (r->>'id')::uuid product_id, r->>'group_key' group_key, r->>'method' method from jsonb_array_elements(p_rows) r;
  delete from public.product_xgroups g where not exists (select 1 from _xg x where x.product_id = g.product_id);
  insert into public.product_xgroups (product_id, group_key, method, updated_at)
    select product_id, group_key, method, now() from _xg
    on conflict (product_id) do update set group_key = excluded.group_key, method = excluded.method, updated_at = now()
    where (public.product_xgroups.group_key, public.product_xgroups.method) is distinct from (excluded.group_key, excluded.method);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.xsup_replace_groups(jsonb) from public, anon, authenticated;
