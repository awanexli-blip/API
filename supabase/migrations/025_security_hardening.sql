-- Denetim K1 (docs/DENETIM_2026-10-21.md): herkese açık (anon) anahtarla public şemasındaki nesneler okunabiliyordu.
-- Panel veriyi yalnızca sunucudan (service_role) okur; tarayıcı yalnızca supabase.auth kullanır. anon/authenticated'a public'te yetki gerekmez.
-- Tekrar çalıştırmak güvenlidir. Hiçbir şey silinmez.

-- Analiz görünümü (varsa) çağıranın yetkisiyle çalışsın (RLS atlanmasın)
do $$ begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'tmp_profit') then
    execute 'alter view public.tmp_profit set (security_invoker = true)';
  end if;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

-- Yeni nesneler de açık doğmasın
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
