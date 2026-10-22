-- Faz 6 F7: müşteri soruları (gelen kutusu). Cevap taslağı yapay zekâdan, gönderim YALNIZCA insan onayıyla (panel veya Telegram).
-- Müşteri adı saklanmaz. Durum: new -> drafted -> approved -> sending -> answered | failed; ignored; answered_elsewhere (pazaryerinden cevaplanmış).
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  kind text not null default 'question',
  external_id text not null,
  product_title text,
  product_key text,
  product_id uuid,
  image_url text,
  text text not null,
  asked_at timestamptz,
  status text not null default 'new',
  ai_draft text,
  ai_unsure boolean,
  ai_note text,
  final_answer text,
  approved_by text,
  approved_at timestamptz,
  answered_at timestamptz,
  last_error text,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, kind, external_id)
);
create index if not exists inbox_status_idx on public.inbox_items (status, asked_at desc);
alter table public.inbox_items enable row level security;

-- Ton tercihi (yapay zekâ taslağına eklenir)
alter table public.settings add column if not exists answer_tone text;
