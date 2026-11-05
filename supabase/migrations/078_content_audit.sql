-- 078 (05.11): içerik denetimi (K: "açıklaması yanlış olan, %80 altı doğruluktakileri araştır"). YALNIZCA SUNUCU veritabanı (Supabase'e eklenmez).
-- worker/content-audit.ts: başlık + kategori + özellikler + açıklama -> yapay zekâ çelişki listesi ve doğruluk puanı (0-100).
create table if not exists public.content_audit (
  product_id uuid primary key references public.products(id) on delete cascade,
  checked_at timestamptz not null default now(),
  score int,
  issues jsonb not null default '[]'::jsonb,
  toy boolean,
  model text,
  status text not null default 'new'   -- new | reviewed | fixed | ignored
);
create index if not exists content_audit_score_idx on public.content_audit (score);
alter table public.content_audit enable row level security;
notify pgrst, 'reload schema';

-- Aday: satıştaki ilanı olan aktif ürün (ilan ürüne bağlı ya da varyant barkodu = ilan anahtarı; toptancim kopyası bağsız), 30 günde denetlenmemiş.
-- İki ayrı eşleşme birleştirilir (tek birleştirmede "veya" koşulu dakikalar sürüyordu).
create or replace function public.content_audit_candidates(p_limit int)
returns table (id uuid, title text, description text, category text, attributes jsonb, mp_category text)
language sql stable as $$
  with live as (
    select l.product_id pid, l.category_name, l.stock from public.marketplace_listings l where l.status = 'live' and l.product_id is not null
    union all
    select v.product_id, l.category_name, l.stock from public.marketplace_listings l join public.product_variants v on v.barcode = l.listing_key
    where l.status = 'live' and l.product_id is null
  ), c as (
    select pid, max(category_name) mp_category, max(coalesce(stock, 0)) st from live group by pid
  )
  select p.id, p.title, p.description, p.category, p.attributes, c.mp_category
  from c join public.products p on p.id = c.pid
  where p.status = 'active' and not exists (select 1 from public.content_audit a where a.product_id = p.id and a.checked_at > now() - interval '30 days')
  order by c.st desc, p.id
  limit p_limit
$$;
notify pgrst, 'reload schema';
