-- Kupon payı (K 17.11: "kupon payı ekleyelim ve taban 50 TL olsun"). Satıcının karşıladığı kupon/indirim fiyat formülünde gider sayılır.
alter table public.settings add column if not exists coupon_rate numeric;
alter table public.marketplace_settings add column if not exists coupon_rate numeric;
comment on column public.settings.coupon_rate is 'Satıcı kupon/indirim payı (0.02 = satışın %2si); worker/pricing.ts couponRate';
