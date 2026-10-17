-- 300 TL kargo eşiğinin altına (299,90) çekerken kabul edilen en az net kâr (TL).
-- Doluysa yüzde eşiği (min_acceptable_profit_rate) ve kâr kurallarının TL şartı yerine geçer; boşsa eski kural.
alter table settings add column if not exists squeeze_min_net numeric check (squeeze_min_net is null or (squeeze_min_net >= 0 and squeeze_min_net <= 1000));
alter table marketplace_settings add column if not exists squeeze_min_net numeric check (squeeze_min_net is null or (squeeze_min_net >= 0 and squeeze_min_net <= 1000));
