-- Duruma göre kâr marjı (K, 27.10, seçenek c; worker/core/dynamic-margin.ts): en az 40 TL net korunur, oran rekabete (TY buybox: başka
-- satıcı varsa %10, tek satıcı %20) ya da fiyata göre (500 TL altı %20, 500-1.500 %15, üstü %10). Önce önizlemede karşılaştırılır;
-- dynamic_margin_active K onayıyla açılır. Pazaryeri satırında boş = ortak ayar.
alter table public.settings add column if not exists dynamic_margin jsonb;
alter table public.settings add column if not exists dynamic_margin_active boolean not null default false;
alter table public.marketplace_settings add column if not exists dynamic_margin jsonb;
alter table public.marketplace_settings add column if not exists dynamic_margin_active boolean;
update public.settings set dynamic_margin = '{"competition":0.10,"alone":0.20,"bands":[[500,0.20],[1500,0.15],[null,0.10]]}'::jsonb where id = 1 and dynamic_margin is null;
