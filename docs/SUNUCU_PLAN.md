# Sunucu ana sistem, Vercel + GitHub + Supabase yedekte (K, 01.11.2026)

K'nın kararı: panel, zamanlanmış işler ve veritabanı **sunucuda** (89.252.153.187, trentakip.duckdns.org) çalışır. Vercel paneli, GitHub Actions
ve Supabase **hazırda bekler**; sunucu çökerse dakikalar içinde onlara dönülür. Yeni tedarikçiler (Hepsibayi, Bezos) yalnızca sunucuda;
Supabase'e yalnızca "yedek çekirdek" yazılır, kotası (500 MB) doldurulmaz.

## 1. Düzen

| Görev | Normalde (aktif) | Çökmede (yedek) |
|---|---|---|
| Veritabanı | Sunucu Postgres (+PostgREST, GoTrue, görsel deposu) | Supabase (her gece sunucudan çekirdek kopya) |
| Panel | Sunucuda Next.js, `panel.trentakip.duckdns.org` | `trentakip.vercel.app` (Supabase'e bağlı, hiç değiştirilmez) |
| Zamanlanmış işler (senkron, içe aktarma, yedek, fatura) | Sunucu zamanlayıcıları (systemd) | GitHub Actions (aynı iş akışları; `ACTIVE_SITE` değişkeni `github` olunca çalışır) |
| Tedarikçi IP izni | Sunucunun sabit IP'si | Yalnızca IP izni istemeyen tedarikçiler (Toptancım) |
| Telegram | Sunucudaki panelin webhook'u | Vercel panelindeki "Telegram'ı bağla" düğmesi |
| Kod | GitHub (her iki taraf da oradan alır) | GitHub |

## 2. Yedek tarafı güncel tutma (her gece, sunucu -> Supabase)

Yalnızca çekirdek tablolar kopyalanır (yaklaşık 350 MB; Supabase sınırı 500 MB):
- ayarlar, kategoriler, istisnalar, kâr kuralları, marka listeleri, kullanıcılar
- siparişler, sipariş satırları, faturalar, iadeler, müşteri soruları
- Toptancım (ve Supabase'de çalışabilen diğer tedarikçiler) ürünleri, varyantları, görselleri
- ilan tablosu (tüm ilanlar, bağlantıyla)
- son 30 günün senkron / içe aktarma / işlem kaydı (eskisi yalnızca sunucuda)

**Kopyalanmaz** (kota): Hepsibayi / Bezos ürün verisi, puanlar, yapay zekâ taslakları, 30 günden eski kayıtlar.
Bunun yerine Supabase'e **"yalnızca sunucuda yönetilen ilanlar" listesi** (anahtar + pazaryeri, birkaç KB) yazılır: çökmede bu ilanların stoğu 0 yapılır.

Kopya bitince Telegram'a tek satır: "Yedek kopya tamam: N sipariş, M ilan, X MB". Supabase ücretsiz projesi 7 gün işlem görmezse
duraklatılır; gece kopyası bunu da önler.

## 3. Çökmeyi fark etme

İzleme **sunucunun dışından** yapılmalı (sunucu çökünce kendi uyarısını gönderemez): GitHub Actions 10 dakikada bir sunucuyu yoklar
(panel, veritabanı API'si, son senkronun zamanı). 2 kez üst üste cevap yoksa Telegram: "🚨 Sunucu yanıt vermiyor".
Sunucu içinde ayrıca disk %85, bellek, servis durdu uyarıları.

## 4. Çökme anında yapılacaklar (hedef 15 dakika)

1. **Telegram uyarısı gelir.** Cenuta panelinden sunucuyu yeniden başlatmayı dene (5 dk). Açılırsa dur, sorun yok.
2. Açılmazsa: GitHub -> Settings -> Variables -> `ACTIVE_SITE` = `github`. Bundan sonra senkron ve içe aktarma GitHub'dan Supabase'e karşı çalışır.
3. GitHub Actions -> **"Yedeğe geç"** iş akışını çalıştır (hazırlanacak): Supabase'deki listeden yalnızca sunucuda yönetilen ilanların
   (Hepsibayi / Bezos) stoğunu Trendyol ve Hepsiburada'da 0 yapar (stoğu takip edilemeyen ürün satılmasın).
4. Paneli `trentakip.vercel.app` adresinden aç; Ayarlar -> Telegram'ı bağla (webhook Vercel'e döner).
5. Siparişler: senkron son 3 günün siparişlerini pazaryerinden yeniden çeker, kayıp olmaz. Son gece kopyasından sonra kesilen faturalar
   Supabase'de görünmez: "İmzalananları kontrol et" GİB portalından okur ve bağlar (GİB asıl kaynak).

## 5. Çökmede ne kalır, ne durur

| | Durum |
|---|---|
| Toptancım ilanları (bugün Trendyol 774, Hepsiburada 233 stoklu) | **Satışta kalır**; stok/fiyat GitHub + Supabase ile güncellenir |
| Hepsibayi / Bezos ilanları | **Stok 0** (4. adım 3); sunucu dönünce kendiliğinden açılır |
| Faaliyet kapsamı, marka riski, fiyat formülü | Aynen çalışır (kod ortak, ayarlar kopyada) |
| Yeni sipariş, müşteri sorusu, Telegram | Çalışır (4. adım sonrası) |
| Faturalar (GİB) | Çalışır; son kopyadan sonraki bağlantılar "İmzalananları kontrol et" ile |
| Yıldızlı ürün seçimi, yapay zekâ tamamlama, yeni tedarikçiden gönderim | **Durur** (veri yalnızca sunucuda) |
| Son kopyadan çökme anına kadar panelde yapılan değişiklikler (ayar, ürün düzenleme) | **Kaybolur** (en çok 1 gün); sunucu dönünce geri gelir |

## 6. Sunucu dönünce

1. Sunucuyu aç, servisler ve veritabanı sağlam mı (izleme yeşil).
2. Çökme süresince Supabase'e yazılanlar (sipariş, fatura, iade, soru, ayar) sunucuya geri alınır: **"Sunucuya dön"** betiği (hazırlanacak; yalnızca o aralıktaki satırlar, çakışmada Supabase'deki kazanır).
3. `ACTIVE_SITE` = `sunucu`. Telegram'ı sunucudaki panelden yeniden bağla. Hepsibayi / Bezos stokları ilk senkronda geri gelir.

## 7. Kurulum sırası (her adım ayrı denenir, geri alınabilir)

1. Sunucuda gece yedeği (şifreli, sunucu dışına kopya) + iç izleme (disk, bellek, servis). Supabase'e dokunmaz.
2. Geçiş betiği: Supabase'den son tam kopya + sunucuya özel verinin (Hepsibayi, Bezos, yıldızlar, deneme ilanları) korunması.
3. Panel sunucuda (deneme adresinde; Vercel değişmez). Giriş, ürünler, siparişler, faturalar birlikte denenir.
4. Zamanlanmış işler sunucuya; GitHub iş akışları `ACTIVE_SITE` ile beklemeye. Dış izleme GitHub'da.
5. Gece "sunucu -> Supabase çekirdek kopya" + "Yedeğe geç" + "Sunucuya dön" betikleri; bir kez **tatbikat** (çökme provası).
6. Geçiş: senkron duraklatılır, son kopya, sunucu aktif. Supabase / Vercel / GitHub yedekte.

K'dan gerekenler: sunucu panelinin ortam değerleri (Vercel'dekilerle aynı; gizli değerler sohbete yazılmaz, sunucuda dosyaya eklenir),
GitHub'da `ACTIVE_SITE` değişkeni, yedek kopyasının yeri (önerilen: Google Drive).
