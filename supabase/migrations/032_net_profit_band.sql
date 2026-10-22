-- Net kâr TL aralığı (worker/pricing.ts netProfitMin/netProfitMax): doluysa yüzde hedefi, kâr kuralları ve 1,3x taban yerine
-- fiyat en az net_profit_min TL bırakan en ucuz x9,90 fiyattır. Pazaryeri satırında boş (null) = ortak ayardan miras.
alter table public.settings add column if not exists net_profit_min numeric check (net_profit_min is null or net_profit_min >= 0);
alter table public.settings add column if not exists net_profit_max numeric check (net_profit_max is null or net_profit_max >= 0);
alter table public.marketplace_settings add column if not exists net_profit_min numeric check (net_profit_min is null or net_profit_min >= 0);
alter table public.marketplace_settings add column if not exists net_profit_max numeric check (net_profit_max is null or net_profit_max >= 0);
