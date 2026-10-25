-- En az kâr marjı (K, 25.10: "satış fiyatının en az %10'u, en az 40 TL net"; net 60 TL üst sınırı kaldırıldı).
-- Net kâr TL modunda (net_profit_min dolu) fiyat hem en az net_profit_min TL hem en az bu oran (KDV hariç satışa göre net) bırakan en ucuz fiyat.
alter table public.settings add column if not exists net_margin_min numeric;
alter table public.marketplace_settings add column if not exists net_margin_min numeric;
-- Canlı ayar (25.10): update settings set net_profit_max = null, net_margin_min = 0.10 where id = 1;
--                     update marketplace_settings set net_profit_max = null, net_margin_min = 0.10 where marketplace = 'hepsiburada';
