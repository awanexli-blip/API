-- Akıllı kâr kuralları (worker/pricing-rules.ts). Sırayla uygulanır; eşleşen kural doldurduğu alanları ezer.
-- marketplace: 'all' veya pazaryeri kodu. cond: { cost_min, cost_max, supplier, category, brand, stock_max }
create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null default 'all',
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  enabled boolean not null default true,
  cond jsonb not null default '{}'::jsonb,
  target_profit_rate numeric check (target_profit_rate is null or (target_profit_rate >= 0 and target_profit_rate <= 0.6)),
  min_net_profit numeric check (min_net_profit is null or (min_net_profit >= 0 and min_net_profit <= 100000)),
  add_profit_rate numeric check (add_profit_rate is null or (add_profit_rate >= -0.3 and add_profit_rate <= 0.3)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table pricing_rules enable row level security;
