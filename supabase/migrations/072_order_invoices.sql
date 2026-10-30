-- 072: Sipariş faturaları (GİB e-Arşiv portalı, taslak -> K portalda toplu SMS ile imzalar -> sistem "imzalandı" işaretler).
-- Sistem fatura İMZALAMAZ; yalnızca taslak oluşturur ve durumu okur. Alıcı bilgisi burada tutulmaz (orders'tan okunur, GİB'e gider).
create table if not exists public.order_invoices (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null check (status in ('creating', 'draft', 'signed', 'uploaded', 'error', 'deleted')),
  ettn text,
  belge_no text,
  amount numeric,
  vat numeric,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  signed_at timestamptz,
  uploaded_at timestamptz
);
create index if not exists order_invoices_status_idx on public.order_invoices (status);
alter table public.order_invoices enable row level security;
