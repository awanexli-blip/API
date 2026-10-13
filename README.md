# Trendyol Kontrol Paneli

- `worker/` : XML'i çeker, fiyat/stok hesaplar, Trendyol'a gönderir (GitHub Actions çalıştırır)
- `app/` : Vercel'de çalışan kontrol paneli (marj, komisyon, kargo, kategori eşleştirme, manuel tetikleme)
- `supabase/schema.sql` : ayarlar ve durum tabloları

## Kurulum

1. **Supabase**: SQL Editor'de `supabase/schema.sql` dosyasını çalıştır.
   Authentication > Users > "Add user" ile kendi e-posta ve şifrenle kullanıcı oluştur.
   Authentication > Sign In / Providers bölümünde yeni kayıtları (sign ups) kapat.
2. **GitHub > Settings > Secrets and variables > Actions** içine şunları ekle:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `XML_URL`, `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`,
   `TRENDYOL_API_SECRET`, `TRENDYOL_CARGO_COMPANY_ID`, `TRENDYOL_SHIPMENT_ADDRESS_ID`, `TRENDYOL_RETURN_ADDRESS_ID`
3. **Vercel**: repoyu içe aktar, `.env.example` içindeki "Vercel" değişkenlerini Environment Variables'a gir.
   `GH_TOKEN` için GitHub > Settings > Developer settings > Fine-grained tokens: sadece bu repo, izin: Actions (Read and write).
4. Panele gir > **Önizleme** çalıştır. Actions sekmesinden `preview-csv` dosyasını indirip fiyatları kontrol et.
5. **Kategoriler** sekmesinde eşleşmeyen kategorileri Trendyol ID'leriyle eşleştir.
6. Fiyatlar uygunsa **Stok ve fiyatı güncelle**, sonra **Yeni ürünleri aç** çalıştır.
   Zamanlı çalışma her 4 saatte bir `auto` modunda çalışır (`.github/workflows/sync.yml`).

## Güvenlik

- Anahtarları asla koda veya sohbete yazma, sadece GitHub Secrets ve Vercel env içinde dursun.
- Panel yalnızca `ADMIN_EMAIL` ile giriş yapan kullanıcıya açıktır.
- `service_role` anahtarı sadece sunucu tarafında kullanılır, tarayıcıya gitmez.
