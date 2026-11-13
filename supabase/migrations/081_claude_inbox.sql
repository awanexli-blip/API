-- Telegram -> Claude köprüsü (K 14.11: "Telegram'dan mesaj atacağım, sen buradan iş yapacaksın").
-- /claude ile açılan modda K'nın mesajları buraya yazılır; Claude Code oturumu (bilgisayar açıkken) okur, cevabı bot ile yazar.
create table if not exists public.claude_inbox (
  id bigserial primary key,
  text text not null,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
alter table public.claude_inbox enable row level security;
create index if not exists claude_inbox_unseen_idx on public.claude_inbox (id) where seen_at is null;
