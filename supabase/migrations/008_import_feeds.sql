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
