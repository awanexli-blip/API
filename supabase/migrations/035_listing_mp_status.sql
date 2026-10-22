-- Pazaryerinin ürün başına verdiği inceleme durumu (Hepsiburada: Satışa Hazır / İncelenecek / ret nedeni) ve
-- sonucu sonradan yeniden sorulacak toplu gönderim numaraları. Panel: Pazaryeri > Gönderim durumu.
alter table public.marketplace_listings
  add column if not exists mp_status text,          -- pazaryerinin kendi durum metni
  add column if not exists mp_reasons text,         -- ret / doğrulama mesajları
  add column if not exists mp_checked_at timestamptz;

create table if not exists public.mp_batches (
  marketplace text not null,
  batch_id text not null,          -- "product:<takip no>"
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  checks int not null default 0,
  done boolean not null default false,
  primary key (marketplace, batch_id)
);
alter table public.mp_batches enable row level security;
create index if not exists mp_batches_open_idx on public.mp_batches (marketplace, done, checked_at);

-- Toplu yazım (worker/core/mp-status.ts): [{id, status, reasons, bad}]. Hatalıysa gönderilmiş ilan "rejected" olur,
-- daha önce reddedilmiş ilan sonradan onaylanırsa yeniden "sent" (canlı listede görünce "live").
create or replace function public.listing_mp_status_apply(p_mp text, p_rows jsonb) returns int
language sql security invoker set search_path = public as $$
  with r as (select * from jsonb_to_recordset(p_rows) as x(id text, status text, reasons text, bad boolean)),
  u as (
    update public.marketplace_listings l set
      mp_status = r.status, mp_reasons = nullif(r.reasons, ''), mp_checked_at = now(),
      status = case when r.bad and l.status = 'sent' then 'rejected'
                    when not r.bad and l.status = 'rejected' then 'sent' else l.status end,
      last_error = case when r.bad and l.status = 'sent' then left('Hepsiburada: ' || r.status || coalesce(' · ' || nullif(r.reasons, ''), ''), 500)
                        when not r.bad and l.status = 'rejected' then null else l.last_error end,
      updated_at = case when (r.bad and l.status = 'sent') or (not r.bad and l.status = 'rejected') then now() else l.updated_at end
    from r where l.marketplace = p_mp and l.listing_key = r.id
    returning 1)
  select count(*)::int from u;
$$;
revoke execute on function public.listing_mp_status_apply(text, jsonb) from public, anon, authenticated;

-- 22.10 gönderimlerinin takip numaraları (çalıştırma özetlerinde kalanlar) yeniden sorgulansın
insert into public.mp_batches (marketplace, batch_id, created_at)
select distinct r.marketplace, b, r.started_at
from public.sync_runs r, jsonb_array_elements_text(coalesce(r.summary->'batchIds', '[]'::jsonb)) b
where r.marketplace = 'hepsiburada' and b like 'product:%'
on conflict do nothing;
