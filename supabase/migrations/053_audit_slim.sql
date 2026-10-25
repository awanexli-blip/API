-- Değişiklik geçmişi (audit_log) yalnızca değişen alanları tutar (25.10): otomatik içe aktarmalar her fiyat/stok değişikliğinde ürünün
-- tam kopyasını önce/sonra iki kez yazıyordu (442 MB, ücretsiz plan sınırı 500 MB). Değişiklik olmayan güncelleme kaydı yazılmaz;
-- yeni ürün kaydında kimlik bilgisi (sku, başlık, kaynak, maliyet) yeter (tam hali ürün tablosunda).
create or replace function public.audit_diff(p_before jsonb, p_after jsonb, p_action text, out o_before jsonb, out o_after jsonb)
language plpgsql immutable set search_path = public as $$
declare k text;
begin
  o_before := p_before; o_after := p_after;
  if p_before is not null and p_after is not null and jsonb_typeof(p_before) = 'object' and jsonb_typeof(p_after) = 'object' then
    o_before := '{}'::jsonb; o_after := '{}'::jsonb;
    for k in select jsonb_object_keys(p_after) union select jsonb_object_keys(p_before) loop
      if (p_before -> k) is distinct from (p_after -> k) then
        o_before := o_before || jsonb_build_object(k, p_before -> k);
        o_after := o_after || jsonb_build_object(k, p_after -> k);
      end if;
    end loop;
  elsif p_action = 'create' and p_after is not null and jsonb_typeof(p_after) = 'object' then
    o_after := jsonb_strip_nulls(jsonb_build_object('sku', p_after -> 'sku', 'title', p_after -> 'title', 'source', p_after -> 'source', 'cost_price', p_after -> 'cost_price'));
  end if;
end $$;

create or replace function public.audit_slim() returns trigger language plpgsql set search_path = public as $$
declare d record;
begin
  if new.entity = 'product' then
    select * into d from public.audit_diff(new.before, new.after, new.action);
    if new.action = 'update' and d.o_after = '{}'::jsonb then return null; end if;
    new.before := d.o_before; new.after := d.o_after;
  end if;
  return new;
end $$;
create or replace trigger audit_slim_trg before insert on public.audit_log for each row execute function public.audit_slim();
create index if not exists audit_log_at_idx on public.audit_log (at);
revoke execute on function public.audit_diff(jsonb, jsonb, text) from public, anon, authenticated;

-- Mevcut kayıtlar (canlıda ilk 20.000 kayıt küçültüldü; kalanı kullanıcı Supabase SQL Editor'de çalıştırır):
--   update audit_log a set before = d.o_before, after = d.o_after from lateral public.audit_diff(a.before, a.after, a.action) d
--   where a.entity = 'product' and a.id > 20191;
--   vacuum full audit_log;   -- boşalan alanı diske geri verir (tablo birkaç dakika kilitlenir)
