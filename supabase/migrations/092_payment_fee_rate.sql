-- Tahsilat / ödeme bedeli (K 17.11, Hepsiburada hakediş: "Tahsilat Yönetim Bedeli" satışın ~%0,87'si, KDV dahil).
alter table public.settings add column if not exists payment_fee_rate numeric;
alter table public.marketplace_settings add column if not exists payment_fee_rate numeric;
