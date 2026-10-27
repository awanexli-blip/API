-- Telegram bildirimleri (K, 27.10: "önemli her şeyi Telegram'dan göndersin, olabildiğince hızlı"): aynı olay bir kez gönderilir.
-- Anahtar örnekleri: claim:trendyol:123, cancel:<sipariş>, ship:<sipariş>:late, sync:hepsiburada:2026-10-27T18, db:2026-10-27, daily:2026-10-27
create table if not exists public.notifications (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table public.notifications enable row level security;

-- Veritabanı boyutu (ücretsiz plan 500 MB; 400 MB'da uyarı)
create or replace function public.db_size_bytes() returns bigint language sql stable security invoker set search_path = public as $$
  select pg_database_size(current_database())
$$;
revoke execute on function public.db_size_bytes() from public, anon, authenticated;
