-- İlan tablosuna senkronun fiyat hesabı: XML maliyeti, gönderilen fiyat, o fiyatta tek adet net kâr, açıklama.
-- calc_note "XML ile eşleşmedi" ise ilanın fiyatı/stoğu sistem tarafından yönetilmiyor (eski yüklemeden kalma).
alter table marketplace_listings add column if not exists xml_cost numeric;
alter table marketplace_listings add column if not exists calc_price numeric;
alter table marketplace_listings add column if not exists calc_net numeric;
alter table marketplace_listings add column if not exists calc_note text;
-- XML'deki stok ve Trendyol'a gönderilen stok (min_stock altı / gizli -> 0)
alter table marketplace_listings add column if not exists xml_stock numeric;
alter table marketplace_listings add column if not exists sent_stock numeric;
