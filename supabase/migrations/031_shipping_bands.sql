-- Kargo basamakları (Hepsiburada barem, 21.09.2026): satıcı her siparişte öder; fiyat < below ise o basamağın sabit ücreti, son basamağın üstünde desi tarifesi.
-- Hepsiburada: 0-200 TL 43,99 + KDV, 200-400 TL 75,99 + KDV, 400+ desi (shipping_vat_included=false). Tekrar çalıştırmak güvenli.
alter table public.marketplace_settings add column if not exists shipping_bands jsonb;
