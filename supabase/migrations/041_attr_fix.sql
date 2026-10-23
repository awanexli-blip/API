-- Toplu özellik tamamlama (Pazaryeri > Özellik tamamla): eksik zorunlu özellik + kategori grupları, pazaryerinin değer listesi,
-- seçilen değerin ürünlere yazılması ve eksiği kalmayan ilanların yeniden gönderim kuyruğuna alınması. Yalnızca service_role.
create table if not exists public.attr_options (
  marketplace text not null,
  category_id text not null,
  name text not null,
  values jsonb not null default '[]'::jsonb,   -- pazaryerinin kabul ettiği değerler (boşsa serbest metin)
  allow_custom boolean not null default false,
  category_name text,
  updated_at timestamptz not null default now(),
  primary key (marketplace, category_id, name)
);
alter table public.attr_options enable row level security;

-- Hata metninden eksik özellik adları ("zorunlu özellik doldurulamadı: A, B")
create or replace function public.missing_attrs(e text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(trim(x)) filter (where trim(x) <> ''), '{}')
  from regexp_split_to_table(coalesce(substring(e from 'zorunlu özellik doldurulamadı:\s*(.*)$'), ''), ',') x
$$;

-- Gruplar: kategori + özellik, ürün kaydında henüz değeri olmayanlar
create or replace function public.attr_fix_groups(p_mp text)
returns table (category_id text, name text, n bigint, category_name text, sample text, has_options boolean)
language sql stable security invoker set search_path = public as $$
  with m as (
    select l.category_id, a.name, l.product_id, coalesce(p.title, l.title) title
    from public.marketplace_listings l
    join public.products p on p.id = l.product_id
    cross join lateral unnest(public.missing_attrs(l.last_error)) as a(name)
    where l.marketplace = p_mp and l.status = 'error' and l.last_error ilike '%zorunlu özellik%'
      and not (coalesce(p.attributes, '{}'::jsonb) ? a.name)
  )
  select m.category_id, m.name, count(distinct m.product_id), max(o.category_name), min(m.title), bool_or(o.name is not null)
  from m left join public.attr_options o on o.marketplace = p_mp and o.category_id = m.category_id and o.name = m.name
  group by m.category_id, m.name
  order by 3 desc
$$;

-- Bir grubun ürünleri
create or replace function public.attr_fix_items(p_mp text, p_cat text, p_name text, p_limit int default 300)
returns table (product_id uuid, listing_key text, title text, image text, missing text[])
language sql stable security invoker set search_path = public as $$
  select distinct on (l.product_id) l.product_id, l.listing_key, coalesce(p.title, l.title),
    (select i.url from public.product_images i where i.product_id = p.id order by i.position limit 1), public.missing_attrs(l.last_error)
  from public.marketplace_listings l join public.products p on p.id = l.product_id
  where l.marketplace = p_mp and l.status = 'error' and l.category_id = p_cat and p_name = any(public.missing_attrs(l.last_error))
    and not (coalesce(p.attributes, '{}'::jsonb) ? p_name)
  order by l.product_id
  limit least(greatest(coalesce(p_limit, 300), 1), 1000)
$$;

-- Değeri yaz; bu pazaryerinde eksiği kalmayan ilanları sıraya al ve gönderim işi oluştur (100'lük)
create or replace function public.attr_fix_apply(p_mp text, p_name text, p_value text, p_ids uuid[], p_by text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_upd int; v_ready uuid[]; v_now timestamptz := now(); v_jobs int := 0; i int;
begin
  if coalesce(trim(p_value), '') = '' or array_length(p_ids, 1) is null then return jsonb_build_object('error', 'değer ve ürün gerekli'); end if;
  update public.products set attributes = coalesce(attributes, '{}'::jsonb) || jsonb_build_object(p_name, left(trim(p_value), 100)), updated_at = v_now
    where id = any(p_ids);
  get diagnostics v_upd = row_count;
  select coalesce(array_agg(distinct l.product_id), '{}') into v_ready
  from public.marketplace_listings l join public.products p on p.id = l.product_id
  where l.marketplace = p_mp and l.status = 'error' and l.product_id = any(p_ids)
    and not exists (select 1 from unnest(public.missing_attrs(l.last_error)) a(n) where not (p.attributes ? a.n));
  if array_length(v_ready, 1) is not null then
    update public.marketplace_listings set status = 'queued', last_error = null, updated_at = v_now
      where marketplace = p_mp and status = 'error' and product_id = any(v_ready);
    i := 1;
    while i <= array_length(v_ready, 1) loop
      insert into public.jobs (type, marketplace, payload, idempotency_key, created_by)
      values ('send_products:' || p_mp, p_mp, jsonb_build_object('product_ids', to_jsonb(v_ready[i:i + 99])), 'attrfix:' || p_mp || ':' || v_now::text || ':' || i, p_by);
      v_jobs := v_jobs + 1; i := i + 100;
    end loop;
  end if;
  return jsonb_build_object('updated', v_upd, 'requeued', coalesce(array_length(v_ready, 1), 0), 'jobs', v_jobs);
end $$;

revoke execute on function public.missing_attrs(text) from public, anon, authenticated;
revoke execute on function public.attr_fix_groups(text) from public, anon, authenticated;
revoke execute on function public.attr_fix_items(text, text, text, int) from public, anon, authenticated;
revoke execute on function public.attr_fix_apply(text, text, text, uuid[], text) from public, anon, authenticated;
