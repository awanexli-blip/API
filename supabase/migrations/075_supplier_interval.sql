-- 075: Tedarikçi bazında en kısa okuma aralığı (dakika). Hepsibayi: "cron sıklığı en fazla 60 dakika" -> 60. Boş/0 = sınırsız (15 dk senkron).
alter table public.suppliers add column if not exists min_interval_min integer;
