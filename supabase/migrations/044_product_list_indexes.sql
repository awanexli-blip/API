-- Panel hızı (23.10): ürün listesi varsayılan sıralaması (updated_at desc) filtresizken indekssizdi (43 bin ürün her sayfada sıralanıyordu);
-- başlık/SKU araması "%q%" trigram indeksiyle. Sipariş listesi tarih sırası zaten indeksli (037).
create index if not exists products_updated_idx on public.products (updated_at desc);
create index if not exists products_updated_nl_idx on public.products (updated_at desc nulls last); -- API "nullsFirst: false" sıralaması bunu kullanır (4,9 sn -> 2 ms)
create index if not exists products_title_trgm on public.products using gin (title gin_trgm_ops);
create index if not exists products_sku_trgm on public.products using gin (sku gin_trgm_ops);
create index if not exists products_category_trgm on public.products using gin (category gin_trgm_ops);
analyze public.products;
