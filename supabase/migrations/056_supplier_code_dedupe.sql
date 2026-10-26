-- Tedarikçi kopya ürünleri (K, 26.10): Toptancım aynı ürünü ürün kodunun sonuna -1, -2 ... ekleyip farklı başlıkla tekrar yayınlıyor
-- (1.452 grup, 7.264 ürün). Bayrak açık tedarikçide aynı kod gövdesinden yalnızca stokta olan en ucuz ürün pazaryerine gönderilir
-- (worker/core/db-products.ts). Diğer tedarikçilerde "-1/-2" ayrı model olabilir: bayrak varsayılan kapalı.
alter table public.suppliers add column if not exists dedupe_code_suffix boolean not null default false;
update public.suppliers set dedupe_code_suffix = true where code = 'toptancim';

create index if not exists products_source_stem_idx on public.products (source, (regexp_replace(sku, '-\d{1,2}$', '')));

-- Kod gövdesi aynı (sonundaki -N atılınca) aktif ürünler; stok = varyant stoğu - rezerve
create or replace function public.product_code_siblings(p_source text, p_stems text[])
returns table (id uuid, sku text, stem text, cost numeric, stock bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, p.sku, regexp_replace(p.sku, '-\d{1,2}$', ''), p.cost_price,
    coalesce((select sum(greatest(v.stock - v.reserved, 0)) from public.product_variants v where v.product_id = p.id), 0)
  from public.products p
  where p.source = p_source and p.status = 'active' and regexp_replace(p.sku, '-\d{1,2}$', '') = any(p_stems)
$$;
revoke execute on function public.product_code_siblings(text, text[]) from public, anon, authenticated;
