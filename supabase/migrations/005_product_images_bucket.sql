-- Ürün görselleri için Supabase Storage alanı.
-- Herkese açık okuma: pazaryerleri görseli bu adresten indirir. Yükleme yalnızca sunucudan (service_role, /api/products/images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
