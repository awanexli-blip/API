-- Supabase -> sunucu sipariş tarafı birleştirme (tam taşıma 12.11). orders-merge.sh çağırır; stage şeması Supabase kopyasıdır.
-- Kurallar: sipariş eşleşmesi (marketplace, package_id); iki tarafta varsa updated_at yeni olan kazanır, ama panelde girilen alanlar
-- (tedarikçi notu/kargo/takip) Supabase'den gelir (panel 12.11 04:00'e kadar orada yazıyordu). Takip kodu gönderimi daha yeni olandan
-- (aynı kod iki kez gönderilmesin). Bildirim anahtarları birleşir (eski sipariş yeniden bildirilmez). Ayar/istisna yazılmaz, fark raporlanır.
-- Son satır: \set son commit | rollback (betik ekler).
\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.names(t text, skip text[] default '{}') returns text language sql as $$
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = t and not (column_name = any(skip)) $$;
create function pg_temp.vals(t text, pre text, repl jsonb default '{}') returns text language sql as $$
  select string_agg(case when repl ? column_name then repl->>column_name else pre || quote_ident(column_name) end, ', ' order by ordinal_position)
  from information_schema.columns where table_schema = 'public' and table_name = t $$;
create function pg_temp.sets(t text, skip text[], src text) returns text language sql as $$
  select string_agg(format('%I = %s.%I', column_name, src, column_name), ', ' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = t and not (column_name = any(skip)) $$;

create temp table idmap as
  select s.id sup_id, coalesce(p.id, s.id) srv_id, (p.id is null) is_new
  from stage.orders s left join public.orders p on p.marketplace = s.marketplace and p.package_id = s.package_id;

select 'ÖNCE' as an, (select count(*) from public.orders) siparis, (select count(*) from public.order_lines) satir, (select count(*) from public.order_events) olay,
  (select count(*) from public.order_invoices) fatura, (select count(*) from public.claims) iade, (select count(*) from public.inbox_items) soru, (select count(*) from public.notifications) bildirim;
select count(*) filter (where is_new) yeni_siparis, count(*) filter (where not is_new) eslesen, count(*) filter (where not is_new and sup_id <> srv_id) farkli_kimlik from idmap;

do $$
declare n int;
begin
  -- 1) yeni siparişler
  execute format('insert into public.orders (%s) select %s from stage.orders s join idmap m on m.sup_id = s.id where m.is_new', pg_temp.names('orders'), pg_temp.vals('orders', 's.'));
  get diagnostics n = row_count; raise notice 'sipariş eklendi: %', n;

  -- 2) Supabase daha yeni: tüm satır Supabase'den (kimlik sunucuda kalır)
  execute format('update public.orders p set %s from stage.orders s join idmap m on m.sup_id = s.id where p.id = m.srv_id and not m.is_new and s.updated_at > p.updated_at',
    pg_temp.sets('orders', '{id}', 's'));
  get diagnostics n = row_count; raise notice 'sipariş Supabase''den güncellendi (daha yeni): %', n;

  -- 3) sunucu daha yeni (failover 04:00 sonrası): panel alanları Supabase'den, boşlar doldurulur, takip gönderimi yeni olandan
  update public.orders p set
    supplier_note = coalesce(s.supplier_note, p.supplier_note),
    sent_to_supplier_at = coalesce(s.sent_to_supplier_at, p.sent_to_supplier_at),
    supplier_tracking = coalesce(s.supplier_tracking, p.supplier_tracking),
    supplier_cargo = coalesce(s.supplier_cargo, p.supplier_cargo),
    tracking_push = case when s.tracking_pushed_at > coalesce(p.tracking_pushed_at, '-infinity') then s.tracking_push else coalesce(p.tracking_push, s.tracking_push) end,
    tracking_push_provider = case when s.tracking_pushed_at > coalesce(p.tracking_pushed_at, '-infinity') then s.tracking_push_provider else coalesce(p.tracking_push_provider, s.tracking_push_provider) end,
    tracking_push_error = case when s.tracking_pushed_at > coalesce(p.tracking_pushed_at, '-infinity') then s.tracking_push_error else p.tracking_push_error end,
    tracking_pushed_at = greatest(p.tracking_pushed_at, s.tracking_pushed_at),
    est_cost = coalesce(p.est_cost, s.est_cost), est_net = coalesce(p.est_net, s.est_net), fin = coalesce(p.fin, s.fin),
    act_commission = coalesce(p.act_commission, s.act_commission), act_revenue = coalesce(p.act_revenue, s.act_revenue),
    settled_at = coalesce(p.settled_at, s.settled_at), return_reason = coalesce(p.return_reason, s.return_reason),
    pii_purged_at = coalesce(p.pii_purged_at, s.pii_purged_at),
    customer_name = case when s.pii_purged_at is not null then s.customer_name else p.customer_name end,
    customer_phone = case when s.pii_purged_at is not null then s.customer_phone else p.customer_phone end,
    address = case when s.pii_purged_at is not null then s.address else p.address end
  from stage.orders s join idmap m on m.sup_id = s.id
  where p.id = m.srv_id and not m.is_new and s.updated_at <= p.updated_at;
  get diagnostics n = row_count; raise notice 'sipariş birleştirildi (sunucu daha yeni, panel alanları Supabase''den): %', n;

  -- 4) sipariş satırları: eksikler eklenir, maliyet/tedarikçi boşları doldurulur
  execute format('insert into public.order_lines (%s) select %s from stage.order_lines s join idmap m on m.sup_id = s.order_id
    on conflict (order_id, line_no) do update set cost_snapshot = coalesce(order_lines.cost_snapshot, excluded.cost_snapshot),
      supplier_sku = coalesce(order_lines.supplier_sku, excluded.supplier_sku), product_id = coalesce(order_lines.product_id, excluded.product_id),
      variant_id = coalesce(order_lines.variant_id, excluded.variant_id), vat_rate = coalesce(order_lines.vat_rate, excluded.vat_rate)',
    pg_temp.names('order_lines'), pg_temp.vals('order_lines', 's.', '{"order_id": "m.srv_id"}'));
  get diagnostics n = row_count; raise notice 'sipariş satırı eklendi/dolduruldu: %', n;

  -- 5) sipariş olayları: aynı (sipariş, zaman, tür) yoksa eklenir (kimlik sunucuda yeniden verilir)
  insert into public.order_events (order_id, at, kind, actor, detail)
  select m.srv_id, s.at, s.kind, s.actor, s.detail from stage.order_events s join idmap m on m.sup_id = s.order_id
  where not exists (select 1 from public.order_events e where e.order_id = m.srv_id and e.at = s.at and e.kind = s.kind);
  get diagnostics n = row_count; raise notice 'sipariş olayı eklendi: %', n;

  -- 6) faturalar: Supabase yetkili (fatura ekranı oraya yazıyordu); sunucudaki daha yeniyse dokunulmaz
  execute format('insert into public.order_invoices (%s) select %s from stage.order_invoices s join idmap m on m.sup_id = s.order_id
    on conflict (order_id) do update set %s where order_invoices.updated_at is null or excluded.updated_at >= order_invoices.updated_at',
    pg_temp.names('order_invoices'), pg_temp.vals('order_invoices', 's.', '{"order_id": "m.srv_id"}'), pg_temp.sets('order_invoices', '{order_id}', 'excluded'));
  get diagnostics n = row_count; raise notice 'fatura eklendi/güncellendi: %', n;

  -- 7) iadeler: yeni olan kazanır
  execute format('insert into public.claims (%s) select %s from stage.claims s
    on conflict (marketplace, claim_id) do update set %s where claims.updated_at is null or excluded.updated_at > claims.updated_at',
    pg_temp.names('claims'), pg_temp.vals('claims', 's.', '{"order_id": "(select srv_id from idmap where sup_id = s.order_id)"}'), pg_temp.sets('claims', '{marketplace,claim_id}', 'excluded'));
  get diagnostics n = row_count; raise notice 'iade eklendi/güncellendi: %', n;

  -- 8) müşteri soruları: yeni olan kazanır (cevaplanmış soru yeniden cevaplanmaz)
  execute format('insert into public.inbox_items (%s) select %s from stage.inbox_items s
    on conflict (marketplace, kind, external_id) do update set %s where inbox_items.updated_at is null or excluded.updated_at > inbox_items.updated_at',
    pg_temp.names('inbox_items'), pg_temp.vals('inbox_items', 's.'), pg_temp.sets('inbox_items', '{id,marketplace,kind,external_id}', 'excluded'));
  get diagnostics n = row_count; raise notice 'soru eklendi/güncellendi: %', n;

  -- 9) bildirim anahtarları: birleşim
  insert into public.notifications (key, sent_at) select key, sent_at from stage.notifications on conflict (key) do nothing;
  get diagnostics n = row_count; raise notice 'bildirim anahtarı eklendi: %', n;

  -- 10) uygulama durumu: yeni olan (portal oturum anahtarı hariç)
  insert into public.app_state (key, value, updated_at) select key, value, updated_at from stage.app_state where key <> 'gib_token'
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at where app_state.updated_at is null or excluded.updated_at > app_state.updated_at;
  get diagnostics n = row_count; raise notice 'uygulama durumu eklendi/güncellendi: %', n;

  -- 11) ürün istisnaları: yalnızca Supabase'de olanlar (Telegram/panelden girilen gizleme/fiyat kararları); sunucudakine dokunulmaz.
  -- Sunucu ilan turu bunları 12.11'e kadar ORDERS_SUPABASE_URL'den okuyordu; taşımadan sonra yalnızca kendi veritabanı.
  insert into public.product_overrides select * from stage.product_overrides on conflict (marketplace, barcode) do nothing;
  get diagnostics n = row_count; raise notice 'ürün istisnası eklendi: %', n;

  -- 12) kullanıcı rolleri: eksikler
  insert into public.user_roles select * from stage.user_roles on conflict (email) do nothing;
  get diagnostics n = row_count; raise notice 'kullanıcı rolü eklendi: %', n;
end $$;

select 'SONRA' as an, (select count(*) from public.orders) siparis, (select count(*) from public.order_lines) satir, (select count(*) from public.order_events) olay,
  (select count(*) from public.order_invoices) fatura, (select count(*) from public.claims) iade, (select count(*) from public.inbox_items) soru, (select count(*) from public.notifications) bildirim;
select count(*) as cift_paket from (select marketplace, package_id from public.orders group by 1, 2 having count(*) > 1) x;

-- Yazılmayanlar: fark raporu (karar elle)
select 'istisna yalnızca Supabase''de' as fark, count(*) from stage.product_overrides s where not exists (select 1 from public.product_overrides p where p.marketplace = s.marketplace and p.barcode = s.barcode)
union all select 'istisna farklı', count(*) from stage.product_overrides s join public.product_overrides p using (marketplace, barcode)
  where (s.price_override, s.hidden) is distinct from (p.price_override, p.hidden);
select 'settings' as tablo, k as alan, s.v as supabase, p.v as sunucu
from (select (jsonb_each_text(to_jsonb(x) - 'updated_at')).* from stage.settings x) s(k, v) join (select (jsonb_each_text(to_jsonb(x) - 'updated_at')).* from public.settings x) p(k, v) using (k)
where s.v is distinct from p.v
union all
select 'mp:' || s.mp, s.k, s.v, p.v
from (select x.marketplace, (jsonb_each_text(to_jsonb(x) - 'updated_at')).* from stage.marketplace_settings x) s(mp, k, v)
join (select x.marketplace, (jsonb_each_text(to_jsonb(x) - 'updated_at')).* from public.marketplace_settings x) p(mp, k, v) on p.mp = s.mp and p.k = s.k
where s.v is distinct from p.v;
