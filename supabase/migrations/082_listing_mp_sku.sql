-- Pazaryerinin kendi ürün numarası (Hepsiburada "HBCV…" hepsiburadaSku). K 15.11: "ürün no HB ile başlıyor, barkod BZ; hangisi olduğuna şaşırıyorum".
-- Sipariş/iade satırında satıcı kodu yerine bu numara gelirse barkoda (listing_key) çevrilir; panel ve Telegram hep barkodu gösterir.
alter table public.marketplace_listings add column if not exists mp_sku text;
create index if not exists marketplace_listings_mp_sku_idx on public.marketplace_listings (marketplace, mp_sku) where mp_sku is not null;
