-- 073: Küçük durum kayıtları (anahtar -> değer). İlk kullanım: GİB e-Arşiv portal oturum anahtarı (portal tek oturuma izin veriyor;
-- istek yarıda kalırsa "e-Arşiv oturumunu kapat" düğmesi bu anahtarla çıkış yapar). Yalnızca service_role erişir (RLS açık, politika yok).
create table if not exists public.app_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
