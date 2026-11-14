-- Tedarikçiye özel ürün başına ek maliyet (KDV dahil TL). Çerçici: +9,90 hizmet/paketleme bedeli (bayilik sayfası, K 15.11).
alter table public.suppliers add column if not exists cost_add numeric not null default 0;
