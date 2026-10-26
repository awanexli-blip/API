-- Yeni (boş) Supabase projesi için tüm şema: schema.sql + migrations/* sırayla. SQL Editor'e yapıştırıp bir kez çalıştır.

-- ===== schema.sql =====
-- Supabase > SQL Editor'e yapıştırıp çalıştır.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  commission_rate numeric not null default 0.18,
  target_profit_rate numeric not null default 0.15,
  shipping_cost numeric not null default 90,
  free_shipping_threshold numeric not null default 300,
  min_markup numeric not null default 1.3,
  fixed_cost numeric not null default 0,
  min_acceptable_profit_rate numeric not null default 0.08,
  max_price numeric not null default 10000,
  min_stock int not null default 3,
  vat_rate numeric not null default 20,
  fx_usd numeric not null default 0,
  fx_eur numeric not null default 0,
  auto_sync boolean not null default true,
  auto_create boolean not null default false,
  update_prices boolean not null default true,
  zero_missing boolean not null default false,
  existing_price_policy text not null default 'floor',
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists category_map (
  xml_category text primary key,
  category_id bigint not null,
  commission_rate numeric,
  vat_rate numeric,
  attributes jsonb not null default '[]'
);

create table if not exists product_overrides (
  barcode text primary key,
  price_override numeric,
  hidden boolean not null default false,
  note text
);

create table if not exists unmapped_categories (
  xml_category text primary key,
  product_count int not null
);

create table if not exists sync_runs (
  id bigserial primary key,
  mode text not null,
  trigger text,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);

-- Tüm erişim sunucu tarafında service_role ile yapılır; anon anahtarı hiçbir tabloyu okuyamaz.
alter table settings enable row level security;
alter table category_map enable row level security;
alter table product_overrides enable row level security;
alter table unmapped_categories enable row level security;
alter table sync_runs enable row level security;

-- Daha önce bu dosyayı çalıştırdıysan sadece şunu çalıştır:
alter table settings add column if not exists existing_price_policy text not null default 'floor';


-- ===== migrations/002_marketplaces.sql =====
-- Çoklu pazaryeri: pazaryeri bazlı ayarlar ve tablolara "marketplace" kolonu.
-- Supabase > SQL Editor'e yapıştırıp çalıştır. Tekrar çalıştırmak güvenlidir.
-- Trendyol ayarları "settings" tablosunda kalır; diğer pazaryerleri ortak ayarları "settings"ten alır,
-- burada dolu olan alanlar onları ezer.

create table if not exists marketplace_settings (
  marketplace text primary key,
  enabled boolean not null default false,
  auto_sync boolean not null default false,
  auto_create boolean not null default false,
  zero_missing boolean not null default false,
  existing_price_policy text not null default 'smart',
  commission_rate numeric,               -- varsayılan komisyon (kategori/ürün oranı yoksa)
  target_profit_rate numeric,
  shipping_cost numeric,                 -- shipping_mode = fixed iken
  free_shipping_threshold numeric,       -- bu fiyat ve üstünde kargo satıcıda; 0 = her zaman satıcı öder
  shipping_mode text not null default 'fixed',   -- fixed | desi
  cargo_carrier text,                    -- shipping_mode = desi iken tarifedeki firma (örn. hepsiJET)
  default_desi numeric not null default 2,       -- XML'de desi yoksa
  shipping_vat_included boolean not null default true,
  commission_plus_vat boolean not null default true,
  min_stock int,
  max_price numeric,
  fixed_cost numeric,
  min_acceptable_profit_rate numeric,
  updated_at timestamptz not null default now()
);
alter table marketplace_settings enable row level security;

-- Hepsiburada: komisyon +KDV, kargo desi tarifesiyle (KDV hariç) ve her siparişte satıcıda,
-- stok yetersizliğinden iptal cezası yüksek olduğu için minimum stok 5. Kullanıcı onaylayınca panelden değiştirilir.
insert into marketplace_settings (marketplace, enabled, commission_rate, free_shipping_threshold, shipping_mode, cargo_carrier,
  shipping_vat_included, commission_plus_vat, min_stock)
values ('hepsiburada', true, 0.18, 0, 'desi', 'hepsiJET', false, true, 5)
on conflict (marketplace) do nothing;

-- Trendyol komisyonu +KDV mi? (kullanıcı faturadan doğrulayınca panelden açılır)
alter table settings add column if not exists commission_plus_vat boolean not null default false;

-- Kategori eşleşmeleri, ürün istisnaları, eşleşmeyen kategoriler ve geçmiş pazaryerine göre
alter table category_map add column if not exists marketplace text not null default 'trendyol';
alter table category_map drop constraint if exists category_map_pkey;
alter table category_map add primary key (marketplace, xml_category);

alter table product_overrides add column if not exists marketplace text not null default 'trendyol';
alter table product_overrides drop constraint if exists product_overrides_pkey;
alter table product_overrides add primary key (marketplace, barcode);

alter table unmapped_categories add column if not exists marketplace text not null default 'trendyol';
alter table unmapped_categories drop constraint if exists unmapped_categories_pkey;
alter table unmapped_categories add primary key (marketplace, xml_category);
-- Kategori önerisi (worker, benzer ilanlardan): panelde "Öneriyi kullan"
alter table unmapped_categories add column if not exists suggested_category_id bigint;
alter table unmapped_categories add column if not exists suggested_category_name text;
alter table unmapped_categories add column if not exists suggested_share numeric;      -- ürünlerin ne kadarı bu kategoriye oy verdi
alter table unmapped_categories add column if not exists suggested_commission numeric;

alter table sync_runs add column if not exists marketplace text not null default 'trendyol';
create index if not exists sync_runs_marketplace_id on sync_runs (marketplace, id desc);

-- Pazaryerinin reddettiği ürün açma denemeleri: aynı ürün 24 saat boyunca tekrar gönderilmez
create table if not exists create_failures (
  marketplace text not null,
  barcode text not null,
  reason text,
  tries int not null default 1,
  last_at timestamptz not null default now(),
  primary key (marketplace, barcode)
);
alter table create_failures enable row level security;


-- ===== migrations/003_products.sql =====
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


-- ===== migrations/004_category_name.sql =====
-- Kategori eşleşmesinde pazaryeri kategori adı (panelde ID yerine ad gösterilir)
alter table category_map add column if not exists category_name text;


-- ===== migrations/005_product_images_bucket.sql =====
-- Ürün görselleri için Supabase Storage alanı.
-- Herkese açık okuma: pazaryerleri görseli bu adresten indirir. Yükleme yalnızca sunucudan (service_role, /api/products/images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;


-- ===== migrations/006_brand_settings.sql =====
-- Yeni ürünlerin markası panelden seçilir; önceki seçimler geri alınabilsin diye geçmiş tutulur.
-- Boş brand_name = ortam değişkeni TRENDYOL_BRAND_NAME veya "Eco Lounge".
alter table marketplace_settings add column if not exists brand_name text;
alter table marketplace_settings add column if not exists brand_history jsonb not null default '[]'::jsonb;


-- ===== migrations/007_marketplace_brands.sql =====
-- Pazaryerlerinin marka listesi (önbellek). Ürün formunda marka yazınca öneri + "pazaryerinde var mı" kontrolü.
-- Doldurma: worker/brands.ts (.github/workflows/brands.yml, haftalık + elle).
create table if not exists marketplace_brands (
  marketplace text not null,
  brand_id bigint not null,
  name text not null,
  name_norm text not null,          -- küçük harf, Türkçe harfler sadeleştirilmiş (arama için)
  updated_at timestamptz not null default now(),
  primary key (marketplace, brand_id)
);
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index if not exists marketplace_brands_name_trgm on marketplace_brands using gin (name_norm extensions.gin_trgm_ops);
alter table marketplace_brands enable row level security; -- erişim yalnızca service_role


-- ===== migrations/008_import_feeds.sql =====
-- Faz 2: CSV/Excel ve XML içe aktarma (satır bazlı hata raporu), XML feed dışa aktarma.

-- İçerik özeti (stok hariç): değişmeyen ürün tekrar yazılmaz, denetim kaydı şişmez
alter table products add column if not exists source_hash text;

create table if not exists import_jobs (
  id bigserial primary key,
  kind text not null check (kind in ('csv', 'xml')),
  source text not null default '',                 -- dosya adı veya "xml:bayilik"
  mode text not null default 'upsert' check (mode in ('create', 'update', 'upsert')),
  dry_run boolean not null default false,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  total int not null default 0,
  created int not null default 0,
  updated int not null default 0,
  stock_only int not null default 0,
  unchanged int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  message text,
  created_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Yalnızca hatalı / atlanan satırlar (ve CSV'de tüm satırlar) tutulur
create table if not exists import_rows (
  job_id bigint not null references import_jobs (id) on delete cascade,
  row_no int not null,
  sku text,
  status text not null,                            -- created | updated | stock | unchanged | skipped | error
  errors jsonb,                                    -- { alan: mesaj }
  product_id uuid,
  primary key (job_id, row_no)
);

create table if not exists feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  token text not null unique,                      -- adres: /api/feed/<token>  (gizli, yenilenebilir)
  price_mode text not null default 'none' check (price_mode in ('none', 'cost', 'formula')),
  only_in_stock boolean not null default false,
  source_filter text,                              -- null = hepsi, ör. 'manual' | 'xml:bayilik'
  created_by text,
  created_at timestamptz not null default now(),
  last_access_at timestamptz,
  access_count int not null default 0
);

alter table import_jobs enable row level security;
alter table import_rows enable row level security;
alter table feeds enable row level security;

-- Tek ürün içe aktarma. payload'da olmayan alanlar mevcut değerini korur.
-- opts: { mode: create|update|upsert, hash, keep_missing_variants: bool, source }
-- Dönüş: { action: created|updated|stock|unchanged|skipped|error, id, error }
create or replace function product_import(payload jsonb, actor text, opts jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  ex products%rowtype;
  snap jsonb;
  vars jsonb;
  merged jsonb;
  pid uuid;
  h text := opts->>'hash';
  m text := coalesce(opts->>'mode', 'upsert');
  n int;
begin
  select * into ex from products where sku = payload->>'sku';
  if not found then
    if m = 'update' then return jsonb_build_object('action', 'skipped', 'error', 'ürün yok (yalnızca güncelleme modu)'); end if;
    pid := product_save((payload - 'id') || jsonb_build_object('source', coalesce(opts->>'source', payload->>'source', 'manual')), actor);
    update products set source_hash = h where id = pid;
    return jsonb_build_object('action', 'created', 'id', pid);
  end if;
  if m = 'create' then return jsonb_build_object('action', 'skipped', 'id', ex.id, 'error', 'bu SKU zaten var (yalnızca ekleme modu)'); end if;

  -- İçerik aynı: yalnızca stok farkı varsa stok güncellenir (denetim kaydı yok; fiyat/içerik değişikliği her zaman kayıtlı)
  if h is not null and ex.source_hash is not distinct from h then
    update product_variants pv set stock = (e->>'stock')::int, updated_at = now()
      from jsonb_array_elements(coalesce(payload->'variants', '[]'::jsonb)) e
      where pv.product_id = ex.id and pv.sku = e->>'sku' and e ? 'stock'
        and pv.stock is distinct from (e->>'stock')::int and (e->>'stock')::int >= pv.reserved;
    get diagnostics n = row_count;
    return jsonb_build_object('action', case when n > 0 then 'stock' else 'unchanged' end, 'id', ex.id);
  end if;

  snap := product_snapshot(ex.id);
  -- Varyantlar SKU ile eşleşir (mevcut id korunur, rezerve stok kaybolmaz)
  if payload ? 'variants' then
    select coalesce(jsonb_agg(case when v.id is not null then (to_jsonb(v) - 'product_id' - 'created_at' - 'updated_at') || e || jsonb_build_object('id', v.id) else e end order by o), '[]'::jsonb)
      into vars
      from jsonb_array_elements(payload->'variants') with ordinality as x(e, o)
      left join product_variants v on v.product_id = ex.id and v.sku = x.e->>'sku';
    if coalesce((opts->>'keep_missing_variants')::boolean, false) then
      select vars || coalesce(jsonb_agg(sv), '[]'::jsonb) into vars
        from jsonb_array_elements(snap->'variants') sv
        where not exists (select 1 from jsonb_array_elements(payload->'variants') e where e->>'sku' = sv->>'sku');
    end if;
  else
    vars := snap->'variants';
  end if;

  merged := snap || (payload - 'variants' - 'images' - 'id') || jsonb_build_object('id', ex.id, 'variants', vars);
  -- Görsel gelmediyse mevcutlar kalır
  if jsonb_array_length(coalesce(payload->'images', '[]'::jsonb)) > 0 then merged := merged || jsonb_build_object('images', payload->'images'); end if;

  pid := product_save(merged, actor);
  update products set source_hash = h where id = pid;
  return jsonb_build_object('action', 'updated', 'id', pid);
end $$;

-- Toplu: her satır kendi alt transaction'ında; hatalı satır diğerlerini bozmaz
create or replace function product_import_batch(items jsonb, actor text, opts jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  it jsonb;
  out jsonb := '[]'::jsonb;
  r jsonb;
begin
  for it in select * from jsonb_array_elements(items) loop
    begin
      r := product_import(it->'payload', actor, opts || jsonb_build_object('hash', it->>'hash'));
    exception when others then
      r := jsonb_build_object('action', 'error', 'error', sqlerrm, 'code', sqlstate);
    end;
    out := out || jsonb_build_array(r || jsonb_build_object('row', it->'row', 'sku', it->'payload'->>'sku'));
  end loop;
  return out;
end $$;

revoke execute on function product_import(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function product_import_batch(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function product_import(jsonb, text, jsonb) to service_role;
grant execute on function product_import_batch(jsonb, text, jsonb) to service_role;


-- ===== migrations/009_suppliers.sql =====
-- Çoklu tedarikçi: her tedarikçinin XML adresi ve alan eşlemesi. Ürünler "xml:<code>" kaynağıyla products'a girer.
-- xml_url yalnızca sunucuda okunur (RLS, service_role); tarayıcıya maskelenmiş gider.
-- url_from_env: adres ortam değişkeninden (BayilikXML için GitHub Secret XML_URL).
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 1 and 80),
  xml_url text,
  url_from_env text,
  active boolean not null default true,
  nightly boolean not null default false,          -- gece içe aktarmaya dahil
  item_path text,                                  -- ürün listesinin yolu (boş = otomatik bul)
  mapping jsonb not null default '{}'::jsonb,      -- { "xml.alan.yolu": "model" | "title" | ... } (lib/import.ts Field)
  sku_prefix text not null default '' check (sku_prefix ~ '^[A-Za-z0-9._-]{0,12}$'),
  sku_ascii boolean not null default true,         -- SKU'dan Türkçe/özel karakterleri at
  price_includes_vat boolean not null default true,
  default_vat int not null default 20 check (default_vat in (0, 1, 10, 20)),
  default_brand text not null default '',          -- XML'de marka yoksa / kullanılmayacaksa
  currency text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table suppliers enable row level security;
alter table import_jobs add column if not exists supplier text;

insert into suppliers (code, name, url_from_env, nightly, mapping, sku_prefix, sku_ascii, default_brand)
values ('bayilik', 'BayilikXML', 'XML_URL', false,
  '{"productCode":"model","name":"title","detail":"description","category":"category","price":"cost_price","currency":"currency","quantity":"stock","barcode":"barcode","desi":"desi","image1":"images","image2":"images","image3":"images","image4":"images","image5":"images","image6":"images","image7":"images","image8":"images","image9":"images","image10":"images","image11":"images","image12":"images"}',
  '', true, 'Eco Lounge')
on conflict (code) do nothing;


-- ===== migrations/010_pricing_rules.sql =====
-- Akıllı kâr kuralları (worker/pricing-rules.ts). Sırayla uygulanır; eşleşen kural doldurduğu alanları ezer.
-- marketplace: 'all' veya pazaryeri kodu. cond: { cost_min, cost_max, supplier, category, brand, stock_max }
create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null default 'all',
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  enabled boolean not null default true,
  cond jsonb not null default '{}'::jsonb,
  target_profit_rate numeric check (target_profit_rate is null or (target_profit_rate >= 0 and target_profit_rate <= 0.6)),
  min_net_profit numeric check (min_net_profit is null or (min_net_profit >= 0 and min_net_profit <= 100000)),
  add_profit_rate numeric check (add_profit_rate is null or (add_profit_rate >= -0.3 and add_profit_rate <= 0.3)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table pricing_rules enable row level security;


-- ===== migrations/011_bulk_indexes.sql =====
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


-- ===== migrations/012_return_costs.sql =====
-- İade gideri fiyat formülüne girer: sipariş başı beklenen gider = iade oranı × iade başına maliyet (worker/pricing.ts returnsOf)
-- Varsayılan 0: mevcut fiyatlar kendiliğinden değişmez; değerler panelden (Fiyat ayarları) girilir.
alter table settings add column if not exists return_rate numeric not null default 0 check (return_rate >= 0 and return_rate <= 0.5);
alter table settings add column if not exists return_cost numeric not null default 0 check (return_cost >= 0 and return_cost <= 2000);
alter table marketplace_settings add column if not exists return_rate numeric check (return_rate is null or (return_rate >= 0 and return_rate <= 0.5));
alter table marketplace_settings add column if not exists return_cost numeric check (return_cost is null or (return_cost >= 0 and return_cost <= 2000));


-- ===== migrations/013_listings_jobs.sql =====
-- Faz 3: pazaryeri ilan tablosu ve iş kuyruğu.

-- Pazaryerindeki her ilan (Trendyol'da barkod başına). Worker her senkronda günceller.
-- Ürün pazaryerinde doğrulanmadan "live" sayılmaz: status yalnızca pazaryerinden okunan duruma göre yazılır.
create table if not exists marketplace_listings (
  marketplace text not null,
  listing_key text not null,                         -- pazaryerindeki anahtar (Trendyol: barkod)
  variant_id uuid references product_variants (id) on delete set null,
  product_id uuid references products (id) on delete set null,
  status text not null check (status in ('queued', 'sent', 'pending_approval', 'rejected', 'live', 'closed', 'error', 'gone')),
  title text,
  price numeric,
  stock int,
  commission numeric,
  category_id text,
  category_name text,
  last_error text,
  seen_at timestamptz not null default now(),        -- son senkronda görüldüğü an
  updated_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
create index if not exists marketplace_listings_variant_idx on marketplace_listings (variant_id);
create index if not exists marketplace_listings_product_idx on marketplace_listings (product_id);
create index if not exists marketplace_listings_status_idx on marketplace_listings (marketplace, status);

-- İş kuyruğu: idempotent anahtar, yeniden deneme (artan bekleme), kilit (aynı işi iki çalışan almaz)
create table if not exists jobs (
  id bigserial primary key,
  type text not null,
  marketplace text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  result jsonb,
  last_error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_ready_idx on jobs (status, run_after);

alter table marketplace_listings enable row level security;
alter table jobs enable row level security;

-- Sıradaki işleri kilitleyerek al (FOR UPDATE SKIP LOCKED). 30 dk'dan eski "running" kilitleri yarıda kalmış sayılır.
create or replace function job_claim(worker text, kinds text[], max_n int default 10) returns setof jobs
language plpgsql set search_path = public as $$
begin
  update jobs set status = 'queued', locked_by = null, locked_at = null, last_error = coalesce(last_error, '') || ' [kilit zaman aşımı]'
    where status = 'running' and locked_at < now() - interval '30 minutes';
  return query
    update jobs j set status = 'running', locked_by = worker, locked_at = now(), attempts = j.attempts + 1, updated_at = now()
    where j.id in (
      select id from jobs where status = 'queued' and run_after <= now() and (kinds is null or type = any (kinds))
      order by run_after, id limit max_n for update skip locked)
    returning j.*;
end $$;

-- İş sonucu: başarı -> done; hata -> deneme hakkı varsa artan beklemeyle tekrar kuyruğa (1, 4, 9, 16 dk...), yoksa failed
create or replace function job_finish(job_id bigint, ok boolean, res jsonb, err text) returns void
language plpgsql set search_path = public as $$
declare j jobs%rowtype;
begin
  select * into j from jobs where id = job_id for update;
  if not found then return; end if;
  if ok then
    update jobs set status = 'done', result = res, last_error = null, locked_by = null, updated_at = now() where id = job_id;
  elsif j.attempts >= j.max_attempts then
    update jobs set status = 'failed', result = res, last_error = left(err, 2000), locked_by = null, updated_at = now() where id = job_id;
  else
    update jobs set status = 'queued', result = res, last_error = left(err, 2000), locked_by = null,
      run_after = now() + make_interval(mins => j.attempts * j.attempts), updated_at = now() where id = job_id;
  end if;
end $$;

revoke execute on function job_claim(text, text[], int) from public, anon, authenticated;
revoke execute on function job_finish(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function job_claim(text, text[], int) to service_role;
grant execute on function job_finish(bigint, boolean, jsonb, text) to service_role;

-- İlanı ürün veritabanındaki varyanta bağla. Trendyol barkodu = "ÖS13-"/"OS13-" + ürün kodu (ASCII) = BayilikXML varyant SKU'su.
-- Diğer tedarikçilerin ürünleri Faz 4'te panelden gönderilince bağlanır (gönderimde variant_id yazılır).
create or replace function listings_link(mp text) returns int language plpgsql set search_path = public as $$
declare n int;
begin
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v join products p on p.id = v.product_id
  where ml.marketplace = mp and ml.variant_id is null and p.source = 'xml:bayilik'
    and v.sku = regexp_replace(ml.listing_key, '^(ÖS13-|OS13-)', '');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function listings_link(text) from public, anon, authenticated;
grant execute on function listings_link(text) to service_role;


-- ===== migrations/014_amazon_matches.sql =====
-- Amazon (ve ileride katalog eşleşmesi gerektiren pazaryerleri): ürün varyantı <-> pazaryerindeki var olan ürün (ASIN).
-- EAN ile tek sonuç bulunursa otomatik "confirmed"; başlıkla bulunan adaylar "suggested" -> panelden onay.
create table if not exists marketplace_matches (
  id bigserial primary key,
  marketplace text not null,
  variant_id uuid not null references product_variants (id) on delete cascade,
  product_id uuid references products (id) on delete cascade,
  external_id text not null,                 -- Amazon: ASIN
  title text,
  brand text,
  image text,
  matched_by text not null check (matched_by in ('ean', 'keyword', 'manual')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, variant_id, external_id)
);
create index if not exists marketplace_matches_product_idx on marketplace_matches (product_id);
alter table marketplace_matches enable row level security;

-- Amazon ayarları (kapalı başlar; kimlik bilgileri girilince panelden açılır). Satıcı kargoyu her siparişte öder (eşik 0).
insert into marketplace_settings (marketplace, enabled, auto_sync, auto_create, commission_rate, free_shipping_threshold, shipping_cost, existing_price_policy)
values ('amazon', false, false, false, 0.15, 0, 90, 'smart')
on conflict (marketplace) do nothing;


-- ===== migrations/015_squeeze_min_net.sql =====
-- 300 TL kargo eşiğinin altına (299,90) çekerken kabul edilen en az net kâr (TL).
-- Doluysa yüzde eşiği (min_acceptable_profit_rate) ve kâr kurallarının TL şartı yerine geçer; boşsa eski kural.
alter table settings add column if not exists squeeze_min_net numeric check (squeeze_min_net is null or (squeeze_min_net >= 0 and squeeze_min_net <= 1000));
alter table marketplace_settings add column if not exists squeeze_min_net numeric check (squeeze_min_net is null or (squeeze_min_net >= 0 and squeeze_min_net <= 1000));


-- ===== migrations/016_match_helpers.sql =====
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


-- ===== migrations/017_xml_price_vat.sql =====
-- Tedarikçi (BayilikXML) fiyatları KDV dahil mi? false ise senkron maliyeti fiyat × (1 + ürün KDV'si) alır.
alter table settings add column if not exists xml_price_includes_vat boolean not null default true;


-- ===== migrations/018_rejection_fixes.sql =====
-- Reddedilen ürünleri düzeltme (Trendyol): yasaklı kelimeler, düzeltme durumu, mağaza kategorileri
create table if not exists banned_words (
  marketplace text not null,
  word text not null,                         -- küçük harf
  source text not null default 'ret',         -- ret (Trendyol ret nedeninden) | elle
  created_at timestamptz not null default now(),
  primary key (marketplace, word)
);
-- auto: sistem düzeltiyor · needs_user: kategori/görsel/elle düzeltme gerekli · user_ready: kullanıcı düzeltti, sonraki senkronda gönderilir
-- resubmitted: yeniden onaya gönderildi · gave_up: vazgeçildi
create table if not exists listing_fixes (
  marketplace text not null,
  listing_key text not null,
  attempts int not null default 0,
  types text[] not null default '{}',
  details text,
  proposed jsonb not null default '{}'::jsonb, -- { title, description, category_id, category_name, images }
  status text not null default 'auto' check (status in ('auto', 'needs_user', 'user_ready', 'resubmitted', 'gave_up')),
  note text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
alter table banned_words enable row level security;
alter table listing_fixes enable row level security;
-- Mağazada kullanılan kategoriler (kategori düzeltmede seçim listesi)
create or replace function store_categories(mp text) returns table (category_id text, category_name text, n bigint) language sql stable set search_path = public as $$
  select category_id, max(category_name), count(*) from marketplace_listings
  where marketplace = mp and category_id is not null and status in ('live', 'pending_approval')
  group by category_id order by count(*) desc limit 1000
$$;
revoke execute on function store_categories(text) from public, anon, authenticated;
grant execute on function store_categories(text) to service_role;


-- ===== migrations/019_multi_unit.sql =====
-- Çoklu adet koruması: 300 TL altı üründen eşiği geçecek kadar (2-3 adet) alınınca kargo satıcıya geçer.
-- Doluysa fiyat, o siparişte de kargo sonrası en az bu kadar net kâr (TL) kalacak şekilde ayarlanır. Boş = kapalı.
alter table settings add column if not exists multi_unit_min_net numeric check (multi_unit_min_net is null or (multi_unit_min_net >= 0 and multi_unit_min_net <= 1000));
alter table marketplace_settings add column if not exists multi_unit_min_net numeric check (multi_unit_min_net is null or (multi_unit_min_net >= 0 and multi_unit_min_net <= 1000));
update settings set multi_unit_min_net = 15 where id = 1;


-- ===== migrations/020_listing_calc.sql =====
-- İlan tablosuna senkronun fiyat hesabı: XML maliyeti, gönderilen fiyat, o fiyatta tek adet net kâr, açıklama.
-- calc_note "XML ile eşleşmedi" ise ilanın fiyatı/stoğu sistem tarafından yönetilmiyor (eski yüklemeden kalma).
alter table marketplace_listings add column if not exists xml_cost numeric;
alter table marketplace_listings add column if not exists calc_price numeric;
alter table marketplace_listings add column if not exists calc_net numeric;
alter table marketplace_listings add column if not exists calc_note text;
-- XML'deki stok ve Trendyol'a gönderilen stok (min_stock altı / gizli -> 0)
alter table marketplace_listings add column if not exists xml_stock numeric;
alter table marketplace_listings add column if not exists sent_stock numeric;


-- ===== migrations/021_sales_paused.sql =====
-- Satışı durdur (panel, pazaryeri bazında): açıkken senkron satıştaki bütün ilanlara stok 0 gönderir, başka işlem yapmaz.
alter table settings add column if not exists sales_paused boolean not null default false;
alter table marketplace_settings add column if not exists sales_paused boolean;


-- ===== migrations/022_listing_retire.sql =====
-- Eski tedarikçinin (BayilikXML) ilanlarını kaldırma: arşiv -> 1 gün sonra kalıcı silme (worker/core/retire.ts).
alter table settings add column if not exists retire_legacy boolean not null default false;
create table if not exists listing_retire (
  marketplace text not null,
  listing_key text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  last_attempt_at timestamptz,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
alter table listing_retire enable row level security;


-- ===== migrations/023_brand_blocklist.sql =====
-- Gönderilmeyen markalar: başlığında/açıklamasında bu marka ya da karakter geçen ürün pazaryerine gönderilmez (worker/core/brand-risk.ts)
create table if not exists brand_blocklist (
  word text primary key,
  source text not null default 'elle',
  created_at timestamptz not null default now()
);
alter table brand_blocklist enable row level security;
insert into brand_blocklist (word, source) select w, 'ilk liste' from (values
  ('apple'),
  ('iphone'),
  ('ipad'),
  ('airpods'),
  ('macbook'),
  ('magsafe'),
  ('airtag'),
  ('lightning'),
  ('samsung'),
  ('galaxy'),
  ('xiaomi'),
  ('redmi'),
  ('huawei'),
  ('honor'),
  ('oppo'),
  ('realme'),
  ('oneplus'),
  ('nokia'),
  ('sony'),
  ('playstation'),
  ('ps4'),
  ('ps5'),
  ('xbox'),
  ('nintendo'),
  ('lg'),
  ('philips'),
  ('bosch'),
  ('siemens'),
  ('arçelik'),
  ('arcelik'),
  ('beko'),
  ('vestel'),
  ('tefal'),
  ('arzum'),
  ('fakir'),
  ('sinbo'),
  ('karaca'),
  ('korkmaz'),
  ('emsan'),
  ('paşabahçe'),
  ('pasabahce'),
  ('tupperware'),
  ('dyson'),
  ('braun'),
  ('remington'),
  ('rowenta'),
  ('babyliss'),
  ('gillette'),
  ('jbl'),
  ('marshall'),
  ('bose'),
  ('beats'),
  ('logitech'),
  ('razer'),
  ('steelseries'),
  ('hyperx'),
  ('corsair'),
  ('anker'),
  ('baseus'),
  ('ugreen'),
  ('hoco'),
  ('ttec'),
  ('lenovo'),
  ('asus'),
  ('acer'),
  ('dell'),
  ('msi'),
  ('canon'),
  ('nikon'),
  ('gopro'),
  ('dji'),
  ('garmin'),
  ('casio'),
  ('rolex'),
  ('seiko'),
  ('swatch'),
  ('fossil'),
  ('tissot'),
  ('swarovski'),
  ('pandora'),
  ('nike'),
  ('adidas'),
  ('puma'),
  ('reebok'),
  ('converse'),
  ('vans'),
  ('skechers'),
  ('lacoste'),
  ('levis'),
  ('zara'),
  ('disney'),
  ('marvel'),
  ('avengers'),
  ('spiderman'),
  ('spider man'),
  ('batman'),
  ('superman'),
  ('frozen'),
  ('elsa'),
  ('mickey'),
  ('minnie'),
  ('barbie'),
  ('lego'),
  ('hasbro'),
  ('mattel'),
  ('hot wheels'),
  ('fisher price'),
  ('pokemon'),
  ('pikachu'),
  ('hello kitty'),
  ('sanrio'),
  ('kuromi'),
  ('paw patrol'),
  ('peppa'),
  ('sonic'),
  ('minecraft'),
  ('roblox'),
  ('fortnite'),
  ('harry potter'),
  ('star wars'),
  ('stitch'),
  ('labubu'),
  ('squishmallows'),
  ('funko'),
  ('nerf'),
  ('playmobil'),
  ('chicco'),
  ('avent'),
  ('pampers'),
  ('huggies'),
  ('loreal'),
  ('maybelline'),
  ('nivea'),
  ('dior'),
  ('chanel'),
  ('gucci'),
  ('prada'),
  ('versace'),
  ('armani'),
  ('hermes'),
  ('louis vuitton'),
  ('michael kors'),
  ('rayban'),
  ('ray ban'),
  ('oakley'),
  ('stanley'),
  ('thermos'),
  ('starbucks'),
  ('coca cola'),
  ('red bull'),
  ('redbull'),
  ('mercedes'),
  ('bmw'),
  ('audi'),
  ('volkswagen'),
  ('toyota'),
  ('ferrari'),
  ('porsche'),
  ('tesla'),
  ('lamborghini'),
  ('fenerbahçe'),
  ('galatasaray'),
  ('beşiktaş'),
  ('trabzonspor'),
  ('fifa'),
  ('nba'),
  ('uefa'),
  ('staedtler'),
  ('parker'),
  ('stabilo'),
  ('crayola'),
  ('moleskine'),
  ('duracell'),
  ('energizer'),
  ('victorinox'),
  ('zippo'),
  ('smeg'),
  ('kitchenaid'),
  ('nespresso'),
  ('delonghi'),
  ('tchibo'),
  ('lavazza'),
  ('ikea'),
  ('ally'),
  ('duzzona'),
  ('uslion'),
  ('wiwu'),
  ('joyroom'),
  ('remax'),
  ('borofone'),
  ('spigen'),
  ('otterbox')
) v(w) on conflict (word) do nothing;


-- ===== migrations/024_supplier_brand_bayilik_off.sql =====
-- Tedarikçi ürünlerinin pazaryerindeki markası (boşsa tedarikçi ürünü gönderilmez; worker/core/db-products.ts)
alter table suppliers add column if not exists marketplace_brand text;


-- ===== migrations/025_security_hardening.sql =====
-- Denetim K1 (docs/DENETIM_2026-10-21.md): herkese açık (anon) anahtarla public şemasındaki nesneler okunabiliyordu.
-- Panel veriyi yalnızca sunucudan (service_role) okur; tarayıcı yalnızca supabase.auth kullanır. anon/authenticated'a public'te yetki gerekmez.
-- Tekrar çalıştırmak güvenlidir. Hiçbir şey silinmez.

-- Analiz görünümü (varsa) çağıranın yetkisiyle çalışsın (RLS atlanmasın)
do $$ begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'tmp_profit') then
    execute 'alter view public.tmp_profit set (security_invoker = true)';
  end if;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

-- Yeni nesneler de açık doğmasın
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;


-- ===== migrations/026_supplier_default_attributes.sql =====
-- Tedarikçi varsayılan ürün özellikleri (özellik adı -> değer adı), pazaryeri zorunlu özelliği XML'de yoksa kullanılır.
-- Örnek: {"Menşei": "Çin", "Garanti Süresi": "2 Yıl"}. Yalnızca doğruluğu tedarikçiden teyit edilmiş değerler girilmeli.
alter table suppliers add column if not exists default_attributes jsonb not null default '{}'::jsonb;


-- ===== migrations/029_db_hygiene.sql =====
-- Denetim S2.7 (silmesiz kısım) + vitrin sıralaması. Tekrar çalıştırmak güvenli.
-- Yinelenen products_status_idx'in kaldırılması ve price_audit_before kararı kullanıcı onayı bekliyor (silme yok).
create index if not exists marketplace_matches_variant_idx on public.marketplace_matches (variant_id);
create index if not exists products_cost_idx on public.products (cost_price desc nulls last);
create index if not exists products_title_idx on public.products (title);


-- ===== migrations/030_feed_hit.sql =====
-- Denetim S2.3: feed erişim sayacı atomik (eşzamanlı isteklerde sayım kaybolmaz). Tekrar çalıştırmak güvenli.
create or replace function public.feed_hit(fid uuid) returns void language sql security invoker set search_path = public as $$
  update public.feeds set access_count = coalesce(access_count, 0) + 1, last_access_at = now() where id = fid;
$$;
revoke execute on function public.feed_hit(uuid) from public, anon, authenticated;


-- ===== migrations/031_shipping_bands.sql =====
-- Kargo basamakları (Hepsiburada barem, 21.09.2026): satıcı her siparişte öder; fiyat < below ise o basamağın sabit ücreti, son basamağın üstünde desi tarifesi.
-- Hepsiburada: 0-200 TL 43,99 + KDV, 200-400 TL 75,99 + KDV, 400+ desi (shipping_vat_included=false). Tekrar çalıştırmak güvenli.
alter table public.marketplace_settings add column if not exists shipping_bands jsonb;


-- ===== migrations/032_net_profit_band.sql =====
-- Net kâr TL aralığı (worker/pricing.ts netProfitMin/netProfitMax): doluysa yüzde hedefi, kâr kuralları ve 1,3x taban yerine
-- fiyat en az net_profit_min TL bırakan en ucuz x9,90 fiyattır. Pazaryeri satırında boş (null) = ortak ayardan miras.
alter table public.settings add column if not exists net_profit_min numeric check (net_profit_min is null or net_profit_min >= 0);
alter table public.settings add column if not exists net_profit_max numeric check (net_profit_max is null or net_profit_max >= 0);
alter table public.marketplace_settings add column if not exists net_profit_min numeric check (net_profit_min is null or net_profit_min >= 0);
alter table public.marketplace_settings add column if not exists net_profit_max numeric check (net_profit_max is null or net_profit_max >= 0);


-- ===== migrations/033_rule_net_band.sql =====
-- Kâr kuralına net kâr TL aralığı (worker/pricing-rules.ts): ör. maliyet 1500+ TL ürünlerde net 100-150 TL. Ayarlardaki aralığı ezer.
alter table public.pricing_rules add column if not exists net_profit_min numeric check (net_profit_min is null or (net_profit_min >= 0 and net_profit_min <= 100000));
alter table public.pricing_rules add column if not exists net_profit_max numeric check (net_profit_max is null or (net_profit_max >= 0 and net_profit_max <= 100000));


-- ===== migrations/034_sales_daily.sql =====
-- Günlük satış özeti (worker/sync.ts, Marketplace.salesDaily): yalnızca toplamlar; müşteri verisi yok.
-- Fiyat değişikliğinin (22.10.2026 net kâr 40-60 TL) satışa etkisini ölçmek için panelde gösterilir.
create table if not exists public.sales_daily (
  marketplace text not null,
  day date not null,
  orders int not null default 0,       -- iptal olmayan sipariş paketleri
  units int not null default 0,
  revenue numeric not null default 0,  -- KDV dahil satış tutarı
  cancelled int not null default 0,
  returns int,                         -- iade talebi (talep tarihine göre); null = okunamadı
  updated_at timestamptz not null default now(),
  primary key (marketplace, day)
);
alter table public.sales_daily enable row level security;


-- ===== migrations/035_listing_mp_status.sql =====
-- Pazaryerinin ürün başına verdiği inceleme durumu (Hepsiburada: Satışa Hazır / İncelenecek / ret nedeni) ve
-- sonucu sonradan yeniden sorulacak toplu gönderim numaraları. Panel: Pazaryeri > Gönderim durumu.
alter table public.marketplace_listings
  add column if not exists mp_status text,          -- pazaryerinin kendi durum metni
  add column if not exists mp_reasons text,         -- ret / doğrulama mesajları
  add column if not exists mp_checked_at timestamptz;

create table if not exists public.mp_batches (
  marketplace text not null,
  batch_id text not null,          -- "product:<takip no>"
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  checks int not null default 0,
  done boolean not null default false,
  primary key (marketplace, batch_id)
);
alter table public.mp_batches enable row level security;
create index if not exists mp_batches_open_idx on public.mp_batches (marketplace, done, checked_at);

-- Toplu yazım (worker/core/mp-status.ts): [{id, status, reasons, bad}]. Hatalıysa gönderilmiş ilan "rejected" olur,
-- daha önce reddedilmiş ilan sonradan onaylanırsa yeniden "sent" (canlı listede görünce "live").
create or replace function public.listing_mp_status_apply(p_mp text, p_rows jsonb) returns int
language sql security invoker set search_path = public as $$
  with r as (select * from jsonb_to_recordset(p_rows) as x(id text, status text, reasons text, bad boolean)),
  u as (
    update public.marketplace_listings l set
      mp_status = r.status, mp_reasons = nullif(r.reasons, ''), mp_checked_at = now(),
      status = case when r.bad and l.status = 'sent' then 'rejected'
                    when not r.bad and l.status = 'rejected' then 'sent' else l.status end,
      last_error = case when r.bad and l.status = 'sent' then left('Hepsiburada: ' || r.status || coalesce(' · ' || nullif(r.reasons, ''), ''), 500)
                        when not r.bad and l.status = 'rejected' then null else l.last_error end,
      updated_at = case when (r.bad and l.status = 'sent') or (not r.bad and l.status = 'rejected') then now() else l.updated_at end
    from r where l.marketplace = p_mp and l.listing_key = r.id
    returning 1)
  select count(*)::int from u;
$$;
revoke execute on function public.listing_mp_status_apply(text, jsonb) from public, anon, authenticated;

-- 22.10 gönderimlerinin takip numaraları (çalıştırma özetlerinde kalanlar) yeniden sorgulansın
insert into public.mp_batches (marketplace, batch_id, created_at)
select distinct r.marketplace, b, r.started_at
from public.sync_runs r, jsonb_array_elements_text(coalesce(r.summary->'batchIds', '[]'::jsonb)) b
where r.marketplace = 'hepsiburada' and b like 'product:%'
on conflict do nothing;


-- ===== migrations/036_listing_status_view.sql =====
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


-- ===== migrations/037_orders.sql =====
-- Faz 6 F1: siparişler (docs/FAZ6_PLAN.md). Pazaryerinden salt okunur çekilir (worker/core/orders.ts).
-- KVKK: müşteri adı/telefon/adres kolonları var ama ŞİMDİLİK DOLDURULMUYOR (yalnızca il). Tedarikçiye iletme (F4) ve
-- KVKK/S0.5 kararından sonra açılacak. RLS açık, erişim yalnızca sunucu (service_role).
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  package_id text not null,                 -- pazaryeri paket/sipariş kimliği (tekil)
  order_no text,
  status text not null default 'new',       -- iç durum: new, ready, sent_to_supplier, shipped, delivered, cancelled, returned, problem
  marketplace_status text,
  total numeric,                            -- KDV dahil, indirimler sonrası
  currency text not null default 'TRY',
  ordered_at timestamptz,
  ship_deadline timestamptz,
  cargo_provider text,
  tracking_no text,
  city text,
  customer_name text, customer_phone text, address jsonb,   -- F4 öncesi boş kalır
  est_cost numeric,                         -- sipariş anı maliyet toplamı
  est_net numeric,                          -- tahmini net kâr (fiyat motoruyla, KDV/komisyon/kargo sonrası)
  needs_attention boolean not null default false,
  attention_reason text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, package_id)
);
create index if not exists orders_mp_date_idx on public.orders (marketplace, ordered_at desc);
create index if not exists orders_status_idx on public.orders (status, ordered_at desc);
alter table public.orders enable row level security;

create table if not exists public.order_lines (
  order_id uuid not null references public.orders(id) on delete cascade,
  line_no int not null,
  listing_key text,
  product_id uuid,
  variant_id uuid,
  title text,
  qty int not null default 1,
  unit_price numeric,                       -- KDV dahil birim satış
  commission_rate numeric,
  cost_snapshot numeric,                    -- birim maliyet (sipariş anı)
  primary key (order_id, line_no)
);
create index if not exists order_lines_product_idx on public.order_lines (product_id);
alter table public.order_lines enable row level security;

create table if not exists public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                       -- created, status, tracking, note
  actor text not null default 'sync',
  detail jsonb
);
create index if not exists order_events_order_idx on public.order_events (order_id, at);
alter table public.order_events enable row level security;

-- Tekrar çalıştırmada kopya yok: (marketplace, package_id) üzerinden upsert; durum değişince olay yazılır.
-- İç durum geri gitmez: tedarikçiye iletilmiş sipariş pazaryerinde hâlâ "hazırlanıyor" görünse de sent_to_supplier kalır.
-- Satır maliyeti ilk kayıtta sabitlenir (sonradan XML maliyeti değişse geçmiş kâr bozulmaz).
create or replace function public.order_upsert(p jsonb) returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; v_old text; v_old_mp text; v_new text; v_track text;
begin
  select id, status, marketplace_status, tracking_no into v_id, v_old, v_old_mp, v_track
    from orders where marketplace = p->>'marketplace' and package_id = p->>'package_id' for update;
  v_new := p->>'status';
  if v_id is null then
    insert into orders (marketplace, package_id, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline,
                        cargo_provider, tracking_no, city, est_cost, est_net, needs_attention, attention_reason, last_seen_at)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now())
    returning id into v_id;
    insert into order_lines (order_id, line_no, listing_key, product_id, variant_id, title, qty, unit_price, commission_rate, cost_snapshot)
    select v_id, (l->>'line_no')::int, l->>'listing_key', (l->>'product_id')::uuid, (l->>'variant_id')::uuid, l->>'title',
           coalesce((l->>'qty')::int, 1), (l->>'unit_price')::numeric, (l->>'commission_rate')::numeric, (l->>'cost_snapshot')::numeric
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l
    on conflict do nothing;
    insert into order_events (order_id, kind, detail) values (v_id, 'created', jsonb_build_object('marketplace_status', p->>'marketplace_status'));
    return 'inserted';
  end if;
  if v_old in ('sent_to_supplier') and v_new in ('new', 'ready') then v_new := v_old; end if;
  update orders set
    order_no = coalesce(p->>'order_no', order_no), status = v_new, marketplace_status = p->>'marketplace_status',
    total = coalesce((p->>'total')::numeric, total), ship_deadline = coalesce((p->>'ship_deadline')::timestamptz, ship_deadline),
    cargo_provider = coalesce(p->>'cargo_provider', cargo_provider), tracking_no = coalesce(p->>'tracking_no', tracking_no),
    needs_attention = coalesce((p->>'needs_attention')::boolean, needs_attention), attention_reason = coalesce(p->>'attention_reason', attention_reason),
    last_seen_at = now(),
    updated_at = case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then now() else updated_at end
  where id = v_id;
  if v_old_mp is distinct from p->>'marketplace_status' then
    insert into order_events (order_id, kind, detail) values (v_id, 'status', jsonb_build_object('from', v_old_mp, 'to', p->>'marketplace_status', 'status', v_new));
  end if;
  if v_track is null and p->>'tracking_no' is not null then
    insert into order_events (order_id, kind, detail) values (v_id, 'tracking', jsonb_build_object('cargo', p->>'cargo_provider'));
  end if;
  return case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then 'updated' else 'same' end;
end $$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;


-- ===== migrations/038_inbox.sql =====
-- Faz 6 F7: müşteri soruları (gelen kutusu). Cevap taslağı yapay zekâdan, gönderim YALNIZCA insan onayıyla (panel veya Telegram).
-- Müşteri adı saklanmaz. Durum: new -> drafted -> approved -> sending -> answered | failed; ignored; answered_elsewhere (pazaryerinden cevaplanmış).
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  kind text not null default 'question',
  external_id text not null,
  product_title text,
  product_key text,
  product_id uuid,
  image_url text,
  text text not null,
  asked_at timestamptz,
  status text not null default 'new',
  ai_draft text,
  ai_unsure boolean,
  ai_note text,
  final_answer text,
  approved_by text,
  approved_at timestamptz,
  answered_at timestamptz,
  last_error text,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, kind, external_id)
);
create index if not exists inbox_status_idx on public.inbox_items (status, asked_at desc);
alter table public.inbox_items enable row level security;

-- Ton tercihi (yapay zekâ taslağına eklenir)
alter table public.settings add column if not exists answer_tone text;


-- ===== migrations/039_order_customer.sql =====
-- Faz 6 F4 (manuel): K kararı 23.10 — tedarikçiye sipariş verebilmek için alıcı ad-soyad ve teslimat adresi saklanır.
-- KVKK: yalnızca bu iki bilgi; teslim/iptal/iade olan siparişlerde 30 gün sonra silinir (orders_purge_pii, her senkronda).
-- Satır indirimleri: Trendyol'da müşterinin ödediği fiyat indirimli olabilir; Trendyol'un karşıladığı kısım satıcıya ödenir.
alter table public.order_lines
  add column if not exists list_price numeric,     -- indirimsiz birim fiyat (KDV dahil)
  add column if not exists discount numeric,       -- satır toplam indirimi
  add column if not exists ty_discount numeric,    -- indirimin pazaryerinin karşıladığı kısmı
  add column if not exists supplier_sku text;      -- tedarikçideki ürün kodu (sipariş verirken aranır)
alter table public.orders
  add column if not exists supplier_note text,
  add column if not exists sent_to_supplier_at timestamptz,
  add column if not exists pii_purged_at timestamptz;

create or replace function public.order_upsert(p jsonb) returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; v_old text; v_old_mp text; v_new text; v_track text;
begin
  select id, status, marketplace_status, tracking_no into v_id, v_old, v_old_mp, v_track
    from orders where marketplace = p->>'marketplace' and package_id = p->>'package_id' for update;
  v_new := p->>'status';
  if v_id is null then
    insert into orders (marketplace, package_id, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline,
                        cargo_provider, tracking_no, city, customer_name, address, est_cost, est_net, needs_attention, attention_reason, last_seen_at)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', p->>'customer_name', p->'address', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now())
    returning id into v_id;
    insert into order_events (order_id, kind, detail) values (v_id, 'created', jsonb_build_object('marketplace_status', p->>'marketplace_status'));
  else
    if v_old in ('sent_to_supplier') and v_new in ('new', 'ready') then v_new := v_old; end if;
    update orders set
      order_no = coalesce(p->>'order_no', order_no), status = v_new, marketplace_status = p->>'marketplace_status',
      total = coalesce((p->>'total')::numeric, total), ship_deadline = coalesce((p->>'ship_deadline')::timestamptz, ship_deadline),
      cargo_provider = coalesce(p->>'cargo_provider', cargo_provider), tracking_no = coalesce(p->>'tracking_no', tracking_no),
      -- kişisel veri: silinmişse (pii_purged_at) geri yazılmaz
      customer_name = case when pii_purged_at is null then coalesce(p->>'customer_name', customer_name) else null end,
      address = case when pii_purged_at is null then coalesce(p->'address', address) else null end,
      est_net = coalesce((p->>'est_net')::numeric, est_net),
      needs_attention = coalesce((p->>'needs_attention')::boolean, needs_attention), attention_reason = coalesce(p->>'attention_reason', attention_reason),
      last_seen_at = now(),
      updated_at = case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then now() else updated_at end
    where id = v_id;
    if v_old_mp is distinct from p->>'marketplace_status' then
      insert into order_events (order_id, kind, detail) values (v_id, 'status', jsonb_build_object('from', v_old_mp, 'to', p->>'marketplace_status', 'status', v_new));
    end if;
    if v_track is null and p->>'tracking_no' is not null then
      insert into order_events (order_id, kind, detail) values (v_id, 'tracking', jsonb_build_object('cargo', p->>'cargo_provider'));
    end if;
  end if;
  -- Satırlar: fiyat/indirim güncellenir, maliyet (cost_snapshot) ilk kayıttaki gibi kalır
  insert into order_lines (order_id, line_no, listing_key, product_id, variant_id, title, qty, unit_price, commission_rate, cost_snapshot, list_price, discount, ty_discount, supplier_sku)
  select v_id, (l->>'line_no')::int, l->>'listing_key', (l->>'product_id')::uuid, (l->>'variant_id')::uuid, l->>'title',
         coalesce((l->>'qty')::int, 1), (l->>'unit_price')::numeric, (l->>'commission_rate')::numeric, (l->>'cost_snapshot')::numeric,
         (l->>'list_price')::numeric, (l->>'discount')::numeric, (l->>'ty_discount')::numeric, l->>'supplier_sku'
  from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l
  on conflict (order_id, line_no) do update set
    unit_price = excluded.unit_price, list_price = excluded.list_price, discount = excluded.discount, ty_discount = excluded.ty_discount,
    supplier_sku = coalesce(order_lines.supplier_sku, excluded.supplier_sku),
    cost_snapshot = coalesce(order_lines.cost_snapshot, excluded.cost_snapshot),
    product_id = coalesce(order_lines.product_id, excluded.product_id);
  return case when v_old is null then 'inserted' when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then 'updated' else 'same' end;
end $$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;

-- KVKK saklama süresi: biten siparişlerde ad/adres silinir
create or replace function public.orders_purge_pii(p_days int default 30) returns int
language sql security invoker set search_path = public as $$
  with u as (
    update public.orders set customer_name = null, customer_phone = null, address = null, pii_purged_at = now()
    where pii_purged_at is null and status in ('delivered', 'cancelled', 'returned')
      and updated_at < now() - make_interval(days => greatest(p_days, 7))
      and (customer_name is not null or address is not null or customer_phone is not null)
    returning 1)
  select count(*)::int from u;
$$;
revoke execute on function public.orders_purge_pii(int) from public, anon, authenticated;


-- ===== migrations/040_img_fix.sql =====
-- Görsel onarımı (worker/core/image-fix.ts): onaylı ilana JPG görseller en son ne zaman gönderildi (3 günde bir kereden fazla denenmez)
alter table public.marketplace_listings add column if not exists img_fix_at timestamptz;


-- ===== migrations/041_attr_fix.sql =====
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


-- ===== migrations/042_sales_finance.sql =====
-- Faz 6 F5/F8/F9: satış raporu (kâr kalemleri), iadeler, takip kodunu pazaryerine bildirme kuyruğu. Yalnızca service_role.
-- orders.fin: worker'ın sipariş başına hesapladığı kalemler (KDV dahil TL, sipariş anı maliyetiyle):
--   revenue (satıcıya kalan brüt = müşterinin ödediği + pazaryerinin karşıladığı indirim), commission, shipping, service (sabit gider),
--   vat_due (ödenecek KDV farkı), stopaj (%1, gelir vergisinden düşülür: gider değil), return_loss (iade kargo/paketleme), cost, net.
-- act_*: pazaryerinin hakediş kaydındaki GERÇEK komisyon ve satıcı hakedişi (Trendyol settlements). Varsa raporda tahminin yerine geçer.
alter table public.orders
  add column if not exists fin jsonb,
  add column if not exists units int,
  add column if not exists act_commission numeric,
  add column if not exists act_revenue numeric,
  add column if not exists settled_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists supplier_tracking text,        -- tedarikçinin verdiği takip no (elle; pazaryerinin kargo kodu tracking_no'da kalır)
  add column if not exists supplier_cargo text,
  add column if not exists tracking_push text,            -- pending, sending, done, failed (panelden "Pazaryerine bildir")
  add column if not exists tracking_push_provider text,   -- pazaryerinin kargo firması kodu (Trendyol providerCode: YKMP, ARASMP...)
  add column if not exists tracking_push_error text,
  add column if not exists tracking_pushed_at timestamptz;
create index if not exists orders_tracking_push_idx on public.orders (tracking_push) where tracking_push in ('pending', 'sending');
create index if not exists orders_order_no_idx on public.orders (marketplace, order_no);

-- İade talepleri (Trendyol claims, Hepsiburada claims): salt okunur çekilir. Müşteri adı alınmaz.
create table if not exists public.claims (
  marketplace text not null,
  claim_id text not null,
  order_no text,
  order_id uuid references public.orders(id) on delete set null,
  status text,                    -- pazaryeri durumu (Created, WaitingInAction, Accepted, Rejected, Cancelled, Unresolved, InAnalysis)
  reason text,                    -- müşterinin iade nedeni (ilk satır)
  reason_code text,
  claimed_at timestamptz,
  amount numeric,                 -- iade edilen satırların tutarı (KDV dahil)
  lines jsonb not null default '[]'::jsonb,   -- [{key, title, qty, price, status, reason}]
  cargo_provider text,
  tracking_no text,
  updated_at timestamptz not null default now(),
  primary key (marketplace, claim_id)
);
create index if not exists claims_date_idx on public.claims (claimed_at desc);
alter table public.claims enable row level security;

-- Tek dönem özeti (rapor ve önceki dönem karşılaştırması). İptaller ciroya girmez; iade edilen sipariş ciroda görünür, iade tutarı ayrıca düşülür.
create or replace function public.sales_kpi(p_from timestamptz, p_to timestamptz, p_mp text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with o as (
    select o.status, o.total, coalesce(o.units, 1) units, o.fin,
      coalesce((o.fin->>'revenue')::numeric, o.total) revenue,
      (o.fin->>'commission')::numeric est_comm,
      coalesce(o.act_commission, (o.fin->>'commission')::numeric) comm,
      -- gerçek komisyon gelince: fark KDV'si indirilir, kalan net kâra yansır
      coalesce(o.act_commission - (o.fin->>'commission')::numeric, 0) dc,
      (o.fin->>'net')::numeric + case when o.act_commission is not null and o.status not in ('cancelled', 'returned')
        then ((o.fin->>'commission')::numeric - o.act_commission) / 1.2 else 0 end net,
      o.act_commission is not null settled
    from public.orders o
    where o.ordered_at >= p_from and o.ordered_at < p_to and (p_mp is null or o.marketplace = p_mp)
  ), s as (select * from o where status <> 'cancelled'),
  k as (select * from s where status <> 'returned' and net is not null)   -- kâr kalemleri: maliyeti bilinen satışlar (şelale tutarlı olsun)
  select jsonb_build_object(
    'orders', (select count(*) from s),
    'units', (select coalesce(sum(units), 0) from s),
    'gross', (select coalesce(sum(total), 0) from s),
    'revenue', (select coalesce(sum(revenue), 0) from s),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'cancelled_amount', (select coalesce(sum(total), 0) from o where status = 'cancelled'),
    'returned', (select count(*) from s where status = 'returned'),
    'returned_amount', (select coalesce(sum(total), 0) from s where status = 'returned'),
    'net_sales', (select coalesce(sum(revenue), 0) from k),
    'commission', (select coalesce(sum(comm), 0) from k),
    'shipping', (select coalesce(sum((fin->>'shipping')::numeric), 0) from k),
    'service', (select coalesce(sum((fin->>'service')::numeric), 0) from k),
    'cost', (select coalesce(sum((fin->>'cost')::numeric), 0) from k),
    'vat_due', (select coalesce(sum((fin->>'vat_due')::numeric - dc * 0.2 / 1.2), 0) from k),
    'stopaj', (select coalesce(sum((fin->>'stopaj')::numeric), 0) from k),
    'return_loss', (select coalesce(sum((fin->>'return_loss')::numeric), 0) from s where status = 'returned'),
    'net', (select coalesce(sum(net), 0) from s where net is not null),
    'net_known', (select count(*) from s where net is not null),
    'unknown_cost', (select count(*) from s where status <> 'returned' and net is null),
    'commission_est', (select coalesce(sum(est_comm), 0) from k where settled),
    'commission_act', (select coalesce(sum(comm), 0) from k where settled),
    'settled', (select count(*) from k where settled)
  );
$$;
revoke execute on function public.sales_kpi(timestamptz, timestamptz, text) from public, anon, authenticated;

-- Satış raporu: dönem (gün aralığı, İstanbul saati), önceki eşit dönem, zaman serisi, pazaryeri dağılımı, ürünler, iade nedenleri, zarar eden siparişler
create or replace function public.sales_report(p_from date, p_to date, p_mp text default null, p_bucket text default 'day') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  f timestamptz := p_from::timestamp at time zone 'Europe/Istanbul';
  t timestamptz := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  len interval := (p_to + 1)::timestamp - p_from::timestamp;
  b text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end;
  r jsonb;
begin
  with o as (
    select o.*, date_trunc(b, o.ordered_at at time zone 'Europe/Istanbul')::date k,
      (o.fin->>'net')::numeric + case when o.act_commission is not null and o.status not in ('cancelled', 'returned')
        then ((o.fin->>'commission')::numeric - o.act_commission) / 1.2 else 0 end net
    from public.orders o
    where o.ordered_at >= f and o.ordered_at < t and (p_mp is null or o.marketplace = p_mp)
  ), l as (
    select o.status, o.net, ol.*, coalesce(ol.product_id::text, ol.listing_key) pk
    from o join public.order_lines ol on ol.order_id = o.id
  )
  select jsonb_build_object(
    'kpi', public.sales_kpi(f, t, p_mp),
    'prev', public.sales_kpi(f - len, f, p_mp),
    'series', coalesce((select jsonb_agg(x order by x.k) from (
      select k, count(*) filter (where status <> 'cancelled') orders,
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) gross,
        coalesce(sum(net) filter (where status <> 'cancelled'), 0) net,
        count(*) filter (where status = 'returned') returned,
        count(*) filter (where status = 'cancelled') cancelled
      from o group by k) x), '[]'::jsonb),
    'by_mp', coalesce((select jsonb_agg(x) from (
      select marketplace, count(*) filter (where status <> 'cancelled') orders,
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) gross,
        coalesce(sum(net) filter (where status <> 'cancelled'), 0) net,
        count(*) filter (where status = 'returned') returned
      from o group by marketplace order by 3 desc) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x) from (
      select max(title) title, max(listing_key) listing_key, sum(qty) units, sum(qty * unit_price) gross,
        count(*) filter (where status = 'returned') returned,
        sum(case when status not in ('cancelled', 'returned') and cost_snapshot is not null then qty * (unit_price - cost_snapshot) end) margin
      from l where status <> 'cancelled' group by pk order by sum(qty) desc, sum(qty * unit_price) desc limit 15) x), '[]'::jsonb),
    'returned_products', coalesce((select jsonb_agg(x) from (
      select max(title) title, max(listing_key) listing_key, count(*) returned, sum(qty * unit_price) amount
      from l where status = 'returned' group by pk order by count(*) desc limit 10) x), '[]'::jsonb),
    'return_reasons', coalesce((select jsonb_agg(x) from (
      select coalesce(c.reason, 'Belirtilmemiş') reason, count(*) n, coalesce(sum(c.amount), 0) amount
      from public.claims c where c.claimed_at >= f and c.claimed_at < t and (p_mp is null or c.marketplace = p_mp)
      group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'claims_open', (select count(*) from public.claims c where (p_mp is null or c.marketplace = p_mp) and c.status in ('Created', 'WaitingInAction', 'InAnalysis', 'Unresolved')),
    'losers', coalesce((select jsonb_agg(x) from (
      select id, marketplace, order_no, ordered_at, total, net, status from o
      where status not in ('cancelled') and net < 0 order by net limit 10) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from o group by status) x), '{}'::jsonb)
  ) into r;
  return r || jsonb_build_object('from', p_from, 'to', p_to, 'bucket', b);
end $$;
revoke execute on function public.sales_report(date, date, text, text) from public, anon, authenticated;

-- order_upsert: fin + adet her senkronda yenilenir (maliyet satırda sabit kaldığı için kâr bozulmaz)
create or replace function public.order_upsert(p jsonb) returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; v_old text; v_old_mp text; v_new text; v_track text;
begin
  select id, status, marketplace_status, tracking_no into v_id, v_old, v_old_mp, v_track
    from orders where marketplace = p->>'marketplace' and package_id = p->>'package_id' for update;
  v_new := p->>'status';
  if v_id is null then
    insert into orders (marketplace, package_id, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline,
                        cargo_provider, tracking_no, city, customer_name, address, est_cost, est_net, needs_attention, attention_reason, last_seen_at, fin, units)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', p->>'customer_name', p->'address', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now(), p->'fin', (p->>'units')::int)
    returning id into v_id;
    insert into order_events (order_id, kind, detail) values (v_id, 'created', jsonb_build_object('marketplace_status', p->>'marketplace_status'));
  else
    if v_old in ('sent_to_supplier') and v_new in ('new', 'ready') then v_new := v_old; end if;
    update orders set
      order_no = coalesce(p->>'order_no', order_no), status = v_new, marketplace_status = p->>'marketplace_status',
      total = coalesce((p->>'total')::numeric, total), ship_deadline = coalesce((p->>'ship_deadline')::timestamptz, ship_deadline),
      cargo_provider = coalesce(p->>'cargo_provider', cargo_provider), tracking_no = coalesce(p->>'tracking_no', tracking_no),
      customer_name = case when pii_purged_at is null then coalesce(p->>'customer_name', customer_name) else null end,
      address = case when pii_purged_at is null then coalesce(p->'address', address) else null end,
      est_cost = coalesce((p->>'est_cost')::numeric, est_cost),
      est_net = case when p ? 'est_net' then (p->>'est_net')::numeric else est_net end,
      fin = coalesce(p->'fin', fin), units = coalesce((p->>'units')::int, units),
      needs_attention = coalesce((p->>'needs_attention')::boolean, needs_attention), attention_reason = case when p ? 'attention_reason' then p->>'attention_reason' else attention_reason end,
      last_seen_at = now(),
      updated_at = case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then now() else updated_at end
    where id = v_id;
    if v_old_mp is distinct from p->>'marketplace_status' then
      insert into order_events (order_id, kind, detail) values (v_id, 'status', jsonb_build_object('from', v_old_mp, 'to', p->>'marketplace_status', 'status', v_new));
    end if;
    if v_track is null and p->>'tracking_no' is not null then
      insert into order_events (order_id, kind, detail) values (v_id, 'tracking', jsonb_build_object('cargo', p->>'cargo_provider'));
    end if;
  end if;
  insert into order_lines (order_id, line_no, listing_key, product_id, variant_id, title, qty, unit_price, commission_rate, cost_snapshot, list_price, discount, ty_discount, supplier_sku)
  select v_id, (l->>'line_no')::int, l->>'listing_key', (l->>'product_id')::uuid, (l->>'variant_id')::uuid, l->>'title',
         coalesce((l->>'qty')::int, 1), (l->>'unit_price')::numeric, (l->>'commission_rate')::numeric, (l->>'cost_snapshot')::numeric,
         (l->>'list_price')::numeric, (l->>'discount')::numeric, (l->>'ty_discount')::numeric, l->>'supplier_sku'
  from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l
  on conflict (order_id, line_no) do update set
    unit_price = excluded.unit_price, list_price = excluded.list_price, discount = excluded.discount, ty_discount = excluded.ty_discount,
    commission_rate = coalesce(excluded.commission_rate, order_lines.commission_rate),
    supplier_sku = coalesce(order_lines.supplier_sku, excluded.supplier_sku),
    cost_snapshot = coalesce(order_lines.cost_snapshot, excluded.cost_snapshot),
    product_id = coalesce(order_lines.product_id, excluded.product_id);
  return case when v_old is null then 'inserted' when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then 'updated' else 'same' end;
end $$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;

-- Stok rezervasyonu (F6): tedarikçiye henüz verilmemiş açık siparişlerdeki adet, XML stoğu düşene kadar tüm pazaryerlerinde stoktan düşülür
create or replace function public.order_reservations(p_hours int default 48)
returns table (product_id uuid, listing_key text, marketplace text, qty bigint)
language sql stable security invoker set search_path = public as $$
  select ol.product_id, ol.listing_key, o.marketplace, sum(ol.qty)
  from public.orders o join public.order_lines ol on ol.order_id = o.id
  where o.status in ('new', 'ready') and o.ordered_at > now() - make_interval(hours => greatest(p_hours, 1))
  group by 1, 2, 3
$$;
revoke execute on function public.order_reservations(int) from public, anon, authenticated;


-- ===== migrations/043_dashboard_counts.sql =====
-- Panel hızı (23.10): gösterge paneli 10 ayrı "count exact" sorgusu atıyordu; en ağırı 807 bin satırlık marketplace_brands
-- (her açılışta 2,5-8 sn, senkron sırasında daha da uzun). Tek sorguda sayım; büyük marka tablosu için planlayıcı tahmini (reltuples).
create or replace function public.dashboard_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'products', (select count(*) from products),
    'active', (select count(*) from products where status = 'active'),
    'variants', (select count(*) from product_variants),
    'in_stock_variants', (select count(*) from product_variants where stock > 0),
    'brands', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.marketplace_brands'::regclass),
    'listings', (select jsonb_build_object(
        'live', count(*) filter (where status = 'live'),
        'pending', count(*) filter (where status = 'pending_approval'),
        'closed', count(*) filter (where status = 'closed'),
        'linked', count(*) filter (where variant_id is not null))
      from marketplace_listings where marketplace = 'trendyol')
  );
$$;
revoke execute on function public.dashboard_counts() from public, anon, authenticated;


-- ===== migrations/044_product_list_indexes.sql =====
-- Panel hızı (23.10): ürün listesi varsayılan sıralaması (updated_at desc) filtresizken indekssizdi (43 bin ürün her sayfada sıralanıyordu);
-- başlık/SKU araması "%q%" trigram indeksiyle. Sipariş listesi tarih sırası zaten indeksli (037).
create index if not exists products_updated_idx on public.products (updated_at desc);
create index if not exists products_updated_nl_idx on public.products (updated_at desc nulls last); -- API "nullsFirst: false" sıralaması bunu kullanır (4,9 sn -> 2 ms)
create index if not exists products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);
create index if not exists products_sku_trgm on public.products using gin (sku extensions.gin_trgm_ops);
create index if not exists products_category_trgm on public.products using gin (category extensions.gin_trgm_ops);
analyze public.products;


-- ===== migrations/045_ai_attr.sql =====
-- Yapay zekâ ile eksik zorunlu özellik doldurma (worker/core/ai-attrs.ts): ürün başına deneme kaydı (aynı ürün 7 gün içinde yeniden sorulmaz).
-- Yazılan değerler products.attributes'a gider (pazaryerinin değer listesinden; serbest metin yalnızca pazaryeri izin veriyorsa).
create table if not exists public.ai_attr_runs (
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null,
  at timestamptz not null default now(),
  asked text[] not null default '{}',
  filled jsonb not null default '{}'::jsonb,   -- {özellik: değer}
  primary key (product_id, marketplace)
);
alter table public.ai_attr_runs enable row level security;

-- Aday ilanlar: eksik özellik hatası, ürün aktif, son 7 günde denenmemiş
create or replace function public.ai_attr_candidates(p_mp text, p_limit int default 150)
returns table (listing_key text, product_id uuid, category_id text, missing text[], title text, description text, attributes jsonb)
language sql stable security invoker set search_path = public as $$
  select l.listing_key, l.product_id, l.category_id, public.missing_attrs(l.last_error), p.title, left(coalesce(p.description, ''), 4000), coalesce(p.attributes, '{}'::jsonb)
  from public.marketplace_listings l
  join public.products p on p.id = l.product_id and p.status = 'active'
  left join public.ai_attr_runs r on r.product_id = l.product_id and r.marketplace = p_mp
  where l.marketplace = p_mp and l.status = 'error' and l.category_id is not null
    and l.last_error like 'zorunlu özellik doldurulamadı:%'
    and (r.at is null or r.at < now() - interval '7 days')
  order by l.updated_at
  limit greatest(1, least(p_limit, 500))
$$;
revoke execute on function public.ai_attr_candidates(text, int) from public, anon, authenticated;


-- ===== migrations/046_buybox.sql =====
-- Rekabet / buybox takibi (Trendyol "Ürün Buybox Kontrol" servisi): ilan başına sıra, buybox fiyatı, 2./3. fiyat, başka satıcı var mı.
-- Worker kâr hesabını da yazar: bugünkü net, buybox'ın 1 TL altına inersek net (fiyat motoruyla). Panel: Pazaryeri > Rekabet.
create table if not exists public.listing_buybox (
  marketplace text not null,
  listing_key text not null,
  buybox_order int,               -- 1 = buybox bizde
  buybox_price numeric,
  second_price numeric,
  third_price numeric,
  multiple boolean,               -- başka satıcı da satıyor
  our_price numeric,
  cost numeric,                   -- KDV dahil maliyet
  commission numeric,
  net_now numeric,
  target_price numeric,           -- önerilen: buybox fiyatının 1 TL altı (buybox bizdeyse null)
  net_at_target numeric,
  checked_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
create index if not exists listing_buybox_order_idx on public.listing_buybox (marketplace, buybox_order);
alter table public.listing_buybox enable row level security;

-- Özet + liste (son 30 günde satılan adet öncelik için)
create or replace function public.buybox_report(p_mp text, p_filter text default 'lost', p_q text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with b as (
    select b.*, coalesce(l.title, p.title) title, l.product_id,
      (select coalesce(sum(ol.qty), 0) from public.order_lines ol join public.orders o on o.id = ol.order_id
        where o.marketplace = p_mp and ol.listing_key = b.listing_key and o.ordered_at > now() - interval '30 days' and o.status <> 'cancelled') sold30,
      exists (select 1 from public.product_overrides ov where ov.marketplace = p_mp and ov.barcode = b.listing_key and ov.price_override is not null) overridden
    from public.listing_buybox b
    join public.marketplace_listings l on l.marketplace = b.marketplace and l.listing_key = b.listing_key
    left join public.products p on p.id = l.product_id
    where b.marketplace = p_mp
  ), f as (
    select * from b where
      case p_filter when 'lost' then buybox_order > 1 when 'winnable' then buybox_order > 1 and net_at_target > 0 when 'won' then buybox_order = 1 and multiple when 'alone' then not coalesce(multiple, false) else true end
      and (p_q = '' or title ilike '%' || p_q || '%' or listing_key ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('checked', count(*), 'competition', count(*) filter (where multiple), 'won', count(*) filter (where buybox_order = 1 and multiple),
        'lost', count(*) filter (where buybox_order > 1), 'winnable', count(*) filter (where buybox_order > 1 and net_at_target > 0), 'alone', count(*) filter (where not coalesce(multiple, false)),
        'last', max(checked_at)) from b),
    'total', (select count(*) from f),
    'items', coalesce((select jsonb_agg(x) from (select listing_key, title, buybox_order, buybox_price, second_price, our_price, cost, net_now, target_price, net_at_target, sold30, overridden, checked_at
      from f order by sold30 desc, (our_price - buybox_price) desc nulls last limit greatest(1, least(p_limit, 200)) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
$$;
revoke execute on function public.buybox_report(text, text, text, int, int) from public, anon, authenticated;


-- ===== migrations/047_attr_fix_apply_key.sql =====
-- attr_fix_apply iş anahtarına özellik + değer eklendi: aynı işlemde birden çok değer uygulanınca anahtar çakışıyordu (25.10).
-- Fonksiyonun tam metni canlı veritabanında (041'deki gövde + anahtar değişikliği):
--   'attrfix:' || p_mp || ':' || v_now::text || ':' || md5(p_name || '|' || p_value) || ':' || i


-- ===== migrations/048_supplier_feeds.sql =====
-- Bir tedarikçinin birden çok XML linki (K, 25.10): suppliers.feeds = [{ id, label, url, sku_prefix, mapping, item_path }].
-- Boş sku_prefix / mapping / item_path = ana linkin ayarı. İçe aktarma (worker/import-xml.ts) tüm linkleri birlikte indirir ve tek liste
-- gibi işler; biri inmezse durur (yoksa o linkin ürünleri "XML'den kalktı" sanılıp stokları sıfırlanırdı).
alter table public.suppliers add column if not exists feeds jsonb not null default '[]'::jsonb;

-- Veri (canlıda 25.10 uygulandı): toptancim2 -> Toptancım'ın "Link 2"si (kendi SKU öneki ve eşlemesiyle, ürün kodları değişmez),
-- ürün kaynağı xml:toptancim2 -> xml:toptacim (5.678 ürün), eski kayıt silinmedi, pasif.
-- update suppliers s set name = 'Toptancım', feeds = jsonb_build_array(jsonb_build_object('id','link2','label','Link 2','url',t2.xml_url,'sku_prefix',t2.sku_prefix,'mapping',t2.mapping,'item_path',t2.item_path))
--   from suppliers t2 where s.code = 'toptacim' and t2.code = 'toptancim2';
-- update products set source = 'xml:toptacim' where source = 'xml:toptancim2';
-- update suppliers set active = false, nightly = false where code = 'toptancim2';


-- ===== migrations/049_ai_attr_candidates_fast.sql =====
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


-- ===== migrations/050_net_margin_min.sql =====
-- En az kâr marjı (K, 25.10: "satış fiyatının en az %10'u, en az 40 TL net"; net 60 TL üst sınırı kaldırıldı).
-- Net kâr TL modunda (net_profit_min dolu) fiyat hem en az net_profit_min TL hem en az bu oran (KDV hariç satışa göre net) bırakan en ucuz fiyat.
alter table public.settings add column if not exists net_margin_min numeric;
alter table public.marketplace_settings add column if not exists net_margin_min numeric;
-- Canlı ayar (25.10): update settings set net_profit_max = null, net_margin_min = 0.10 where id = 1;
--                     update marketplace_settings set net_profit_max = null, net_margin_min = 0.10 where marketplace = 'hepsiburada';


-- ===== migrations/051_opportunity.sql =====
-- Ürün seçimi / fırsat listesi (K, 25.10: Trendyol'da 50 bin ürün sınırı; Royal'den yalnızca satış potansiyeli yüksek, stoklu, kârlı ürünler).
-- 1) Tedarikçi stok düşüşü (satış hızı): her içe aktarmada ürün stoğu bir önceki kayıtla karşılaştırılır, düşüş günün toplamına eklenir
--    (tedarikçinin stoğu düşüyorsa ürün diğer bayilerde satılıyor demektir; stok artışı = yeniden stok, sayılmaz).
create table if not exists public.supplier_stock_snap (
  product_id uuid not null references public.products(id) on delete cascade,
  day date not null,
  stock int not null,
  drops int not null default 0,
  primary key (product_id, day)
);
create index if not exists supplier_stock_snap_day_idx on public.supplier_stock_snap (day);
alter table public.supplier_stock_snap enable row level security;

create or replace function public.snap_supplier_stock(p_source text) returns int
language sql security invoker set search_path = public as $$
  with cur as (
    select p.id, coalesce(sum(v.stock), 0)::int stock from public.products p join public.product_variants v on v.product_id = p.id
    where p.source = p_source group by p.id
  ), prev as (
    select distinct on (s.product_id) s.product_id, s.stock from public.supplier_stock_snap s
    join cur on cur.id = s.product_id order by s.product_id, s.day desc
  ), up as (
    insert into public.supplier_stock_snap (product_id, day, stock, drops)
    select cur.id, (now() at time zone 'Europe/Istanbul')::date, cur.stock, greatest(coalesce(prev.stock, cur.stock) - cur.stock, 0)
    from cur left join prev on prev.product_id = cur.id
    on conflict (product_id, day) do update set drops = supplier_stock_snap.drops + greatest(supplier_stock_snap.stock - excluded.stock, 0), stock = excluded.stock
    returning 1
  )
  select count(*)::int from up;
$$;
revoke execute on function public.snap_supplier_stock(text) from public, anon, authenticated;

-- 2) Fırsat puanı (worker/opportunity.ts günlük yazar): pazaryeri fiyatı/neti fiyat motoruyla, kategori/komisyon tahminiyle
create table if not exists public.product_opportunity (
  marketplace text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  source text,
  score numeric,
  price numeric, net numeric, margin numeric, commission numeric,
  stock int, sold7 int, variants int, images int,
  category_id text, category_name text, confidence numeric,
  brand text, brand_ok boolean,
  excluded text,                 -- elendiyse nedeni (mağazada var, stok az, zarar...)
  reasons jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (marketplace, product_id)
);
create index if not exists product_opportunity_score_idx on public.product_opportunity (marketplace, score desc) where excluded is null;
alter table public.product_opportunity enable row level security;

create or replace function public.opportunity_list(p_mp text, p_source text, p_q text default '', p_brand text default '', p_min_net numeric default 0, p_min_stock int default 0, p_only_ok_brand boolean default false, p_limit int default 50, p_offset int default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with o as (
    select o.*, p.title, p.sku, (select url from public.product_images i where i.product_id = p.id order by position limit 1) image,
      (select l.status from public.marketplace_listings l where l.product_id = p.id and l.marketplace = p_mp limit 1) listing_status
    from public.product_opportunity o join public.products p on p.id = o.product_id
    where o.marketplace = p_mp and (p_source = '' or o.source = p_source)
  ), f as (
    select * from o where excluded is null and listing_status is null and net >= p_min_net and stock >= p_min_stock
      and (not p_only_ok_brand or brand_ok) and (p_brand = '' or brand = p_brand)
      and (p_q = '' or title ilike '%' || p_q || '%' or category_name ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('total', count(*), 'candidates', count(*) filter (where excluded is null and listing_status is null),
        'excluded', count(*) filter (where excluded is not null), 'sent', count(*) filter (where listing_status is not null), 'last', max(computed_at),
        'reasons', (select jsonb_object_agg(excluded, n) from (select excluded, count(*) n from o where excluded is not null group by 1) x)) from o),
    'total', (select count(*) from f),
    'brands', coalesce((select jsonb_agg(x) from (select brand, count(*) n, bool_or(brand_ok) ok from f group by brand order by 2 desc limit 40) x), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x) from (select product_id, title, sku, image, brand, brand_ok, category_name, confidence, price, net, margin, commission, stock, sold7, variants, images, score, reasons
      from f order by score desc limit greatest(1, least(p_limit, 500)) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  );
$$;
revoke execute on function public.opportunity_list(text, text, text, text, numeric, int, boolean, int, int) from public, anon, authenticated;


-- ===== migrations/052_stock_velocity.sql =====
-- Satış hızı: son N günde tedarikçi stok düşüşü toplamı (worker/opportunity.ts)
create or replace function public.stock_velocity(p_source text, p_days int default 7)
returns table (product_id uuid, sold bigint, days bigint)
language sql stable security invoker set search_path = public as $$
  select s.product_id, sum(s.drops), count(*) from public.supplier_stock_snap s join public.products p on p.id = s.product_id
  where p.source = p_source and s.day > (now() at time zone 'Europe/Istanbul')::date - greatest(p_days, 1)
  group by s.product_id
$$;
revoke execute on function public.stock_velocity(text, int) from public, anon, authenticated;


-- ===== migrations/053_audit_slim.sql =====
-- Değişiklik geçmişi (audit_log) yalnızca değişen alanları tutar (25.10): otomatik içe aktarmalar her fiyat/stok değişikliğinde ürünün
-- tam kopyasını önce/sonra iki kez yazıyordu (442 MB, ücretsiz plan sınırı 500 MB). Değişiklik olmayan güncelleme kaydı yazılmaz;
-- yeni ürün kaydında kimlik bilgisi (sku, başlık, kaynak, maliyet) yeter (tam hali ürün tablosunda).
create or replace function public.audit_diff(p_before jsonb, p_after jsonb, p_action text, out o_before jsonb, out o_after jsonb)
language plpgsql immutable set search_path = public as $$
declare k text;
begin
  o_before := p_before; o_after := p_after;
  if p_before is not null and p_after is not null and jsonb_typeof(p_before) = 'object' and jsonb_typeof(p_after) = 'object' then
    o_before := '{}'::jsonb; o_after := '{}'::jsonb;
    for k in select jsonb_object_keys(p_after) union select jsonb_object_keys(p_before) loop
      if (p_before -> k) is distinct from (p_after -> k) then
        o_before := o_before || jsonb_build_object(k, p_before -> k);
        o_after := o_after || jsonb_build_object(k, p_after -> k);
      end if;
    end loop;
  elsif p_action = 'create' and p_after is not null and jsonb_typeof(p_after) = 'object' then
    o_after := jsonb_strip_nulls(jsonb_build_object('sku', p_after -> 'sku', 'title', p_after -> 'title', 'source', p_after -> 'source', 'cost_price', p_after -> 'cost_price'));
  end if;
end $$;

create or replace function public.audit_slim() returns trigger language plpgsql set search_path = public as $$
declare d record;
begin
  if new.entity = 'product' then
    select * into d from public.audit_diff(new.before, new.after, new.action);
    if new.action = 'update' and d.o_after = '{}'::jsonb then return null; end if;
    new.before := d.o_before; new.after := d.o_after;
  end if;
  return new;
end $$;
create or replace trigger audit_slim_trg before insert on public.audit_log for each row execute function public.audit_slim();
create index if not exists audit_log_at_idx on public.audit_log (at);
revoke execute on function public.audit_diff(jsonb, jsonb, text) from public, anon, authenticated;

-- Mevcut kayıtlar (canlıda ilk 20.000 kayıt küçültüldü; kalanı kullanıcı Supabase SQL Editor'de çalıştırır):
--   update audit_log a set before = d.o_before, after = d.o_after from lateral public.audit_diff(a.before, a.after, a.action) d
--   where a.entity = 'product' and a.id > 20191;
--   vacuum full audit_log;   -- boşalan alanı diske geri verir (tablo birkaç dakika kilitlenir)


-- ===== migrations/054_listings_link_barcode.sql =====
-- İlan <-> varyant bağı barkodla da kurulur (26.10): veritabanı sıfırdan kurulunca (025.10 yeni proje) gönderimde yazılan variant_id kayboldu,
-- 23.775 Trendyol / 14.011 HB ilanı ürüne bağlı değildi ve stok/fiyat gitmiyordu. Her senkronda bağsız ilanlar varyant barkoduyla eşlenir.
create or replace function listings_link(mp text) returns int language plpgsql set search_path = public as $$
declare n int; m int;
begin
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v join products p on p.id = v.product_id
  where ml.marketplace = mp and ml.variant_id is null and p.source = 'xml:bayilik'
    and v.sku = regexp_replace(ml.listing_key, '^(ÖS13-|OS13-)', '');
  get diagnostics n = row_count;
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v
  where ml.marketplace = mp and ml.variant_id is null and v.barcode = ml.listing_key;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke execute on function listings_link(text) from public, anon, authenticated;
grant execute on function listings_link(text) to service_role;
