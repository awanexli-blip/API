-- Faz 1: merkezi ürün veritabanı, rol bazlı erişim, denetim kaydı.
-- Mevcut tablolara dokunmaz. Tekrar çalıştırmak güvenlidir.
-- Erişim yalnızca sunucu tarafında service_role ile (RLS açık, politika yok; fonksiyonlar anon/authenticated'a kapalı).

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (sku ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{2,64}$'),           -- model kodu
  title text not null check (char_length(title) between 2 and 300),
  description text not null default '',
  brand text not null default '',
  category text not null default '',                                          -- iç kategori (pazaryeri eşlemesi ayrı tabloda, Faz 4+)
  vat_rate numeric not null default 20 check (vat_rate in (0, 1, 10, 20)),
  desi numeric check (desi >= 0),
  cost_price numeric check (cost_price >= 0),                                 -- KDV dahil alış
  currency text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  attributes jsonb not null default '{}'::jsonb,
  source text not null default 'manual',                                      -- manual | csv | xml:<tedarikçi>
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);
create index if not exists products_status_idx on products (status, updated_at desc);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  sku text not null unique check (sku ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{2,64}$'),
  barcode text unique check (barcode is null or barcode ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$'),
  attributes jsonb not null default '{}'::jsonb,                              -- renk, beden...
  stock int not null default 0 check (stock >= 0),
  reserved int not null default 0 check (reserved >= 0 and reserved <= stock),-- Faz 6: sipariş rezervasyonu
  cost_price numeric check (cost_price >= 0),                                 -- boşsa ürünün maliyeti
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_variants_product_idx on product_variants (product_id, position);

create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  position int not null default 0,
  unique (product_id, position)
);

create table if not exists user_roles (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id, at desc);

alter table products enable row level security;
alter table product_variants enable row level security;
alter table product_images enable row level security;
alter table user_roles enable row level security;
alter table audit_log enable row level security;

create or replace function set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists products_updated_at on products;
create trigger products_updated_at before update on products for each row execute function set_updated_at();
drop trigger if exists product_variants_updated_at on product_variants;
create trigger product_variants_updated_at before update on product_variants for each row execute function set_updated_at();

-- Ürünün tam görüntüsü (denetim kaydı ve API için)
create or replace function product_snapshot(pid uuid) returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.position, v.created_at) from product_variants v where v.product_id = p.id), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(i.url order by i.position) from product_images i where i.product_id = p.id), '[]'::jsonb))
  from products p where p.id = pid
$$;

-- Oluştur / güncelle: ürün + varyantlar + görseller + denetim kaydı tek transaction
create or replace function product_save(payload jsonb, actor text) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid := nullif(payload->>'id', '')::uuid;
  before jsonb;
  v jsonb;
  pos int := 0;
  keep uuid[];
begin
  if jsonb_array_length(coalesce(payload->'variants', '[]'::jsonb)) = 0 then
    raise exception 'en az bir varyant gerekli' using errcode = '22023';
  end if;

  if pid is not null then
    before := product_snapshot(pid);
    if before is null then raise exception 'ürün bulunamadı' using errcode = 'P0002'; end if;
    update products set
      sku = payload->>'sku', title = payload->>'title', description = coalesce(payload->>'description', ''),
      brand = coalesce(payload->>'brand', ''), category = coalesce(payload->>'category', ''),
      vat_rate = coalesce((payload->>'vat_rate')::numeric, 20), desi = (payload->>'desi')::numeric,
      cost_price = (payload->>'cost_price')::numeric, currency = coalesce(payload->>'currency', 'TRY'),
      status = coalesce(payload->>'status', 'draft'), attributes = coalesce(payload->'attributes', '{}'::jsonb),
      updated_by = actor
    where id = pid;
  else
    insert into products (sku, title, description, brand, category, vat_rate, desi, cost_price, currency, status, attributes, source, source_ref, created_by, updated_by)
    values (payload->>'sku', payload->>'title', coalesce(payload->>'description', ''), coalesce(payload->>'brand', ''),
      coalesce(payload->>'category', ''), coalesce((payload->>'vat_rate')::numeric, 20), (payload->>'desi')::numeric,
      (payload->>'cost_price')::numeric, coalesce(payload->>'currency', 'TRY'), coalesce(payload->>'status', 'draft'),
      coalesce(payload->'attributes', '{}'::jsonb), coalesce(payload->>'source', 'manual'), payload->>'source_ref', actor, actor)
    returning id into pid;
  end if;

  -- Listede olmayan varyantlar silinir; id'li olanlar güncellenir; id'sizler eklenir
  select coalesce(array_agg((e->>'id')::uuid), '{}') into keep
    from jsonb_array_elements(payload->'variants') e where coalesce(e->>'id', '') <> '';
  delete from product_variants where product_id = pid and not (id = any (keep));
  for v in select * from jsonb_array_elements(payload->'variants') loop
    if coalesce(v->>'id', '') <> '' then
      update product_variants set sku = v->>'sku', barcode = nullif(v->>'barcode', ''),
        attributes = coalesce(v->'attributes', '{}'::jsonb), stock = coalesce((v->>'stock')::int, 0),
        cost_price = (v->>'cost_price')::numeric, position = pos
      where id = (v->>'id')::uuid and product_id = pid;
      if not found then raise exception 'varyant bu ürüne ait değil' using errcode = '22023'; end if;
    else
      insert into product_variants (product_id, sku, barcode, attributes, stock, cost_price, position)
      values (pid, v->>'sku', nullif(v->>'barcode', ''), coalesce(v->'attributes', '{}'::jsonb),
        coalesce((v->>'stock')::int, 0), (v->>'cost_price')::numeric, pos);
    end if;
    pos := pos + 1;
  end loop;

  delete from product_images where product_id = pid;
  insert into product_images (product_id, url, position)
    select pid, u.url, u.ord - 1 from jsonb_array_elements_text(coalesce(payload->'images', '[]'::jsonb)) with ordinality as u(url, ord);

  insert into audit_log (actor, action, entity, entity_id, before, after)
    values (actor, case when before is null then 'create' else 'update' end, 'product', pid::text, before, product_snapshot(pid));
  return pid;
end $$;

-- Silme açık bir işlemdir: varsayılan arşivle (geri alınabilir), hard = true kalıcı siler. İkisi de denetim kaydına yazılır.
create or replace function product_delete(pid uuid, hard boolean, actor text) returns void language plpgsql set search_path = public as $$
declare before jsonb := product_snapshot(pid);
begin
  if before is null then raise exception 'ürün bulunamadı' using errcode = 'P0002'; end if;
  if hard then delete from products where id = pid;
  else update products set status = 'archived', updated_by = actor where id = pid;
  end if;
  insert into audit_log (actor, action, entity, entity_id, before, after)
    values (actor, case when hard then 'delete' else 'archive' end, 'product', pid::text, before, case when hard then null else product_snapshot(pid) end);
end $$;

-- Tarayıcıdaki anon anahtarı fonksiyonları çağıramasın (RLS fonksiyonları korumaz)
revoke execute on function product_snapshot(uuid) from public, anon, authenticated;
revoke execute on function product_save(jsonb, text) from public, anon, authenticated;
revoke execute on function product_delete(uuid, boolean, text) from public, anon, authenticated;
grant execute on function product_snapshot(uuid) to service_role;
grant execute on function product_save(jsonb, text) to service_role;
grant execute on function product_delete(uuid, boolean, text) to service_role;
