-- Eski tedarikçinin (BayilikXML) ilanlarını kaldırma: arşiv -> 1 gün sonra kalıcı silme (worker/core/retire.ts).
alter table settings add column if not exists retire_legacy boolean not null default false;
create table if not exists listing_retire (
  marketplace text not null,
  listing_key text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  last_attempt_at timestamptz,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (marketplace, listing_key)
);
alter table listing_retire enable row level security;
