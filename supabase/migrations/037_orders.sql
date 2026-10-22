-- Faz 6 F1: siparişler (docs/FAZ6_PLAN.md). Pazaryerinden salt okunur çekilir (worker/core/orders.ts).
-- KVKK: müşteri adı/telefon/adres kolonları var ama ŞİMDİLİK DOLDURULMUYOR (yalnızca il). Tedarikçiye iletme (F4) ve
-- KVKK/S0.5 kararından sonra açılacak. RLS açık, erişim yalnızca sunucu (service_role).
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  package_id text not null,                 -- pazaryeri paket/sipariş kimliği (tekil)
  order_no text,
  status text not null default 'new',       -- iç durum: new, ready, sent_to_supplier, shipped, delivered, cancelled, returned, problem
  marketplace_status text,
  total numeric,                            -- KDV dahil, indirimler sonrası
  currency text not null default 'TRY',
  ordered_at timestamptz,
  ship_deadline timestamptz,
  cargo_provider text,
  tracking_no text,
  city text,
  customer_name text, customer_phone text, address jsonb,   -- F4 öncesi boş kalır
  est_cost numeric,                         -- sipariş anı maliyet toplamı
  est_net numeric,                          -- tahmini net kâr (fiyat motoruyla, KDV/komisyon/kargo sonrası)
  needs_attention boolean not null default false,
  attention_reason text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, package_id)
);
create index if not exists orders_mp_date_idx on public.orders (marketplace, ordered_at desc);
create index if not exists orders_status_idx on public.orders (status, ordered_at desc);
alter table public.orders enable row level security;

create table if not exists public.order_lines (
  order_id uuid not null references public.orders(id) on delete cascade,
  line_no int not null,
  listing_key text,
  product_id uuid,
  variant_id uuid,
  title text,
  qty int not null default 1,
  unit_price numeric,                       -- KDV dahil birim satış
  commission_rate numeric,
  cost_snapshot numeric,                    -- birim maliyet (sipariş anı)
  primary key (order_id, line_no)
);
create index if not exists order_lines_product_idx on public.order_lines (product_id);
alter table public.order_lines enable row level security;

create table if not exists public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                       -- created, status, tracking, note
  actor text not null default 'sync',
  detail jsonb
);
create index if not exists order_events_order_idx on public.order_events (order_id, at);
alter table public.order_events enable row level security;

-- Tekrar çalıştırmada kopya yok: (marketplace, package_id) üzerinden upsert; durum değişince olay yazılır.
-- İç durum geri gitmez: tedarikçiye iletilmiş sipariş pazaryerinde hâlâ "hazırlanıyor" görünse de sent_to_supplier kalır.
-- Satır maliyeti ilk kayıtta sabitlenir (sonradan XML maliyeti değişse geçmiş kâr bozulmaz).
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
                        cargo_provider, tracking_no, city, est_cost, est_net, needs_attention, attention_reason, last_seen_at)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now())
    returning id into v_id;
    insert into order_lines (order_id, line_no, listing_key, product_id, variant_id, title, qty, unit_price, commission_rate, cost_snapshot)
    select v_id, (l->>'line_no')::int, l->>'listing_key', (l->>'product_id')::uuid, (l->>'variant_id')::uuid, l->>'title',
           coalesce((l->>'qty')::int, 1), (l->>'unit_price')::numeric, (l->>'commission_rate')::numeric, (l->>'cost_snapshot')::numeric
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l
    on conflict do nothing;
    insert into order_events (order_id, kind, detail) values (v_id, 'created', jsonb_build_object('marketplace_status', p->>'marketplace_status'));
    return 'inserted';
  end if;
  if v_old in ('sent_to_supplier') and v_new in ('new', 'ready') then v_new := v_old; end if;
  update orders set
    order_no = coalesce(p->>'order_no', order_no), status = v_new, marketplace_status = p->>'marketplace_status',
    total = coalesce((p->>'total')::numeric, total), ship_deadline = coalesce((p->>'ship_deadline')::timestamptz, ship_deadline),
    cargo_provider = coalesce(p->>'cargo_provider', cargo_provider), tracking_no = coalesce(p->>'tracking_no', tracking_no),
    needs_attention = coalesce((p->>'needs_attention')::boolean, needs_attention), attention_reason = coalesce(p->>'attention_reason', attention_reason),
    last_seen_at = now(),
    updated_at = case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then now() else updated_at end
  where id = v_id;
  if v_old_mp is distinct from p->>'marketplace_status' then
    insert into order_events (order_id, kind, detail) values (v_id, 'status', jsonb_build_object('from', v_old_mp, 'to', p->>'marketplace_status', 'status', v_new));
  end if;
  if v_track is null and p->>'tracking_no' is not null then
    insert into order_events (order_id, kind, detail) values (v_id, 'tracking', jsonb_build_object('cargo', p->>'cargo_provider'));
  end if;
  return case when v_old is distinct from v_new or v_old_mp is distinct from p->>'marketplace_status' then 'updated' else 'same' end;
end $$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;
