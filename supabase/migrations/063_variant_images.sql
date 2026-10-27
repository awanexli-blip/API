-- Varyant (renk) görselleri (K, 27.10: "varyantların fotoğraflarını ayrı girmem lazım ki eşleştirebilesin"). Boşsa ürünün görselleri kullanılır.
-- Panelde renk başına girilir (aynı rengin numaraları aynı görselleri paylaşır); panel API'si ürünü kaydettikten sonra varyant SKU'suyla yazar
-- (app/api/products). product_save bu kolona dokunmaz: XML içe aktarma ve form kaydı mevcut görselleri silmez. Worker her varyantı kendi görselleriyle gönderir.
alter table public.product_variants add column if not exists images jsonb not null default '[]'::jsonb;
