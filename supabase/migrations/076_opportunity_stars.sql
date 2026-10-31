-- 076: Ürün seçimi yıldızı (K, 01.11: "en iyi 10, en kötü 1; 10 numaradakileri gönder deyince göndersin").
-- worker/stars.ts: pazaryerine uygun (excluded boş) ürünler fırsat puanına göre sıralanır, 10 eşit dilim -> 10..1 yıldız.
-- Aynı ürün başka adla (aynı ilk görsel ya da aynı başlık + maliyet) tekrar ediyorsa yalnızca en iyisi yıldız alır, diğerleri "kopya" elenir.
alter table public.product_opportunity add column if not exists stars smallint;
create index if not exists product_opportunity_stars_idx on public.product_opportunity (marketplace, stars) where excluded is null;
