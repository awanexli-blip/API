-- 068: Yayındaki ilanı yeniden gönderince yalnızca değişen içerik gitsin (K, 28.10). Son gönderilen içeriğin izi:
-- { t: başlık özeti, d: açıklama özeti, i: görseller özeti } (worker/core/content-diff.ts). Yoksa canlı içerikle karşılaştırılır.
alter table public.marketplace_listings add column if not exists content_sent jsonb;
