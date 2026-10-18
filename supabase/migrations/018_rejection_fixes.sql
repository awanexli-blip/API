-- Reddedilen ürünleri düzeltme (Trendyol): yasaklı kelimeler, düzeltme durumu, mağaza kategorileri
create table if not exists banned_words (
  marketplace text not null,
  word text not null,                         -- küçük harf
  source text not null default 'ret',         -- ret (Trendyol ret nedeninden) | elle
  created_at timestamptz not null default now(),
  primary key (marketplace, word)
);
-- auto: sistem düzeltiyor · needs_user: kategori/görsel/elle düzeltme gerekli · user_ready: kullanıcı düzeltti, sonraki senkronda gönderilir
-- resubmitted: yeniden onaya gönderildi · gave_up: vazgeçildi
create table if not exists listing_fixes (
  marketplace text not null,
  listing_key text not null,
  attempts int not null default 0,
  types text[] not null default '{}',
  details text,
  proposed jsonb not null default '{}'::jsonb, -- { title, description, category_id, category_name, images }
  status text not null default 'auto' check (status in ('auto', 'needs_user', 'user_ready', 'resubmitted', 'gave_up')),
  note text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
alter table banned_words enable row level security;
alter table listing_fixes enable row level security;
-- Mağazada kullanılan kategoriler (kategori düzeltmede seçim listesi)
create or replace function store_categories(mp text) returns table (category_id text, category_name text, n bigint) language sql stable set search_path = public as $$
  select category_id, max(category_name), count(*) from marketplace_listings
  where marketplace = mp and category_id is not null and status in ('live', 'pending_approval')
  group by category_id order by count(*) desc limit 1000
$$;
revoke execute on function store_categories(text) from public, anon, authenticated;
grant execute on function store_categories(text) to service_role;
