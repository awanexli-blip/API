-- Akıllı Bayi tedarikçi satırı (K 28.11). YALNIZCA SUNUCU veritabanına (runner='vps'); Supabase'e eklenmez. Akış adresleri gizlidir (jeton içerir),
-- depoda yok: psql -v base='https://akillibayi.com.tr/xml/market/<jeton>/' -f ops/xsup/akillibayi-supplier.sql
-- nightly=false eklenir (ilk içe aktarma elle); doğrulanınca: update suppliers set nightly = true where code = 'akillibayi';
-- Fiyat KDV dahil (örtüşen ürünlerde Hepsibayi'nin %3, Bezos'un %2 altı; ikisi de KDV dahil saklı). <tax> eşlenmez: 1.095 üründe 0.00 (varsayılan %20, güvenli yön).
-- Marka sahte ("Akıllı Bayi"): eşlenmez; pazaryeri markası marketplace_brand'den (Pazarama ayrıca "Markasız doğrulandı" ister). Stok (100/5000 yuvarlak) dikkatle:
-- tedarikçiler arası seçimde source_min_stock ile eşik konabilir (migration 104 bayrağı).
insert into suppliers (code, name, url_from_env, nightly, mapping, sku_prefix, sku_ascii, default_brand, price_includes_vat, default_vat, currency, runner, marketplace_brand, item_path, min_interval_min, feeds)
values ('akillibayi', 'Akıllı Bayi', null, false,
 '{"desi":"desi","name":"title","price":"cost_price","detail":"description","barcode":"barcode","category":"category","currency":"currency","quantity":"stock","productCode":"model","image1":"images","image2":"images","image3":"images","image4":"images","image5":"images","image6":"images","image7":"images","image8":"images","image9":"images","image10":"images"}'::jsonb,
 'AKB', true, '', true, 20, 'TRY', 'vps', 'Eco Lounge|Genel Markalar|Tcx', 'products.product', 120,
 (select jsonb_agg(jsonb_build_object('id','akb'||n,'label','Parça '||n,'url',:'base'||'part-'||n||'.xml') order by n) from generate_series(1,6) n))
on conflict (code) do nothing;
