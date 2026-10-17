-- Toplu ürün güncelleme (durum / marka / kategori), her ürün için denetim kaydı. Silme toplu yapılmaz (açık işlem).
create or replace function product_bulk_update(ids uuid[], patch jsonb, actor text) returns int
language plpgsql set search_path = public as $$
declare pid uuid; before jsonb; n int := 0;
begin
  if array_length(ids, 1) > 1000 then raise exception 'en fazla 1000 ürün' using errcode = '22023'; end if;
  foreach pid in array ids loop
    before := product_snapshot(pid);
    if before is null then continue; end if;
    update products set
      status = coalesce(patch->>'status', status),
      brand = coalesce(patch->>'brand', brand),
      category = coalesce(patch->>'category', category),
      updated_by = actor
    where id = pid;
    insert into audit_log (actor, action, entity, entity_id, before, after)
      values (actor, 'bulk_update', 'product', pid::text, before, product_snapshot(pid));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function product_bulk_update(uuid[], jsonb, text) from public, anon, authenticated;
grant execute on function product_bulk_update(uuid[], jsonb, text) to service_role;

-- Liste, filtre ve denetim sorguları için indeksler
create index if not exists products_source_idx on products (source);
create index if not exists products_status_updated_idx on products (status, updated_at desc);
create index if not exists product_variants_product_idx on product_variants (product_id);
create index if not exists product_images_product_idx on product_images (product_id);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id, at desc);

-- Ürün formu seçenekleri: marka (sayılı) ve kategori listesi (satır sınırına takılmadan)
create or replace function product_facets() returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'brands', coalesce((select jsonb_agg(jsonb_build_array(brand, n) order by n desc) from (select brand, count(*) n from products where brand <> '' group by brand order by n desc limit 300) b), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(category order by category) from (select distinct category from products where category <> '' limit 5000) c), '[]'::jsonb)
  )
$$;
revoke execute on function product_facets() from public, anon, authenticated;
grant execute on function product_facets() to service_role;
