-- Satış hızı: son N günde tedarikçi stok düşüşü toplamı (worker/opportunity.ts)
create or replace function public.stock_velocity(p_source text, p_days int default 7)
returns table (product_id uuid, sold bigint, days bigint)
language sql stable security invoker set search_path = public as $$
  select s.product_id, sum(s.drops), count(*) from public.supplier_stock_snap s join public.products p on p.id = s.product_id
  where p.source = p_source and s.day > (now() at time zone 'Europe/Istanbul')::date - greatest(p_days, 1)
  group by s.product_id
$$;
revoke execute on function public.stock_velocity(text, int) from public, anon, authenticated;
