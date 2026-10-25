-- ai_attr_candidates zaman aşımı (HB 12 bin hatalı ilan): hatalı ilanlar için kısmi indeks, önce sınırla sonra ürünle birleştir (80 ms).
create index if not exists marketplace_listings_err_idx on public.marketplace_listings (marketplace, updated_at) where status = 'error';
create or replace function public.ai_attr_candidates(p_mp text, p_limit int default 150)
returns table (listing_key text, product_id uuid, category_id text, missing text[], title text, description text, attributes jsonb)
language sql stable security invoker set search_path = public as $$
  with l as (
    select l.listing_key, l.product_id, l.category_id, l.last_error, l.updated_at
    from public.marketplace_listings l
    where l.marketplace = p_mp and l.status = 'error' and l.category_id is not null
      and l.last_error like 'zorunlu özellik doldurulamadı:%'
      and not exists (select 1 from public.ai_attr_runs r where r.product_id = l.product_id and r.marketplace = p_mp and r.at > now() - interval '7 days')
    order by l.updated_at
    limit greatest(1, least(p_limit, 500))
  )
  select l.listing_key, l.product_id, l.category_id, public.missing_attrs(l.last_error), p.title, left(coalesce(p.description, ''), 4000), coalesce(p.attributes, '{}'::jsonb)
  from l join public.products p on p.id = l.product_id and p.status = 'active'
  order by l.updated_at
$$;
revoke execute on function public.ai_attr_candidates(text, int) from public, anon, authenticated;
