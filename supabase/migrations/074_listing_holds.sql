-- 074: Pazaryerinde ELLE yapılan değişiklikleri koru (K, 30.10: "elle eklediğim/düzenlediğim ürünleri onayım olmadan yenilemesin").
-- Senkron son gönderdiği fiyat/stoğu saklar (sent_price, sent_qty, pushed_at). Sonraki çalışmada pazaryerindeki değer bundan farklıysa
-- (ve gecikme değilse) ilan bekletilir, Telegram'dan sorulur: hepsi kalsın / fiyat kalsın (stok sistemden) / sistemle eşitle.
-- first_seen_at: ilan ilk görüldüğü an (eski ilanlarda boş = özellikten önce vardı). Yeni ve hiç gönderilmemiş, fiyatı sistemden farklı ilan = elle eklenmiş.
alter table public.marketplace_listings
  add column if not exists sent_price numeric,
  add column if not exists sent_qty integer,
  add column if not exists pushed_at timestamptz,
  add column if not exists first_seen_at timestamptz;
alter table public.marketplace_listings alter column first_seen_at set default now();

create table if not exists public.listing_holds (
  id uuid not null default gen_random_uuid() unique,
  marketplace text not null,
  listing_key text not null,
  kind text not null check (kind in ('edited', 'manual_new')),
  status text not null default 'pending' check (status in ('pending', 'keep_all', 'keep_price', 'sync')),
  title text,
  mp_price numeric, mp_qty integer,       -- pazaryerinde görülen (elle girilen)
  our_price numeric, our_qty integer,     -- sistemin göndereceği
  sent_price numeric, sent_qty integer,   -- sistemin en son gönderdiği
  tg_message_id bigint,
  detected_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  primary key (marketplace, listing_key)
);
create index if not exists listing_holds_status_idx on public.listing_holds (status);
alter table public.listing_holds enable row level security;
