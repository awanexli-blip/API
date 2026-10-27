# Veritabanı yedeği

25.10'da eski veritabanı yedeksiz çöktü. O günden beri `.github/workflows/backup.yml` her gün yedek alıyor.

| Ne zaman | Ne | Saklama |
|---|---|---|
| Her gün 03:40 (TR) | Şemanın tamamı + yeri doldurulamayan tablolar (ayarlar, tedarikçiler, siparişler, iadeler, sorular, eşleşmeler, istisnalar, kurallar, marka/yasaklı kelime listeleri, kullanıcılar) | 7 gün |
| Pazar | Yukarıdakiler + ürünler, varyantlar, görseller, ilanlar | 35 gün |

Verisi hiç alınmayan tablolar (yeniden üretilir): `audit_log`, `supplier_stock_snap`, `mp_categories`, `mp_category_attrs`, `attr_options`, `listing_buybox`, `marketplace_brands`, `import_rows`, `unmapped_categories`.

Her yedek runner'da boş bir Postgres'e geri yüklenir, tablo tablo satır sayısı canlıyla karşılaştırılır. Tutmazsa iş akışı hata verir ve Telegram'a uyarı gider. Dosya AES-256 ile şifrelenir. Depo herkese açık olduğu için şifresiz dosya yüklenmez.

## Kurulum (bir kez)

1. **Veritabanı adresi:** Supabase → proje `trentakip-v2` → üstte **Connect** → **Session pooler** → URI'yi kopyala (`postgresql://postgres.utuwjqfcaiqlqdzzagmm:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`). `[YOUR-PASSWORD]` yerine veritabanı parolasını yaz. Parolayı bilmiyorsan Supabase → Project Settings → Database → **Reset database password**. Yeni parolayı yalnızca harf ve rakamdan seç (özel karakter adreste sorun çıkarır). Parolayı sıfırlamak API anahtarlarını, paneli ve senkronu etkilemez.
2. **Yedek parolası:** en az 16 karakterlik uzun bir parola uydur. **Bunu kaybedersen yedekler açılamaz:** parola yöneticisine ya da kâğıda kaydet.
3. GitHub → depo → Settings → Secrets and variables → Actions → **New repository secret**:
   - `SUPABASE_DB_URL2` = 1. adımdaki adres
   - `BACKUP_PASSPHRASE` = 2. adımdaki parola
4. GitHub → Actions → **Veritabanı yedeği** → Run workflow → `daily`. Yeşil bitince bir kez de `full` çalıştır. Özet sayfasında "Yedek doğrulandı" ve tablo/sayı listesi görünür.

## Geri yükleme (veritabanı yine çökerse)

1. GitHub → Actions → Veritabanı yedeği → son yeşil çalışma → Artifacts → `db-full-...` (en son pazar) ve ondan yeniyse `db-daily-...` indir.
2. Şifreyi çöz (Git Bash):
   ```bash
   gpg --pinentry-mode loopback -d -o full.dump trentakip-full-AAAAGG-SSDD.dump.gpg   # parolayı sorar
   ```
3. Supabase'de yeni proje aç. Connect → Session pooler adresini al.
4. Tam yedeği yükle (PostgreSQL 17 istemcisi gerekir):
   ```bash
   pg_restore --no-owner --no-privileges -d "postgresql://...yeni-adres..." full.dump
   ```
5. Günlük yedek daha yeniyse kritik tabloları ondan güncelle: Claude'a "günlük yedekten siparişleri ve ayarları geri yükle" de. Önce mevcut satırların yerine konması gerekir, silme içeren SQL'i sen çalıştırırsın.
6. GitHub Secrets (`SUPABASE_URL2`, `SUPABASE_SERVICE_ROLE_KEY2`, `SUPABASE_DB_URL2`) ve Vercel değişkenlerini yeni projeye çevir.

## Eski veritabanından kurtarma

Eski proje (`xovqsjiddoituaayyhae`) 28.10'da "ACTIVE_HEALTHY" görünüyor ama bağlantı kabul etmiyor. Destek açarsa: Actions → **Eski veritabanından kurtarma** → `check` (yalnızca rapor) → uygunsa `apply`. Yalnızca yeni veritabanında olmayan satırlar eklenir. Kâr kuralları kapalı gelir, elle fiyat ve kategori komisyonu boş gelir (eski değerler raporda ve istisna notunda), panelden bakıp açarsın.
