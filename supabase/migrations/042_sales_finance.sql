-- Faz 6 F5/F8/F9: satış raporu (kâr kalemleri), iadeler, takip kodunu pazaryerine bildirme kuyruğu. Yalnızca service_role.
-- orders.fin: worker'ın sipariş başına hesapladığı kalemler (KDV dahil TL, sipariş anı maliyetiyle):
--   revenue (satıcıya kalan brüt = müşterinin ödediği + pazaryerinin karşıladığı indirim), commission, shipping, service (sabit gider),
--   vat_due (ödenecek KDV farkı), stopaj (%1, gelir vergisinden düşülür: gider değil), return_loss (iade kargo/paketleme), cost, net.
-- act_*: pazaryerinin hakediş kaydındaki GERÇEK komisyon ve satıcı hakedişi (Trendyol settlements). Varsa raporda tahminin yerine geçer.
alter table public.orders
  add column if not exists fin jsonb,
  add column if not exists units int,
  add column if not exists act_commission numeric,
  add column if not exists act_revenue numeric,
  add column if not exists settled_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists supplier_tracking text,        -- tedarikçinin verdiği takip no (elle; pazaryerinin kargo kodu tracking_no'da kalır)
  add column if not exists supplier_cargo text,
  add column if not exists tracking_push text,            -- pending, sending, done, failed (panelden "Pazaryerine bildir")
  add column if not exists tracking_push_provider text,   -- pazaryerinin kargo firması kodu (Trendyol providerCode: YKMP, ARASMP...)
  add column if not exists tracking_push_error text,
  add column if not exists tracking_pushed_at timestamptz;
create index if not exists orders_tracking_push_idx on public.orders (tracking_push) where tracking_push in ('pending', 'sending');
create index if not exists orders_order_no_idx on public.orders (marketplace, order_no);

-- İade talepleri (Trendyol claims, Hepsiburada claims): salt okunur çekilir. Müşteri adı alınmaz.
create table if not exists public.claims (
  marketplace text not null,
  claim_id text not null,
  order_no text,
  order_id uuid references public.orders(id) on delete set null,
  status text,                    -- pazaryeri durumu (Created, WaitingInAction, Accepted, Rejected, Cancelled, Unresolved, InAnalysis)
  reason text,                    -- müşterinin iade nedeni (ilk satır)
  reason_code text,
  claimed_at timestamptz,
  amount numeric,                 -- iade edilen satırların tutarı (KDV dahil)
  lines jsonb not null default '[]'::jsonb,   -- [{key, title, qty, price, status, reason}]
  cargo_provider text,
  tracking_no text,
  updated_at timestamptz not null default now(),
  primary key (marketplace, claim_id)
);
create index if not exists claims_date_idx on public.claims (claimed_at desc);
alter table public.claims enable row level security;

-- Tek dönem özeti (rapor ve önceki dönem karşılaştırması). İptaller ciroya girmez; iade edilen sipariş ciroda görünür, iade tutarı ayrıca düşülür.
create or replace function public.sales_kpi(p_from timestamptz, p_to timestamptz, p_mp text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with o as (
    select o.status, o.total, coalesce(o.units, 1) units, o.fin,
      coalesce((o.fin->>'revenue')::numeric, o.total) revenue,
      (o.fin->>'commission')::numeric est_comm,
      coalesce(o.act_commission, (o.fin->>'commission')::numeric) comm,
      -- gerçek komisyon gelince: fark KDV'si indirilir, kalan net kâra yansır
      coalesce(o.act_commission - (o.fin->>'commission')::numeric, 0) dc,
      (o.fin->>'net')::numeric + case when o.act_commission is not null and o.status not in ('cancelled', 'returned')
        then ((o.fin->>'commission')::numeric - o.act_commission) / 1.2 else 0 end net,
      o.act_commission is not null settled
    from public.orders o
    where o.ordered_at >= p_from and o.ordered_at < p_to and (p_mp is null or o.marketplace = p_mp)
  ), s as (select * from o where status <> 'cancelled'),
  k as (select * from s where status <> 'returned' and net is not null)   -- kâr kalemleri: maliyeti bilinen satışlar (şelale tutarlı olsun)
  select jsonb_build_object(
    'orders', (select count(*) from s),
    'units', (select coalesce(sum(units), 0) from s),
    'gross', (select coalesce(sum(total), 0) from s),
    'revenue', (select coalesce(sum(revenue), 0) from s),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'cancelled_amount', (select coalesce(sum(total), 0) from o where status = 'cancelled'),
    'returned', (select count(*) from s where status = 'returned'),
    'returned_amount', (select coalesce(sum(total), 0) from s where status = 'returned'),
    'net_sales', (select coalesce(sum(revenue), 0) from k),
    'commission', (select coalesce(sum(comm), 0) from k),
    'shipping', (select coalesce(sum((fin->>'shipping')::numeric), 0) from k),
    'service', (select coalesce(sum((fin->>'service')::numeric), 0) from k),
    'cost', (select coalesce(sum((fin->>'cost')::numeric), 0) from k),
    'vat_due', (select coalesce(sum((fin->>'vat_due')::numeric - dc * 0.2 / 1.2), 0) from k),
    'stopaj', (select coalesce(sum((fin->>'stopaj')::numeric), 0) from k),
    'return_loss', (select coalesce(sum((fin->>'return_loss')::numeric), 0) from s where status = 'returned'),
    'net', (select coalesce(sum(net), 0) from s where net is not null),
    'net_known', (select count(*) from s where net is not null),
    'unknown_cost', (select count(*) from s where status <> 'returned' and net is null),
    'commission_est', (select coalesce(sum(est_comm), 0) from k where settled),
    'commission_act', (select coalesce(sum(comm), 0) from k where settled),
    'settled', (select count(*) from k where settled)
  );
$$;
revoke execute on function public.sales_kpi(timestamptz, timestamptz, text) from public, anon, authenticated;

-- Satış raporu: dönem (gün aralığı, İstanbul saati), önceki eşit dönem, zaman serisi, pazaryeri dağılımı, ürünler, iade nedenleri, zarar eden siparişler
create or replace function public.sales_report(p_from date, p_to date, p_mp text default null, p_bucket text default 'day') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  f timestamptz := p_from::timestamp at time zone 'Europe/Istanbul';
  t timestamptz := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  len interval := (p_to + 1)::timestamp - p_from::timestamp;
  b text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end;
  r jsonb;
begin
  with o as (
    select o.*, date_trunc(b, o.ordered_at at time zone 'Europe/Istanbul')::date k,
      (o.fin->>'net')::numeric + case when o.act_commission is not null and o.status not in ('cancelled', 'returned')
        then ((o.fin->>'commission')::numeric - o.act_commission) / 1.2 else 0 end net
    from public.orders o
    where o.ordered_at >= f and o.ordered_at < t and (p_mp is null or o.marketplace = p_mp)
  ), l as (
    select o.status, o.net, ol.*, coalesce(ol.product_id::text, ol.listing_key) pk
    from o join public.order_lines ol on ol.order_id = o.id
  )
  select jsonb_build_object(
    'kpi', public.sales_kpi(f, t, p_mp),
    'prev', public.sales_kpi(f - len, f, p_mp),
    'series', coalesce((select jsonb_agg(x order by x.k) from (
      select k, count(*) filter (where status <> 'cancelled') orders,
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) gross,
        coalesce(sum(net) filter (where status <> 'cancelled'), 0) net,
        count(*) filter (where status = 'returned') returned,
        count(*) filter (where status = 'cancelled') cancelled
      from o group by k) x), '[]'::jsonb),
    'by_mp', coalesce((select jsonb_agg(x) from (
      select marketplace, count(*) filter (where status <> 'cancelled') orders,
        coalesce(sum(total) filter (where status <> 'cancelled'), 0) gross,
        coalesce(sum(net) filter (where status <> 'cancelled'), 0) net,
        count(*) filter (where status = 'returned') returned
      from o group by marketplace order by 3 desc) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x) from (
      select max(title) title, max(listing_key) listing_key, sum(qty) units, sum(qty * unit_price) gross,
        count(*) filter (where status = 'returned') returned,
        sum(case when status not in ('cancelled', 'returned') and cost_snapshot is not null then qty * (unit_price - cost_snapshot) end) margin
      from l where status <> 'cancelled' group by pk order by sum(qty) desc, sum(qty * unit_price) desc limit 15) x), '[]'::jsonb),
    'returned_products', coalesce((select jsonb_agg(x) from (
      select max(title) title, max(listing_key) listing_key, count(*) returned, sum(qty * unit_price) amount
      from l where status = 'returned' group by pk order by count(*) desc limit 10) x), '[]'::jsonb),
    'return_reasons', coalesce((select jsonb_agg(x) from (
      select coalesce(c.reason, 'Belirtilmemiş') reason, count(*) n, coalesce(sum(c.amount), 0) amount
      from public.claims c where c.claimed_at >= f and c.claimed_at < t and (p_mp is null or c.marketplace = p_mp)
      group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'claims_open', (select count(*) from public.claims c where (p_mp is null or c.marketplace = p_mp) and c.status in ('Created', 'WaitingInAction', 'InAnalysis', 'Unresolved')),
    'losers', coalesce((select jsonb_agg(x) from (
      select id, marketplace, order_no, ordered_at, total, net, status from o
      where status not in ('cancelled') and net < 0 order by net limit 10) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from o group by status) x), '{}'::jsonb)
  ) into r;
  return r || jsonb_build_object('from', p_from, 'to', p_to, 'bucket', b);
end $$;
revoke execute on function public.sales_report(date, date, text, text) from public, anon, authenticated;

-- order_upsert: fin + adet her senkronda yenilenir (maliyet satırda sabit kaldığı için kâr bozulmaz)
create or replace function public.order_upsert(p jsonb) returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; v_old text; v_old_mp text; v_new text; v_track text;
begin
  select id, status, marketplace_status, tracking_no into v_id, v_old, v_old_mp, v_track
    from orders where marketplace = p->>'marketplace' and package_id = p->>'package_id' for update;
  v_new := p->>'status';
  if v_id is null then
    insert into orders (marketplace, package_id, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline,
                        cargo_provider, tracking_no, city, customer_name, address, est_cost, est_net, needs_attention, attention_reason, last_seen_at, fin, units)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', p->>'customer_name', p->'address', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now(), p->'fin', (p->>'units')::int)
    returning id into v_id;
    insert into order_events (order_id, kind, detail) values (v_id, 'created', jsonb_build_object('marketplace_status', p->>'marketplace_status'));
  else
    if v_old in ('sent_to_supplier') and v_new in ('new', 'ready') then v_new := v_old; end if;
    update orders set
      order_no = coalesce(p->>'order_no', order_no), status = v_new, marketplace_status = p->>'marketplace_status',
      total = coalesce((p->>'total')::numeric, total), ship_deadline = coalesce((p->>'ship_deadline')::timestamptz, ship_deadline),
      cargo_provider = coalesce(p->>'cargo_provider', cargo_provider), tracking_no = coalesce(p->>'tracking_no', tracking_no),
      customer_name = case when pii_purged_at is null then coalesce(p->>'customer_name', customer_name) else null end,
      address = case when pii_purged_at is null then coalesce(p->'address', address) else null end,
      est_cost = coalesce((p->>'est_cost')::numeric, est_cost),
      est_net = case when p ? 'est_net' then (p->>'est_net')::numeric else est_net end,
      fin = coalesce(p->'fin', fin), units = coalesce((p->>'units')::int, units),
      needs_attention = coalesce((p->>'needs_attention')::boolean, needs_attention), attention_reason = case when p ? 'attention_reason' then p->>'attention_reason' else attention_reason end,
      last_seen_at = now(),
      updated_at = case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then now() else updated_at end
    where id = v_id;
    if v_old_mp is distinct from p->>'marketplace_status' then
      insert into order_events (order_id, kind, detail) values (v_id, 'status', jsonb_build_object('from', v_old_mp, 'to', p->>'marketplace_status', 'status', v_new));
    end if;
    if v_track is null and p->>'tracking_no' is not null then
      insert into order_events (order_id, kind, detail) values (v_id, 'tracking', jsonb_build_object('cargo', p->>'cargo_provider'));
    end if;
  end if;
  insert into order_lines (order_id, line_no, listing_key, product_id, variant_id, title, qty, unit_price, commission_rate, cost_snapshot, list_price, discount, ty_discount, supplier_sku)
  select v_id, (l->>'line_no')::int, l->>'listing_key', (l->>'product_id')::uuid, (l->>'variant_id')::uuid, l->>'title',
         coalesce((l->>'qty')::int, 1), (l->>'unit_price')::numeric, (l->>'commission_rate')::numeric, (l->>'cost_snapshot')::numeric,
         (l->>'list_price')::numeric, (l->>'discount')::numeric, (l->>'ty_discount')::numeric, l->>'supplier_sku'
  from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l
  on conflict (order_id, line_no) do update set
    unit_price = excluded.unit_price, list_price = excluded.list_price, discount = excluded.discount, ty_discount = excluded.ty_discount,
    commission_rate = coalesce(excluded.commission_rate, order_lines.commission_rate),
    supplier_sku = coalesce(order_lines.supplier_sku, excluded.supplier_sku),
    cost_snapshot = coalesce(order_lines.cost_snapshot, excluded.cost_snapshot),
    product_id = coalesce(order_lines.product_id, excluded.product_id);
  return case when v_old is null then 'inserted' when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then 'updated' else 'same' end;
end $$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;

-- Stok rezervasyonu (F6): tedarikçiye henüz verilmemiş açık siparişlerdeki adet, XML stoğu düşene kadar tüm pazaryerlerinde stoktan düşülür
create or replace function public.order_reservations(p_hours int default 48)
returns table (product_id uuid, listing_key text, marketplace text, qty bigint)
language sql stable security invoker set search_path = public as $$
  select ol.product_id, ol.listing_key, o.marketplace, sum(ol.qty)
  from public.orders o join public.order_lines ol on ol.order_id = o.id
  where o.status in ('new', 'ready') and o.ordered_at > now() - make_interval(hours => greatest(p_hours, 1))
  group by 1, 2, 3
$$;
revoke execute on function public.order_reservations(int) from public, anon, authenticated;
