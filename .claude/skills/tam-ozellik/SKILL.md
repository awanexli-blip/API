---
name: tam-ozellik
description: Trentakip panelinde/sisteminde yeni bir bölüm, ekran ya da özellik yapılacağında (ör. "fatura bölümü yap", "iadeler sayfası", "tedarikçi siparişi ekle", "şu ekrana X ekle") kullan. Konuyu önce araştırır, gerçek hayatta gereken tüm parçaları (listeleme, arama, filtre, ekleme, düzenleme, silme, toplu işlem, uyarı kapatma, durumlar, yetki, kayıt, mobil, test) tek seferde eksiksiz kurar; parça parça teslim etmez. K 15.11 kuralı.
---

# Tam özellik teslimi

K'nın kuralı (15.11): "Bir bölüm yap dediğimde bana tam kurulu, düzgün bitmiş bir bölüm aç. Başta bir kısmını, sonra mükerreri, sonra kurumsalı diye tek tek uğraşmayalım. Bu her şey için geçerli."

Örnek ders: Faturalar bölümü üç seferde tamamlandı (önce taslak/imza/yükleme, sonra mükerrer kontrolü, sonra kurumsal fatura) ve mükerrer uyarısını kapatacak düğme hiç yapılmadı. Bu beceri bunun tekrarını önler.

## 1. Araştır (kod yazmadan önce)

- **Konunun kuralları:** mevzuat (GİB, KDV, e-Arşiv/e-Fatura), pazaryeri rehberi (Trendyol/Hepsiburada belgeleri, `kaynaklar/`), tedarikçi rehberi. Gerekirse web araştırması.
- **İstisnalar ve uç durumlar:** bireysel/kurumsal, e-Fatura mükellefi, iade, iptal, kısmi iade, mükerrer, süresi geçmiş, silinmiş müşteri verisi (30 gün), çok satırlı sipariş, para/KDV oranı farkı, pazaryeri hata kodları.
- **Mevcut kod:** ilgili API, bileşen, migration, worker; benzer bölümlerin deseni (`app/_components/`, `app/api/`, `worker/`). Yeniden yazma yerine genişlet.
- **Gerçek veri:** sunucu DB'de bu konuda gerçekte hangi durumlar var (sayılarla). Ör. "kaç kurumsal sipariş, kaçı e-Fatura mükellefi".
- Next.js kodundan önce `node_modules/next/dist/docs/` (CLAUDE.md kuralı); web arayüzü için `modern-web-guidance`.

## 2. Kapsam listesi yaz (K'ya kısaca göster, sonra uygula)

Her kalem için "var / yapılacak / bilerek yok (neden)" işaretle:

| Alan | Kontrol |
|---|---|
| Listeleme | sekme/durum grupları, sayfalama, sayaçlar |
| Arama, filtre, sıralama | en çok aranan alanlar (sipariş no, ürün, barkod, belge no, müşteri değil) |
| Ekleme | form, doğrulama (zod), varsayılanlar |
| Düzenleme | tek kayıt + gerekiyorsa toplu |
| Silme / arşiv | onay penceresi (`confirmDialog`), geri alma ya da arşiv tercih edilir |
| Toplu işlem | seç/tümünü seç, ilerleme, kısmi hata raporu |
| Uyarılar | her uyarının nedeni yazılı + **"Düzelttim / kaldır" yolu** + otomatik kalkma koşulu |
| Durumlar | yükleniyor, boş, hata (yeniden dene), başarı bildirimi, zaman aşımı |
| Canlıya yazan adım | önce deneme (dry-run), sonra onay, `idempotency_key`, audit_log |
| Yetki | `guard()` / `requireRole`, düğme gizleme rol ile |
| Kayıt | audit_log (önce/sonra), müşteri verisi loglanmaz |
| Mobil | 390 px, 44 px dokunma, tablo kart görünümü |
| Dışa aktarma | CSV/PDF gerekiyorsa |
| Bildirim | Telegram gerekiyorsa (yalnızca önemli olay) |
| Performans | 1000 satır sınırı (`readAll`), sorgu süresi < 2 sn, ağır iş arka planda |

## 3. Uygula

- Migration (sunucu DB'ye uygula; `if not exists`), API, ekran, worker birlikte.
- Her düğme: hangi API, başarıda ne olur, hatada ne görünür (CALISMA_KURALLARI §3).
- Testler: birim (`npm test`, `node worker/test/run.mjs`), `npx tsc --noEmit`.

## 4. Doğrula

- Sunucuda panel derlemesi (`ops/vps/panel-build.sh`) ve test hesabıyla gerçek tıklama turu (`/root/pw/pw-perf.mjs` deseni; yazma isteği yalnızca denenen düğmede).
- Sayfa yüklenme süresi ölç (hedef < 2 sn).

## 5. Teslim raporu (K'ya)

1. Neler kuruldu (kısa liste)
2. Bilerek dışarıda bırakılanlar ve nedeni
3. K kararı gereken noktalar
Sonra `docs/PROGRESS.md` en üste girdi, `docs/TODO.md` işaretle.
