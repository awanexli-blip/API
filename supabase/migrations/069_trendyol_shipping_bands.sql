-- 069: Trendyol kargo basamakları (barem). 29.10 kesinti dökümü: Trendyol 300 TL altı siparişlerde de kargoyu satıcıdan kesiyor
-- (139-199 TL: 58-65 TL, 200-300 TL: 102-112 TL; 300 üstü 107-115 TL). Eski kural "300 altı alıcı öder" zarar ettiriyordu.
-- Biçim Hepsiburada ile aynı: [{"below": 200, "cost": 105}, {"below": 350, "cost": 113}] (KDV dahil TL); son basamağın üstünde shipping_cost.
-- Boş (null) = eski kural (ücretsiz kargo eşiği). Değerler panelden (Trendyol -> Fiyat ayarları -> Kargo basamakları) girilir.
alter table public.settings add column if not exists shipping_bands jsonb;
