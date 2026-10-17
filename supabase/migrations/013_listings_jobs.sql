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
