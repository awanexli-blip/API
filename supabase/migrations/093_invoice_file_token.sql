-- Hepsiburada fatura linki (K 17.11): imzalı e-Arşiv PDF'i sunucuda /var/lib/trentakip/invoices/<file_token>.pdf,
-- herkese açık ama tahmin edilemez adres /api/invoice-file/<file_token>; HB paketine bu link gönderilir.
alter table public.order_invoices add column if not exists file_token text;
create unique index if not exists order_invoices_file_token_key on public.order_invoices (file_token) where file_token is not null;
