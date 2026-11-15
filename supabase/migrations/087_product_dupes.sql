-- Tedarikçiler arası birebir aynı ürünler (K 16.11: "aynı ürünlerden ucuz hangisi ise onu ekleyeceğiz").
-- worker/supplier-dupes.ts doldurur: benzer başlık + aynı ana görsel (dHash). Her grupta en ucuz stoklu ürün cheapest=true.
-- Gönderim (db-products.ts) ve yıldız kuyruğu, grubun en ucuzu olmayan ürünü yeni ilan olarak açmaz (en ucuzun stoğu varken).
create table if not exists public.product_dupes (
  product_id uuid primary key references public.products(id) on delete cascade,
  group_id text not null,
  source text,
  cost numeric,
  stock integer,
  cheapest boolean not null default false,
  computed_at timestamptz not null default now()
);
alter table public.product_dupes enable row level security;
create index if not exists product_dupes_group_idx on public.product_dupes (group_id);
