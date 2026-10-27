-- Kademeli zam (K, 27.10: "duruma göre marj, %5 kademeli"): ilanın günün ilk senkronundaki fiyatı gün başı fiyatıdır; o gün fiyat en fazla
-- gün başı × (1 + ramp) olur. Maliyet artışında eski kuralın fiyatı (en az 40 TL / %10) her zaman uygulanır (worker/core/db-products.ts).
alter table public.marketplace_listings add column if not exists price_day date;
alter table public.marketplace_listings add column if not exists price_day_base numeric;

-- Gün başı fiyatlarını toplu yaz: [{k, p}]
create or replace function public.set_price_day_base(p_mp text, p_day date, p_rows jsonb) returns int
language sql security invoker set search_path = public as $$
  with r as (select * from jsonb_to_recordset(p_rows) as x(k text, p numeric)),
  u as (update public.marketplace_listings l set price_day = p_day, price_day_base = r.p from r where l.marketplace = p_mp and l.listing_key = r.k returning 1)
  select count(*)::int from u;
$$;
revoke execute on function public.set_price_day_base(text, date, jsonb) from public, anon, authenticated;
