-- Rekabet fiyatı (K 20.11: "rakiplerin biraz altında, en iyi marj, %15-20"): {"enabled":true,"lo":0.15,"hi":0.2,"alone":0.2,"unknown":0.15,"netMin":70}
-- Açıkken fiyat worker/pricing.ts competitivePrice ile: rakip buybox'ta -> 1 TL altı, buybox bizde -> ikinci satıcının altına kadar,
-- tek satıcı -> alone, bilgi yok -> unknown; her zaman [lo, hi] marj ve en az netMin TL. Boş/enabled=false = eski formül.
alter table public.settings add column if not exists competitive_pricing jsonb;
alter table public.marketplace_settings add column if not exists competitive_pricing jsonb;
notify pgrst, 'reload schema';
