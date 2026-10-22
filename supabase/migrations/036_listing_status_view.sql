-- Panel: Pazaryeri > Gönderim durumu. Hata nedeni grupları, özet sayılar ve sayfalı liste (yalnızca service_role).
create or replace function public.listing_err_group(e text) returns text
language sql immutable set search_path = public as $$
  select case
    when e is null or e = '' then null
    when e ilike '%kategorisi yok%' then 'kategori'
    when e ilike '%zorunlu özellik%' then 'ozellik'
    when e ilike '%görsel%' or e ilike '%image%' then 'gorsel'
    when e ilike 'Marka riski%' then 'marka'
    when e ilike '%kopyası var%' then 'kopya'
    when e ilike 'Hepsiburada:%' or e ilike 'Trendyol:%' then 'pazaryeri'
    else 'diger' end
$$;

create or replace function public.listing_status_summary(p_mp text) returns jsonb
language sql stable security invoker set search_path = public as $$
  with l as (select status, mp_status, last_error from public.marketplace_listings where marketplace = p_mp),
  attrs as (
    select trim(a) as name, count(*) n
    from l, regexp_split_to_table(substring(l.last_error from 'zorunlu özellik doldurulamadı:\s*(.*)$'), ',') a
    where l.status = 'error' and l.last_error ilike '%zorunlu özellik%'
    group by 1 order by 2 desc limit 15)
  select jsonb_build_object(
    'status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from l group by 1) s),
    'mp_status', (select coalesce(jsonb_object_agg(mp_status, n), '{}'::jsonb) from (select mp_status, count(*) n from l where mp_status is not null group by 1) s),
    'groups', (select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) from (select public.listing_err_group(last_error) g, count(*) n from l where status in ('error', 'rejected') and last_error is not null group by 1) s),
    'attrs', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n)), '[]'::jsonb) from attrs))
$$;

create or replace function public.listing_status_list(p_mp text, p_status text, p_group text, p_q text, p_mp_status text, p_limit int, p_offset int)
returns table (listing_key text, product_id uuid, title text, status text, mp_status text, mp_reasons text, last_error text,
               price numeric, calc_net numeric, updated_at timestamptz, image text, err_group text, total bigint)
language sql stable security invoker set search_path = public as $$
  select l.listing_key, l.product_id, coalesce(p.title, l.title), l.status, l.mp_status, l.mp_reasons, l.last_error,
         l.price, l.calc_net, l.updated_at,
         (select i.url from public.product_images i where i.product_id = l.product_id order by i.position limit 1),
         public.listing_err_group(l.last_error), count(*) over ()
  from public.marketplace_listings l left join public.products p on p.id = l.product_id
  where l.marketplace = p_mp
    and (coalesce(p_status, '') = '' or l.status = p_status)
    and (coalesce(p_group, '') = '' or public.listing_err_group(l.last_error) = p_group)
    and (coalesce(p_mp_status, '') = '' or l.mp_status = p_mp_status)
    and (coalesce(p_q, '') = '' or l.listing_key ilike '%' || p_q || '%' or coalesce(p.title, l.title) ilike '%' || p_q || '%')
  order by l.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke execute on function public.listing_err_group(text) from public, anon, authenticated;
revoke execute on function public.listing_status_summary(text) from public, anon, authenticated;
revoke execute on function public.listing_status_list(text, text, text, text, text, int, int) from public, anon, authenticated;
