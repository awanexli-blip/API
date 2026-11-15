-- İade faturaları (K 15.11: "bireysel müşterilerin iade faturalarını kesmek istiyorum, herkese; iptalle uğraşmayacağım").
-- Her iade satırı (returns_report satır kimliği = return_key) için en fazla bir iade faturası: e-Arşiv "IADE" tipli taslak, orijinal fatura iadeTable'da.
-- Akış satış faturasıyla aynı: taslak (sistem) -> imza (K, portal) -> "İmzalananları kontrol et" durumu günceller.
create table if not exists public.order_return_invoices (
  return_key text primary key,
  order_id uuid references public.orders(id) on delete set null,
  order_no text,
  marketplace text,
  status text not null default 'creating' check (status in ('creating', 'draft', 'signed', 'error', 'deleted')),
  ettn text,
  belge_no text,
  original_belge_no text,
  amount numeric,
  vat numeric,
  lines jsonb,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.order_return_invoices enable row level security;
create index if not exists order_return_invoices_order_idx on public.order_return_invoices (order_id);
