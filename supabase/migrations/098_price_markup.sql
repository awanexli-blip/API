-- Genel fiyat zammı (K 19.11: "ürünlere %5 zam koy", formüle kalıcı, Trendyol + Hepsiburada). Formül fiyatı (1 + oran) ile çarpılıp x9,90'a yuvarlanır;
-- zam kargo basamağını aşıp net kârı düşürecekse o üründe uygulanmaz (worker/pricing.ts finish). Boş/0 = zam yok.
alter table public.settings add column if not exists price_markup numeric;
alter table public.marketplace_settings add column if not exists price_markup numeric;
comment on column public.settings.price_markup is 'Genel fiyat zammı (0.05 = %5); worker/pricing.ts priceMarkup';
notify pgrst, 'reload schema';
