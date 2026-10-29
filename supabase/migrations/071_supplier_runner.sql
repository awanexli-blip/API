-- 071: Tedarikçi XML'i yalnızca sabit IP'li sunucudan okunsun (IP izinli tedarikçi; GitHub/Vercel IP'leri değişken, bağlantıyı reddediyor).
-- 'vps' = GitHub içe aktarması atlar (hata sayılmaz, stok sıfırlanmaz), sunucu (trentakip-supplier-vps) okur. Boş = her yerden.
alter table public.suppliers add column if not exists runner text check (runner is null or runner in ('vps'));
