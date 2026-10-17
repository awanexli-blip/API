-- Kategori eşleşmesinde pazaryeri kategori adı (panelde ID yerine ad gösterilir)
alter table category_map add column if not exists category_name text;
