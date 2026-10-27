-- XML içe aktarma trafiği (K, 28.10: "XML bağlantıları çok veri alıyor"): indirilen XML'lerin parmak izi (sha1, tüm linkler birlikte).
-- Bir önceki başarılı içe aktarmayla aynıysa ürünler işlenmez ve veritabanına bir şey gönderilmez (worker/import-xml.ts).
alter table public.suppliers add column if not exists last_feed_hash text;
alter table public.suppliers add column if not exists last_feed_at timestamptz;
