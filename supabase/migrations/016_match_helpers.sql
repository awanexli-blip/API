-- Amazon toplu eşleştirme yardımcıları (panel: Pazaryerleri → Amazon → Eşleştirme)
-- Eşleşmesi aranmamış (hiç adayı/onayı olmayan), aktif ve stoklu ürünler
create or replace function products_unmatched(mp text, lim int) returns setof uuid language sql stable set search_path = public as $$
  select p.id from products p
  where p.status = 'active'
    and exists (select 1 from product_variants v where v.product_id = p.id and v.stock > 0)
    and not exists (select 1 from marketplace_matches m where m.product_id = p.id and m.marketplace = mp and m.status <> 'rejected')
    and not exists (select 1 from marketplace_listings l where l.product_id = p.id and l.marketplace = mp)
  order by p.updated_at desc
  limit greatest(1, least(lim, 1000))
$$;
-- Onaylı eşleşmesi olan ama pazaryerinde ilanı olmayan (veya hata almış) ürünler
create or replace function products_confirmed_unlisted(mp text, lim int) returns setof uuid language sql stable set search_path = public as $$
  select distinct m.product_id from marketplace_matches m
  where m.marketplace = mp and m.status = 'confirmed' and m.product_id is not null
    and not exists (select 1 from marketplace_listings l where l.product_id = m.product_id and l.marketplace = mp and l.status in ('queued','sent','pending_approval','live'))
  limit greatest(1, least(lim, 200))
$$;
-- Eşleştirme sayıları
create or replace function match_stats(mp text) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'confirmed', (select count(distinct variant_id) from marketplace_matches where marketplace = mp and status = 'confirmed'),
    'suggested', (select count(distinct variant_id) from marketplace_matches m where marketplace = mp and status = 'suggested' and not exists (select 1 from marketplace_matches c where c.variant_id = m.variant_id and c.marketplace = mp and c.status = 'confirmed')),
    'listed', (select count(*) from marketplace_listings where marketplace = mp and status in ('sent','pending_approval','live')),
    'queued_jobs', (select count(*) from jobs where type = 'match_products:' || mp and status in ('queued','running'))
  )
$$;
revoke execute on function products_unmatched(text, int) from public, anon, authenticated;
revoke execute on function products_confirmed_unlisted(text, int) from public, anon, authenticated;
revoke execute on function match_stats(text) from public, anon, authenticated;
grant execute on function products_unmatched(text, int) to service_role;
grant execute on function products_confirmed_unlisted(text, int) to service_role;
grant execute on function match_stats(text) to service_role;
