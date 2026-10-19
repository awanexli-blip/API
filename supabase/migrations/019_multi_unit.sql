-- Çoklu adet koruması: 300 TL altı üründen eşiği geçecek kadar (2-3 adet) alınınca kargo satıcıya geçer.
-- Doluysa fiyat, o siparişte de kargo sonrası en az bu kadar net kâr (TL) kalacak şekilde ayarlanır. Boş = kapalı.
alter table settings add column if not exists multi_unit_min_net numeric check (multi_unit_min_net is null or (multi_unit_min_net >= 0 and multi_unit_min_net <= 1000));
alter table marketplace_settings add column if not exists multi_unit_min_net numeric check (multi_unit_min_net is null or (multi_unit_min_net >= 0 and multi_unit_min_net <= 1000));
update settings set multi_unit_min_net = 15 where id = 1;
