-- Ürün formunda pazaryeri kategorisi ve kategoriye göre zorunlu özellikler (K, 26.10: "tüm pazaryerlerinin zorunlu özellikleri formda
-- zorunlu alan olsun"). Panel API (app/api/mp-categories, mp-attributes) pazaryerinden çeker ve burada önbelleğe alır.
-- Trendyol ağacı/özellikleri herkese açık uçtan; Hepsiburada için Vercel'de HB_* ortam değişkenleri gerekir.
create table if not exists public.mp_categories (
  marketplace text not null,
  id text not null,
  name text not null,
  path text not null,                 -- "Ayakkabı > Spor Ayakkabı > Sneaker"
  path_norm text not null,            -- küçük harf, Türkçe harfler sadeleştirilmiş (arama)
  updated_at timestamptz not null default now(),
  primary key (marketplace, id)
);
create index if not exists mp_categories_norm_trgm on public.mp_categories using gin (path_norm extensions.gin_trgm_ops);
alter table public.mp_categories enable row level security;

-- Kategori özellikleri (normalize): [{ id, name, required, variant, slicer, custom, values: [..] }]
create table if not exists public.mp_category_attrs (
  marketplace text not null,
  category_id text not null,
  attrs jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (marketplace, category_id)
);
alter table public.mp_category_attrs enable row level security;

-- Arama: her kelime yolda geçmeli; benzerliğe göre (yaprak adı önce)
create or replace function public.mp_category_search(p_mp text, p_q text, p_limit int default 20)
returns table (id text, name text, path text) language sql stable security invoker set search_path = public, extensions as $$
  with w as (select array_remove(regexp_split_to_array(trim(p_q), '\s+'), '') ws)
  select c.id, c.name, c.path from public.mp_categories c, w
  where c.marketplace = p_mp and coalesce(array_length(w.ws, 1), 0) > 0
    and (select bool_and(c.path_norm like '%' || x || '%') from unnest(w.ws) x)
  order by similarity(c.path_norm, trim(p_q)) desc, length(c.path)
  limit greatest(1, least(p_limit, 50))
$$;
revoke execute on function public.mp_category_search(text, text, int) from public, anon, authenticated;
