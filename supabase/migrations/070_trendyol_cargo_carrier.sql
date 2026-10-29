-- 070: Trendyol kargo firması ve zamanında kargolama (worker/core/trendyol-cargo.ts). Firma seçiliyse barem + desi tarifesinden hesaplanır
-- (shipping_bands / shipping_cost yerine). cargo_fast = termin 1 gün / Hızlı Teslimat ve zamanında kargoya veriliyor (barem Tablo 1).
-- Boş firma = eski davranış (ayardaki sabit basamaklar). default_desi: ürünün desisi yoksa / anlamsızsa (<= 0,05).
alter table public.settings add column if not exists cargo_carrier text;
alter table public.settings add column if not exists cargo_fast boolean not null default false;
alter table public.settings add column if not exists default_desi numeric;
