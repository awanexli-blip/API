-- Tedarikçi varsayılan ürün özellikleri (özellik adı -> değer adı), pazaryeri zorunlu özelliği XML'de yoksa kullanılır.
-- Örnek: {"Menşei": "Çin", "Garanti Süresi": "2 Yıl"}. Yalnızca doğruluğu tedarikçiden teyit edilmiş değerler girilmeli.
alter table suppliers add column if not exists default_attributes jsonb not null default '{}'::jsonb;
