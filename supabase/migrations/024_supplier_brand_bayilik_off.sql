-- Tedarikçi ürünlerinin pazaryerindeki markası (boşsa tedarikçi ürünü gönderilmez; worker/core/db-products.ts)
alter table suppliers add column if not exists marketplace_brand text;
