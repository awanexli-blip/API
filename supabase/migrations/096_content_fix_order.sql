-- 096: içerik düzeltme adayları önce çelişki işareti taşıyan metinlerden (değerli metal / hakiki deri / %100 kumaş iddiası, sonra birimli ölçü),
-- sonra yayındaki ilanlar (19.11 ilk 50 önizlemede yayın önceliği çelişkisiz ürünleri getirdi: 50/50 değişiklik yok).
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
  order by (p.description ~* '925|sterling|ayar (gümüş|altın)|(saf|som|hakiki|gerçek) (gümüş|altın)|hakiki deri|gerçek deri|%\s?100 (pamuk|polyester)') desc,
    (p.description ~* '\d\s*(cm|mm)?\s*[x×*]\s*\d+([.,]\d+)?\s*(cm|mm|m)') desc,
    exists (select 1 from public.marketplace_listings l where l.product_id = p.id and l.status = 'live') desc, p.id
  limit greatest(1, least(p_limit, 200))
$$;
revoke execute on function public.content_fix_candidates(int) from public, anon, authenticated;
