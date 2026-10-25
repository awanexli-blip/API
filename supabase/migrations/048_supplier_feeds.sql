-- Bir tedarikçinin birden çok XML linki (K, 25.10): suppliers.feeds = [{ id, label, url, sku_prefix, mapping, item_path }].
-- Boş sku_prefix / mapping / item_path = ana linkin ayarı. İçe aktarma (worker/import-xml.ts) tüm linkleri birlikte indirir ve tek liste
-- gibi işler; biri inmezse durur (yoksa o linkin ürünleri "XML'den kalktı" sanılıp stokları sıfırlanırdı).
alter table public.suppliers add column if not exists feeds jsonb not null default '[]'::jsonb;

-- Veri (canlıda 25.10 uygulandı): toptancim2 -> Toptancım'ın "Link 2"si (kendi SKU öneki ve eşlemesiyle, ürün kodları değişmez),
-- ürün kaynağı xml:toptancim2 -> xml:toptacim (5.678 ürün), eski kayıt silinmedi, pasif.
-- update suppliers s set name = 'Toptancım', feeds = jsonb_build_array(jsonb_build_object('id','link2','label','Link 2','url',t2.xml_url,'sku_prefix',t2.sku_prefix,'mapping',t2.mapping,'item_path',t2.item_path))
--   from suppliers t2 where s.code = 'toptacim' and t2.code = 'toptancim2';
-- update products set source = 'xml:toptacim' where source = 'xml:toptancim2';
-- update suppliers set active = false, nightly = false where code = 'toptancim2';
