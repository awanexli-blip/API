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

alter table sync_runs add column if not exists marketplace text not null default 'trendyol';
create index if not exists sync_runs_marketplace_id on sync_runs (marketplace, id desc);
