-- Görsel onarımı (worker/core/image-fix.ts): onaylı ilana JPG görseller en son ne zaman gönderildi (3 günde bir kereden fazla denenmez)
alter table public.marketplace_listings add column if not exists img_fix_at timestamptz;
