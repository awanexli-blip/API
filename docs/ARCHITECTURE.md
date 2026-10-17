# Merkezi Ürün ve Pazaryeri Platformu — Mimari

Durum: Faz 1 (ürün veritabanı, yetki, CRUD, doğrulama, arayüz). Mevcut XML → pazaryeri senkronu (`worker/`) değişmeden çalışmaya devam eder; Faz 2'de kaynağını merkezi veritabanına çevirir.

## Bugünkü sistem (incelendi, 17.10.2026)

```
BayilikXML (XML) ──> GitHub Actions: worker/sync.ts (15 dk) ──> Trendyol V2 / Hepsiburada adaptörleri
                              │  ayarlar, kategori eşleşmesi, geçmiş
                              ▼
                          Supabase  <── Vercel: Next.js 14 paneli (app/)
```

- Ürün verisi yalnızca XML'de; veritabanında ürün tablosu yok. Fiyat, eşleştirme ve stok her çalışmada XML'den yeniden hesaplanıyor.
- Pazaryeri adaptör arayüzü var (`worker/marketplaces/types.ts`): Trendyol (canlı), Hepsiburada (test bekliyor).
- Yetki: tek kullanıcı (`ADMIN_EMAIL`), Supabase Auth + sunucu tarafı `service_role`.

## Hedef

```
 Elle giriş ─┐
 CSV/Excel ──┼──> İçe aktarma (doğrula, satır hata raporu) ──> PostgreSQL (tek doğru kaynak)
 Tedarikçi XML ┘                                                 │
                                    ┌────────────────────────────┼─────────────────────────┐
                                    ▼                            ▼                         ▼
                           XML feed (imzalı URL)      İş kuyruğu (idempotent,     Panel (rol bazlı)
                                                      yeniden deneme, hız sınırı)
                                                                 │
                         Trendyol · Hepsiburada · Amazon TR · N11 · ÇiçekSepeti adaptörleri
                         (her biri kendi şeması, kimlik doğrulaması, kategori/özellik eşlemesi)
```

Kurallar: PostgreSQL tek doğru kaynak; XML yalnızca içe/dışa aktarma biçimi. Pazaryerine özgü kategori, özellik, fiyat ve ilan kimliği çekirdek ürün tablosunda değil, ayrı tablolarda. Ürün pazaryerinde doğrulanmadan "yayında" sayılmaz. Silme ve fiyat değişikliği açık işlemdir ve denetim kaydına yazılır. Kimlik bilgileri tarayıcıya gitmez.

## Veri modeli (Faz 1)

| Tablo | Amaç |
|---|---|
| `products` | Çekirdek ürün (model): `sku` (model kodu, benzersiz), başlık, açıklama, marka, iç kategori, KDV, desi, maliyet (KDV dahil), durum (`draft`/`active`/`archived`), serbest özellikler (`attributes` jsonb), kaynak (`manual`/`csv`/`xml:…`) |
| `product_variants` | Satılabilir birim: `sku` (benzersiz), `barcode` (benzersiz, GTIN ise sağlama toplamı kontrollü), varyant özellikleri (renk, beden), `stock`, `reserved` (Faz 6 rezervasyon), isteğe bağlı maliyet. Her ürünün en az 1 varyantı vardır |
| `product_images` | Sıralı görseller (https) |
| `user_roles` | Rol bazlı erişim: `admin` (her şey, kalıcı silme), `editor` (ürün yaz), `viewer` (okuma). `ADMIN_EMAIL` her zaman admin |
| `audit_log` | Kim, ne zaman, hangi kayıtta ne değiştirdi (önce/sonra) |

Yazma işlemleri tek transaction içinde Postgres fonksiyonlarıyla yapılır (`product_save`, `product_delete`): ürün + varyantlar + görseller + denetim kaydı ya hep birlikte yazılır ya hiç.

Sonraki fazların tabloları (henüz yok): `import_jobs`/`import_rows` (Faz 2), `feeds` (Faz 2), `jobs` (Faz 3), `marketplace_listings`, `marketplace_category_map`, `marketplace_prices` (Faz 4–5), `orders`, `stock_reservations` (Faz 6).

## Doğrulama (`lib/validation/product.ts`, zod)

- SKU: 2–64 karakter, `A-Z a-z 0-9 . _ -`.
- Barkod: boş olabilir. Yalnızca rakamsa 8/12/13/14 hane ve GTIN sağlama toplamı doğru olmalı. Değilse iç kod: 1–40 karakter, `A-Z a-z 0-9 . _ -` (Trendyol barkod kuralıyla uyumlu).
- KDV: 0, 1, 10, 20. Maliyet ve desi ≥ 0. Stok tam sayı ≥ 0.
- Görseller: https, en fazla 20. Varyant SKU ve barkodları ürün içinde tekrarsız.
- Aynı şema hem tarayıcıda (form hataları) hem sunucuda (API) çalışır.

## Fazlar

1. **Depo, yetki, migration, ürün CRUD** ← şimdi
2. CSV/Excel içe aktarma (satır hata raporu), XML feed içe/dışa aktarma (BayilikXML → `products`)
3. Adaptör arayüzü (mevcut `worker/marketplaces` genişletilir), iş kuyruğu, test altyapısı
4. Trendyol (Product V2, mevcut adaptör veritabanından beslenir)
5. Hepsiburada, Amazon SP-API, N11, ÇiçekSepeti
6. Siparişler, stok rezervasyonu, fiyat kuralları, izleme

## Faz 1 — kurulum ve çalıştırma

**Migration** (Supabase SQL Editor veya Supabase CLI/MCP): `supabase/migrations/003_products.sql`. Uygulandı (17.10.2026, proje `xovqsjiddoituaayyhae`), ardından Türkçe harf kısıtı güncellemesi (`products_turkish_codes`). Tekrar çalıştırmak güvenli.

**Ortam değişkenleri** (yeni değişken yok): Vercel'de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_EMAIL`.

**Kullanıcı ve rol ekleme**: Supabase > Authentication > Users ile kullanıcı oluştur, sonra SQL:
`insert into user_roles (email, role) values ('kisi@ornek.com', 'editor');` (`viewer` | `editor` | `admin`). `ADMIN_EMAIL` her zaman admin.

**API**

| Uç | Rol | İş |
|---|---|---|
| `GET /api/products?q=&status=&page=&size=` | viewer | Liste (başlık/SKU arama, durum filtresi, sayfalama) |
| `POST /api/products` | editor | Oluştur (doğrulama hatası: 422 + alan bazlı `fields`) |
| `GET /api/products/{id}` · `?audit=1` | viewer | Tek ürün · değişiklik geçmişi |
| `PUT /api/products/{id}` | editor | Tam güncelleme (listede olmayan varyant/görsel silinir) |
| `DELETE /api/products/{id}` | editor | Arşivle |
| `DELETE /api/products/{id}?hard=1&confirm=<SKU>` | admin | Kalıcı sil |
| `GET /api/me` | giriş | Kullanıcının rolü |

Hata kodları: 401 giriş yok/rol yok, 403 rol yetmiyor, 409 SKU/barkod çakışması, 422 doğrulama, 404 yok.

**Testler**: `npm test` = `tests/*.test.ts` (doğrulama, 8 test) + `worker/test/run.mjs` (senkron ve pazaryeri testleri). Veritabanı fonksiyonları geri alınan transaction içinde test edildi: oluşturma, güncelleme, varyantsız ret, tekrar eden SKU'da atomik geri alma, http görsel reddi, arşiv, kalıcı silme, denetim kaydı (8/8).

**Panel**: üstte "Ürünler" sekmesi: liste, arama, filtre, sayfalama; ürün formu (genel, fiyat/vergi, varyantlar, görseller, özellikler), arşivle, kalıcı sil (admin, SKU onayı), değişiklik geçmişi. Form, sunucuyla aynı şemayla anında doğrulanır.
