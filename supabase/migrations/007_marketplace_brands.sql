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
