-- Değişiklik geçmişi hâlâ hızlı büyüyordu (27.10: 1,5 günde 47 MB; saatlik içe aktarma her maliyet değişikliğinde tüm varyant listesini
-- önce/sonra yazıyordu, kayıt ~1 KB, günde ~15 bin). Otomatik işlemlerde (actor e-posta değil: içe aktarma, senkron) varyant listesi ve
-- updated_* alanları tutulmaz; geriye anlamlı alan kalmazsa kayıt yazılmaz. Elle (panel kullanıcısı) yapılan değişiklikler tam kalır.
create or replace function public.audit_slim() returns trigger language plpgsql set search_path = public as $$
declare d record;
begin
  if new.entity = 'product' then
    select * into d from public.audit_diff(new.before, new.after, new.action);
    if coalesce(new.actor, '') !~ '@' and new.action = 'update' then
      d.o_before := coalesce(d.o_before, '{}'::jsonb) - 'variants' - 'updated_at' - 'updated_by' - 'source_hash';
      d.o_after := coalesce(d.o_after, '{}'::jsonb) - 'variants' - 'updated_at' - 'updated_by' - 'source_hash';
    end if;
    if new.action = 'update' and d.o_after = '{}'::jsonb then return null; end if;
    new.before := d.o_before; new.after := d.o_after;
  end if;
  return new;
end $$;
