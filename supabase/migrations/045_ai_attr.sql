-- Yapay zekâ ile eksik zorunlu özellik doldurma (worker/core/ai-attrs.ts): ürün başına deneme kaydı (aynı ürün 7 gün içinde yeniden sorulmaz).
-- Yazılan değerler products.attributes'a gider (pazaryerinin değer listesinden; serbest metin yalnızca pazaryeri izin veriyorsa).
create table if not exists public.ai_attr_runs (
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null,
  at timestamptz not null default now(),
  asked text[] not null default '{}',
  filled jsonb not null default '{}'::jsonb,   -- {özellik: değer}
  primary key (product_id, marketplace)
);
alter table public.ai_attr_runs enable row level security;

-- Aday ilanlar: eksik özellik hatası, ürün aktif, son 7 günde denenmemiş
create or replace function public.ai_attr_candidates(p_mp text, p_limit int default 150)
returns table (listing_key text, product_id uuid, category_id text, missing text[], title text, description text, attributes jsonb)
language sql stable security invoker set search_path = public as $$
  select l.listing_key, l.product_id, l.category_id, public.missing_attrs(l.last_error), p.title, left(coalesce(p.description, ''), 4000), coalesce(p.attributes, '{}'::jsonb)
  from public.marketplace_listings l
  join public.products p on p.id = l.product_id and p.status = 'active'
  left join public.ai_attr_runs r on r.product_id = l.product_id and r.marketplace = p_mp
  where l.marketplace = p_mp and l.status = 'error' and l.category_id is not null
    and l.last_error like 'zorunlu özellik doldurulamadı:%'
    and (r.at is null or r.at < now() - interval '7 days')
  order by l.updated_at
  limit greatest(1, least(p_limit, 500))
$$;
revoke execute on function public.ai_attr_candidates(text, int) from public, anon, authenticated;
