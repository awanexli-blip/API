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
