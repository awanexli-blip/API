-- Yeni ürünlerin markası panelden seçilir; önceki seçimler geri alınabilsin diye geçmiş tutulur.
-- Boş brand_name = ortam değişkeni TRENDYOL_BRAND_NAME veya "Eco Lounge".
alter table marketplace_settings add column if not exists brand_name text;
alter table marketplace_settings add column if not exists brand_history jsonb not null default '[]'::jsonb;
