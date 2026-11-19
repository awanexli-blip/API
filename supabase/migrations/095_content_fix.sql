-- 095: İçerik düzeltme (K 19.11: "yanlış istemiyorum, kesin olsun"). worker/content-fix.ts
-- Tedarikçi açıklamasındaki çelişkiler (malzeme, ürün tipi, ölçü) ve başka satıcılardan uzlaşmayla doğrulanmış özellikler.
-- Sonuçlar mevcut onay tablosuna (product_descriptions, panel Ürünler > Açıklamalar) "ready" olarak yazılır; K onaylamadan pazaryerine gitmez.
-- Onaylanan açıklama mevcut yolla gider (worker/core/descriptions.ts pushDescriptions, Trendyol içerik güncellemesi);
-- onaylanan özellikler `content-fix.ts apply` ile ürüne "<Özellik>@<pazaryeri>" olarak yazılır (yalnızca boş anahtarlar).
alter table public.product_descriptions add column if not exists kind text;                                   -- 'content-fix' (bu araç) / null (eski taslak)
alter table public.product_descriptions add column if not exists attr_proposals jsonb not null default '[]'::jsonb; -- [{mp, name, value, sources:[{url, host, seller, matchKind, quote}], supplierAgrees}]
alter table public.product_descriptions add column if not exists applied jsonb not null default '{}'::jsonb;     -- {"attrs": {"at", "written": n, "jobs": [...]}}

-- Hangi ürün hangi kaynak metinle denendi (değişiklik bulunmayanlar dahil): sürekli çalışmada kaldığı yerden devam, aynı metin iki kez denenmez
create table if not exists public.content_fix_seen (
  product_id uuid primary key references public.products (id) on delete cascade,
  source_hash text not null,
  checked_at timestamptz not null default now(),
  result text not null,                 -- 'degisiklik' | 'yok' | 'hata' | 'atlandi'
  summary jsonb not null default '{}'::jsonb
);
alter table public.content_fix_seen enable row level security;
revoke all on public.content_fix_seen from anon, authenticated;

-- Adaylar: aktif, görselli, açıklaması başlığın kopyası olmayan, K'nın kendi ürünü olmayan (manual) ürünler. Onay bekleyen / onaylı /
-- reddedilmiş açıklaması olan ve aynı kaynak metinle denenmiş olanlar hariç. Önce yayındaki ilanlar, sonra çelişki işareti taşıyan metinler.
create or replace function public.content_fix_candidates(p_limit int default 20)
returns table (id uuid, title text, description text, category text, brand text, source text, attributes jsonb, source_hash text, image_url text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.title, p.description, p.category, p.brand, p.source, p.attributes, md5(coalesce(p.title, '') || '|' || coalesce(p.description, '')),
    (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1)
  from public.products p
  where p.status = 'active' and coalesce(p.source, '') <> 'manual'
    and length(coalesce(p.description, '')) > 20 and lower(trim(p.description)) <> lower(trim(p.title))
    and exists (select 1 from public.product_images i where i.product_id = p.id)
    and not exists (select 1 from public.product_descriptions d where d.product_id = p.id and d.status in ('ready', 'approved', 'rejected'))
    and not exists (select 1 from public.content_fix_seen s where s.product_id = p.id and s.source_hash = md5(coalesce(p.title, '') || '|' || coalesce(p.description, '')))
  order by exists (select 1 from public.marketplace_listings l where l.product_id = p.id and l.status = 'live') desc,
    (p.description ~* '\d\s*[x×*]\s*\d|925|ayar|gümüş|gumus|altın|malzeme|hakiki|%\s?100') desc, p.id
  limit greatest(1, least(p_limit, 200))
$$;
revoke execute on function public.content_fix_candidates(int) from public, anon, authenticated;

-- Kapatma anahtarı: sürekli çalışma yalnızca {"enabled":true} iken (K ilk 50'lik önizlemeyi onayladıktan sonra panelden açılır)
insert into public.app_state (key, value) values ('content_fix', '{"enabled":false}') on conflict (key) do nothing;
