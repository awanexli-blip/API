-- Kâr kuralına net kâr TL aralığı (worker/pricing-rules.ts): ör. maliyet 1500+ TL ürünlerde net 100-150 TL. Ayarlardaki aralığı ezer.
alter table public.pricing_rules add column if not exists net_profit_min numeric check (net_profit_min is null or (net_profit_min >= 0 and net_profit_min <= 100000));
alter table public.pricing_rules add column if not exists net_profit_max numeric check (net_profit_max is null or (net_profit_max >= 0 and net_profit_max <= 100000));
