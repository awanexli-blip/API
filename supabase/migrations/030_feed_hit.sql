-- Denetim S2.3: feed erişim sayacı atomik (eşzamanlı isteklerde sayım kaybolmaz). Tekrar çalıştırmak güvenli.
create or replace function public.feed_hit(fid uuid) returns void language sql security invoker set search_path = public as $$
  update public.feeds set access_count = coalesce(access_count, 0) + 1, last_access_at = now() where id = fid;
$$;
revoke execute on function public.feed_hit(uuid) from public, anon, authenticated;
