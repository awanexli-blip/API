-- Kurumsal fatura (K 13.11, Trendyol "Kurumsal Faturalı Siparişler" rehberi).
-- buyer_type: bireysel | kurumsal | kurumsal_efatura (alıcı e-Fatura mükellefi: e-Arşiv değil e-Fatura kesilir).
-- Ünvan / VKN / vergi dairesi orders.address->'invoice' içinde; adresle birlikte orders_purge_pii ile silinir.
alter table public.orders add column if not exists buyer_type text not null default 'bireysel'
  check (buyer_type in ('bireysel', 'kurumsal', 'kurumsal_efatura'));
create index if not exists orders_buyer_type_idx on public.orders (buyer_type) where buyer_type <> 'bireysel';

-- order_upsert: buyer_type yazılır (sunucudaki canlı tanım + buyer_type)
CREATE OR REPLACE FUNCTION public.order_upsert(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_old text; v_old_mp text; v_new text; v_track text;
begin
  select id, status, marketplace_status, tracking_no into v_id, v_old, v_old_mp, v_track
    from orders where marketplace = p->>'marketplace' and package_id = p->>'package_id' for update;
  v_new := p->>'status';
  if v_id is null then
    insert into orders (marketplace, package_id, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline,
                        cargo_provider, tracking_no, city, customer_name, address, est_cost, est_net, needs_attention, attention_reason, last_seen_at, fin, units, buyer_type)
    values (p->>'marketplace', p->>'package_id', p->>'order_no', v_new, p->>'marketplace_status', (p->>'total')::numeric,
            coalesce(p->>'currency', 'TRY'), (p->>'ordered_at')::timestamptz, (p->>'ship_deadline')::timestamptz,
            p->>'cargo_provider', p->>'tracking_no', p->>'city', p->>'customer_name', p->'address', (p->>'est_cost')::numeric, (p->>'est_net')::numeric,
            coalesce((p->>'needs_attention')::boolean, false), p->>'attention_reason', now(), p->'fin', (p->>'units')::int, coalesce(p->>'buyer_type', 'bireysel'))
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
      buyer_type = coalesce(p->>'buyer_type', buyer_type),
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
end $function$;
revoke execute on function public.order_upsert(jsonb) from public, anon, authenticated;
