-- Yapay zekâ ile düzeltilmiş ürün açıklamaları (K, 28.10: "yapay zekâ %100 düzeltebilirse açıklamaları düzgün yazsın").
-- Taslak yalnızca tedarikçi metnindeki bilgilerle yazılır; kurallı kontroller + ikinci doğrulama çağrısından geçmezse "skipped".
-- Onaylanan (panel) açıklama yeni gönderimlerde ve canlı Trendyol ilanında (content-bulk-update) kullanılır.
-- products.description DEĞİŞMEZ: tedarikçi içe aktarması onu her turda yeniden yazar; asıl metin burada "original" olarak da durur.
create table if not exists public.product_descriptions (
  product_id uuid primary key references public.products (id) on delete cascade,
  source_hash text not null,                  -- md5(başlık | tedarikçi açıklaması): kaynak değişince onaysız taslak yeniden yazılır
  status text not null check (status in ('ready', 'approved', 'rejected', 'skipped')),
  draft text,                                 -- düzeltilmiş açıklama (sınırlı HTML: p, ul, li, strong, br)
  original text,                              -- taslak anındaki tedarikçi metni
  reason text,                                -- skipped nedeni / ret notu
  checks jsonb not null default '{}'::jsonb,  -- kontrol sonuçları
  model text,
  pushed jsonb not null default '{}'::jsonb,  -- {"trendyol": {"at": ..., "batch": ..., "listings": n}}
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index if not exists product_descriptions_status_idx on public.product_descriptions (status, updated_at);
alter table public.product_descriptions enable row level security; -- erişim yalnızca service_role
revoke all on public.product_descriptions from anon, authenticated;

-- Aday ürünler (sunucu tarafında, yalnızca p_limit satır döner): açıklaması başlıktan farklı ve en az 80 karakter olan aktif ürünler;
-- onaylı/reddedilmiş olanlar ve aynı kaynakla zaten değerlendirilmiş olanlar hariç. Trendyol'da satışta olanlar önce.
create or replace function public.desc_candidates(p_limit int default 20)
returns table (id uuid, title text, description text, brand text, category text, attributes jsonb, source_hash text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.title, p.description, p.brand, p.category, p.attributes, md5(coalesce(p.title, '') || '|' || coalesce(p.description, ''))
  from public.products p
  where p.status = 'active'
    and length(coalesce(p.description, '')) >= 80
    and lower(trim(p.description)) <> lower(trim(p.title))
    and not exists (
      select 1 from public.product_descriptions d where d.product_id = p.id
        and (d.status in ('approved', 'rejected') or d.source_hash = md5(coalesce(p.title, '') || '|' || coalesce(p.description, '')) or d.attempts >= 3)
    )
  order by exists (select 1 from public.marketplace_listings l where l.product_id = p.id and l.marketplace = 'trendyol' and l.status = 'live') desc, p.id
  limit greatest(1, least(p_limit, 200))
$$;
revoke execute on function public.desc_candidates(int) from public, anon, authenticated;

-- Panel sayıları (tek sorgu)
create or replace function public.desc_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'ready', count(*) filter (where status = 'ready'),
    'approved', count(*) filter (where status = 'approved'),
    'pushed', count(*) filter (where status = 'approved' and pushed ? 'trendyol'),
    'rejected', count(*) filter (where status = 'rejected'),
    'skipped', count(*) filter (where status = 'skipped'),
    'eligible', (select count(*) from public.products p where p.status = 'active' and length(coalesce(p.description, '')) >= 80 and lower(trim(p.description)) <> lower(trim(p.title))),
    'title_only', (select count(*) from public.products p where p.status = 'active' and lower(trim(coalesce(p.description, ''))) = lower(trim(p.title)))
  ) from public.product_descriptions
$$;
revoke execute on function public.desc_counts() from public, anon, authenticated;
