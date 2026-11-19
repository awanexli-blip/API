-- Vitrin araması (K 19.11: "müşteri aradığını kolayca bulsun, güzel filtreleme"):
-- Türkçe harfe duyarsız (ç/c, ı/i, ş/s...), çok kelimeli (her kelime başlıkta ya da kategori yolunda geçmeli), sıra bağımsız.
-- Az sonuç (<4) varsa yazım hatası toleransı (pg_trgm word_similarity >= 0.5) eklenir; hiç tam eşleşme yoksa "benzer sonuçlar" işareti.
-- Tek çağrıda: sayfa ürünleri + toplam + kategori yüzeyi (üst > alt > tür, sayılı) + fiyat aralığı sayıları.
-- Hız: normalleştirilmiş metin (hay/tn) katalogda hazır tutulur (satır başına fonksiyon çağrısı 7 sn sürüyordu).
create or replace function public.store_norm(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select btrim(regexp_replace(translate(lower(translate(coalesce(t, ''), 'İI', 'ii')), 'çğıöşüâîû', 'cgiosuaiu'), '[^a-z0-9]+', ' ', 'g'))
$$;

drop function if exists public.store_search(text, text, text, text, numeric, numeric, text, int, int, boolean);
drop materialized view if exists public.store_category_counts;
drop materialized view if exists public.store_catalog;

create materialized view public.store_catalog as
with l as (
  select product_id, min(price) as price, sum(stock) as stock, max(category_id) as category_id
  from public.marketplace_listings
  where marketplace = 'trendyol' and status = 'live' and product_id is not null and stock > 0 and price > 0
  group by product_id
)
select p.id as product_id,
  trim(both '-' from left(regexp_replace(translate(lower(p.title), 'çğıöşüâîûİ', 'cgiosuaiui'), '[^a-z0-9]+', '-', 'g'), 80)) || '-' || left(p.id::text, 8) as slug,
  p.title, l.price, l.stock, c.path,
  coalesce(nullif(split_part(c.path, ' > ', 1), ''), 'Diğer') as top,
  nullif(split_part(c.path, ' > ', 2), '') as sub,
  c.name as leaf,
  (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1) as image,
  p.created_at,
  public.store_norm(p.title) as tn,
  public.store_norm(p.title || ' ' || coalesce(c.path, '')) as hay
from l
join public.products p on p.id = l.product_id and p.status = 'active'
left join public.mp_categories c on c.marketplace = 'trendyol' and c.id = l.category_id;

create unique index store_catalog_pid on public.store_catalog (product_id);
create index store_catalog_slug on public.store_catalog (slug);
create index store_catalog_top on public.store_catalog (top, sub, price);
create index store_catalog_new on public.store_catalog (created_at desc);
create index store_catalog_title_trgm on public.store_catalog using gin (title extensions.gin_trgm_ops);
create index store_catalog_hay_trgm on public.store_catalog using gin (hay extensions.gin_trgm_ops);

create materialized view public.store_category_counts as
  select top, sub, coalesce(sub, '') as sub_key, count(*)::int as n, (array_agg(image order by stock desc nulls last) filter (where image is not null))[1] as image
  from public.store_catalog group by top, sub;
create unique index store_category_counts_key on public.store_category_counts (top, sub_key);

revoke all on public.store_catalog, public.store_category_counts from anon, authenticated;
grant select on public.store_catalog, public.store_category_counts to service_role;

create or replace function public.store_search(
  p_q text default null, p_top text default null, p_sub text default null, p_leaf text default null,
  p_min numeric default null, p_max numeric default null, p_sort text default 'onerilen',
  p_offset int default 0, p_limit int default 48, p_facets boolean default true)
returns jsonb language plpgsql stable security invoker
set search_path = public, extensions set pg_trgm.word_similarity_threshold = 0.5 as $$
declare
  qn text := public.store_norm(left(coalesce(p_q, ''), 80));
  words text[] := coalesce((select array_agg(w) from unnest(regexp_split_to_array(qn, ' ')) w where w <> ''), '{}'::text[]);
  pats text[] := coalesce((select array_agg('%' || w || '%') from unnest(words) w), '{}'::text[]);
  strict_n int := 0;
  loose boolean := false;
  anchor text := (select w from unnest(words) w order by length(w) desc limit 1);
  fz uuid[] := '{}'::uuid[];
  res jsonb;
begin
  p_limit := greatest(1, least(coalesce(p_limit, 48), 100));
  p_offset := greatest(0, least(coalesce(p_offset, 0), 24000));
  if cardinality(words) > 0 then
    select count(*) into strict_n from (select 1 from public.store_catalog s where s.hay like all (pats) limit 4) x;
    loose := strict_n < 4;
  end if;
  if loose then -- yazım hatası toleransı: en uzun kelime trigram dizininden (<%), sonra her kelime >= 0.5
    select coalesce(array_agg(product_id), '{}') into fz from (
      select s.product_id from public.store_catalog s
      where anchor <% s.hay and (select bool_and(extensions.word_similarity(w, s.hay) >= 0.5) from unnest(words) w)
      limit 2000) x;
  end if;

  with m as (
    select s.product_id, s.slug, s.title, s.price, s.stock, s.image, s.top, s.sub, s.leaf, s.created_at,
      case when cardinality(words) = 0 then 0
           when s.tn like qn || '%' then -3
           when s.tn like '%' || qn || '%' then -2
           when s.hay like all (pats) then -1
           else 1 - extensions.word_similarity(qn, s.tn) end as rk
    from public.store_catalog s
    where cardinality(words) = 0 or s.hay like all (pats)
       or s.product_id = any (fz)
  ),
  c as (select * from m where (p_top is null or top = p_top) and (p_sub is null or sub = p_sub)),
  cl as (select * from c where p_leaf is null or leaf = p_leaf),
  f as (select * from cl where (p_min is null or price >= p_min) and (p_max is null or price <= p_max)),
  pg as (
    select product_id, slug, title, price, image, top, sub, leaf from f
    order by
      case when p_sort = 'fiyat-artan' then price end asc nulls last,
      case when p_sort = 'fiyat-azalan' then price end desc nulls last,
      case when p_sort = 'yeni' then created_at end desc nulls last,
      rk asc, stock desc, product_id
    offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'fuzzy', cardinality(words) > 0 and strict_n = 0,
    'items', coalesce((select jsonb_agg(to_jsonb(pg)) from pg), '[]'::jsonb),
    'facets', case when not p_facets then null else jsonb_build_object(
      'level', case when p_top is null then 'top' when p_sub is null then 'sub' else 'leaf' end,
      'cats', coalesce((select jsonb_agg(jsonb_build_object('name', k, 'n', n) order by n desc, k) from (
        select case when p_top is null then top when p_sub is null then sub else leaf end as k, count(*)::int as n
        from c where (p_min is null or price >= p_min) and (p_max is null or price <= p_max)
        group by 1 order by 2 desc limit 40) g where k is not null), '[]'::jsonb),
      'bands', (select jsonb_build_array(
        count(*) filter (where price <= 250), count(*) filter (where price >= 250 and price <= 500),
        count(*) filter (where price >= 500 and price <= 1000), count(*) filter (where price >= 1000 and price <= 2500),
        count(*) filter (where price >= 2500)) from cl),
      'free', (select count(*) from cl where price >= 500),
      'pmin', (select floor(min(price)) from cl), 'pmax', (select ceil(max(price)) from cl)) end
  ) into res;
  return res;
end $$;

revoke all on function public.store_search(text, text, text, text, numeric, numeric, text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.store_search(text, text, text, text, numeric, numeric, text, int, int, boolean) to service_role;
revoke all on function public.store_norm(text) from anon, authenticated;

-- PostgREST şema önbelleği (19.11: eklenmeyince yeni RPC bulunamadı, vitrin ~55 dk 500 verdi)
notify pgrst, 'reload schema';
