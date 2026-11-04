-- 077 (04.11): sipariş satırında ürünün KDV oranı. Sunucu tedarikçilerinin (Hepsibayi, Bezos) ürünleri Supabase'de yok:
-- fatura taslağı KDV'yi ürün kaydından bulamayıp %20 varsayıyordu (ör. zigon sehpa %10). worker/orders-vps.ts sunucudaki ürünün
-- KDV oranını buraya yazar; fatura (app/api/invoices) önce bunu kullanır. order_upsert bu kolona dokunmaz (dolu değer korunur).
alter table public.order_lines add column if not exists vat_rate numeric;
notify pgrst, 'reload schema';
