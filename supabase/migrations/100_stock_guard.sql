-- Stok koruyucu (K 26.11: "en önemli olay stokların zamanında sıfırlanması"). Uzun senkron turu (HB 2-3 saat) beklenmeden,
-- tedarikçide stoğu biten (stok - rezerv < en az stok) ya da pasife düşen ürünün yayındaki ilanı birkaç dakikada 0'a çekilir.
-- Yalnızca SIFIRLAMA yönü: stok artırma / fiyat her zaman ana senkronda. worker/stock-guard.ts kullanır.

-- Pencere sorgusu (son çalışmadan beri değişen varyantlar) için; tetikleyici her güncellemede updated_at yazar (003_products)
create index if not exists product_variants_updated_idx on public.product_variants (updated_at desc);

-- p_since null = tam tarama. Bilinen ilan stoğu: koruyucu/senkron son gönderimi seen_at'ten yeniyse sent_qty, değilse pazaryerinden okunan stock.
-- plpgsql + iki ayrı dal: tek SQL'de "p_since is null or ..." genel planda dizini kullanmıyordu (pencere sorgusu 7 sn, tam tarama kadar).
create or replace function public.stock_guard_candidates(p_mp text, p_since timestamptz, p_min_stock int)
returns table (listing_key text, avail int, prod_status text, known_qty int)
language plpgsql stable
as $$
begin
  if p_since is null then
    return query
    select l.listing_key, greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0))::int, p.status,
           (case when l.pushed_at is not null and l.pushed_at >= l.seen_at then coalesce(l.sent_qty, 0) else coalesce(l.stock, 0) end)::int
    from public.marketplace_listings l
    join public.product_variants v on v.id = l.variant_id
    join public.products p on p.id = v.product_id
    where l.marketplace = p_mp and l.status = 'live'
      and coalesce(p.source, '') not in ('manual', 'xml:bayilik')
      and (greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0)) < greatest(1, p_min_stock) or p.status <> 'active')
      and (case when l.pushed_at is not null and l.pushed_at >= l.seen_at then coalesce(l.sent_qty, 0) else coalesce(l.stock, 0) end) > 0;
  else
    return query
    with changed as (
      select v0.id from public.product_variants v0 where v0.updated_at >= p_since
      union
      select v1.id from public.products p1 join public.product_variants v1 on v1.product_id = p1.id where p1.updated_at >= p_since
    )
    select l.listing_key, greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0))::int, p.status,
           (case when l.pushed_at is not null and l.pushed_at >= l.seen_at then coalesce(l.sent_qty, 0) else coalesce(l.stock, 0) end)::int
    from changed c
    join public.product_variants v on v.id = c.id
    join public.products p on p.id = v.product_id
    join public.marketplace_listings l on l.variant_id = v.id and l.marketplace = p_mp and l.status = 'live'
    where coalesce(p.source, '') not in ('manual', 'xml:bayilik')
      and (greatest(0, coalesce(v.stock, 0) - coalesce(v.reserved, 0)) < greatest(1, p_min_stock) or p.status <> 'active')
      and (case when l.pushed_at is not null and l.pushed_at >= l.seen_at then coalesce(l.sent_qty, 0) else coalesce(l.stock, 0) end) > 0;
  end if;
end $$;

grant execute on function public.stock_guard_candidates(text, timestamptz, int) to service_role;

-- Gönderilen 0'ı ilan tablosuna yaz (elle değişiklik koruması holds.ts sent_qty/pushed_at ile karşılaştırır)
create or replace function public.stock_guard_mark(p_mp text, p_keys text[])
returns int language sql as $$
  with u as (
    update public.marketplace_listings set sent_qty = 0, pushed_at = now(), stock = 0
    where marketplace = p_mp and listing_key = any(p_keys) returning 1
  ) select count(*)::int from u
$$;

grant execute on function public.stock_guard_mark(text, text[]) to service_role;
