-- Tedarikçi (BayilikXML) fiyatları KDV dahil mi? false ise senkron maliyeti fiyat × (1 + ürün KDV'si) alır.
alter table settings add column if not exists xml_price_includes_vat boolean not null default true;
