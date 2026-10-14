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
