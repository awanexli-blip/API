-- Toptancım alan eşlemesi (28.10): veritabanı yeniden kurulunca 22.10 öncesi hâline dönmüştü.
--   description (XML) = başlığın kopyası (%100)  ->  detail (ortalama ~480 karakter gerçek açıklama, %100 dolu)
--   main_category = yalnızca ana kategori ("Elektronik")  ->  category (tam yol: "Moda >>> Takı & Mücevher >>> Küpe")
-- Hem ana link hem ek linkler. Supabase SQL Editor'de çalıştır. Sonraki saatlik içe aktarmada 26 bin ürünün açıklaması ve kategorisi güncellenir
-- (değişiklik geçmişine ~40 MB yazılır, 30 günde temizlenir). Satıştaki ilanların pazaryeri açıklaması değişmez; yeni gönderimler yeni açıklamayla gider.
update suppliers set
  mapping = (mapping - 'description' - 'main_category') || '{"detail":"description","category":"category"}'::jsonb,
  feeds = (select coalesce(jsonb_agg(case when jsonb_typeof(f->'mapping') = 'object'
             then jsonb_set(f, '{mapping}', ((f->'mapping') - 'description' - 'main_category') || '{"detail":"description","category":"category"}'::jsonb)
             else f end), '[]'::jsonb) from jsonb_array_elements(coalesce(feeds, '[]'::jsonb)) f)
where code = 'toptancim'
returning code, mapping->>'detail' as aciklama, mapping->>'category' as kategori,
  (select jsonb_agg(jsonb_build_object('link', f->>'label', 'aciklama', f->'mapping'->>'detail', 'kategori', f->'mapping'->>'category')) from jsonb_array_elements(feeds) f) as ek_linkler;
