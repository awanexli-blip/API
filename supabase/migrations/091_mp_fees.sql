-- Gider takibi (K 17.11: "her ürün için 50 net kâr diyoruz, kaçırdığımız bir şey varsa direkt zarar ederiz").
-- Trendyol cari hesap kesintileri (otherfinancials: kargo, platform, komisyon faturası, ceza, reklam, duyuru, stopaj) ve kargo faturası
-- kalemleri (sipariş bazında gerçek kargo + desi). worker/fees.ts günlük doldurur. Müşteri verisi yok.
create table if not exists public.mp_fees (
  marketplace text not null,
  fee_id text not null,               -- kesinti: Trendyol kayıt id; kargo kalemi: "<fatura>:<parcelUniqueId>:<tip>"
  kind text not null,                 -- Trendyol işlem tipi ("Kargo Fatura", "Tedarik Edememe", "Gönderi Kargo Bedeli", ...)
  category text not null,             -- kargo | iade_kargo | platform | komisyon | ceza | reklam | duyuru | stopaj | diger
  order_no text,
  package_id text,
  amount numeric not null,            -- gider pozitif (borç - alacak), TL KDV dahil
  desi numeric,
  invoice_id text,                    -- kargo kalemi: bağlı kargo faturası
  fee_date timestamptz,
  description text,
  fetched_at timestamptz not null default now(),
  primary key (marketplace, fee_id)
);
alter table public.mp_fees enable row level security;
create index if not exists mp_fees_order on public.mp_fees (marketplace, order_no);
create index if not exists mp_fees_date on public.mp_fees (marketplace, fee_date desc);

-- Siparişin gerçek kargosu (kargo faturası kalemlerinden; tahmin orders.fin.shipping)
alter table public.orders add column if not exists act_shipping numeric;
alter table public.orders add column if not exists act_desi numeric;
-- Ürünün kargo faturasından öğrenilen gerçek desisi (tedarikçi desisi güvenilmez: binlerce ürün "1")
alter table public.products add column if not exists desi_actual numeric;
