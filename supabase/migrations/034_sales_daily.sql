-- Günlük satış özeti (worker/sync.ts, Marketplace.salesDaily): yalnızca toplamlar; müşteri verisi yok.
-- Fiyat değişikliğinin (22.10.2026 net kâr 40-60 TL) satışa etkisini ölçmek için panelde gösterilir.
create table if not exists public.sales_daily (
  marketplace text not null,
  day date not null,
  orders int not null default 0,       -- iptal olmayan sipariş paketleri
  units int not null default 0,
  revenue numeric not null default 0,  -- KDV dahil satış tutarı
  cancelled int not null default 0,
  returns int,                         -- iade talebi (talep tarihine göre); null = okunamadı
  updated_at timestamptz not null default now(),
  primary key (marketplace, day)
);
alter table public.sales_daily enable row level security;
