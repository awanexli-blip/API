-- Trendyol güvenli liste (27.11): rastgele üretilmiş barkod tespiti. Gerçek firma barkodları ortak firma kodu taşır; katalogda en az
-- p_min üründe geçen 7 haneli önekler (UPC-12 başına 0 eklenir, GTIN-14 gösterge hanesi atılır). worker/core/ty-safe.ts knownPrefixes.
create or replace function public.gtin_known_prefixes(p_min int default 3)
returns table (prefix text, n int)
language sql stable
as $$
  select left(c13, 7) as prefix, count(distinct product_id)::int as n
  from (
    select product_id,
           case when barcode ~ '^\d{13}$' then barcode
                when barcode ~ '^\d{12}$' then '0' || barcode
                when barcode ~ '^\d{14}$' then substr(barcode, 2) end as c13
    from public.product_variants
    where barcode ~ '^\d{12,14}$'
  ) x
  where c13 is not null
  group by 1
  having count(distinct product_id) >= p_min
$$;

grant execute on function public.gtin_known_prefixes(int) to service_role;
