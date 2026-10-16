# Gelişme günlüğü

En yeni üstte. Her oturum sonunda: ne yapıldı, ne doğrulandı, ne açık kaldı, sıradaki adım.

## 2026-10-16 (3) — İlk canlı V2 çalışması

**Olan:** Kullanıcı Actions'ı elle `auto` ile tetikledi (preview yerine). Elle tetiklemede `auto_sync` kontrolü yok → **gerçek update** yapıldı.
- XML 25.334 · Trendyol 20.644 (onaylı içerik 17.892 / varyant 18.027, onaysız 2.617) · eşleşen 20.104.
- Gönderilen 17.026, `failedBatches` 0, `batchCheck` 35/35 kontrol, ürün hatası 0. Politika `floor` (fiyat düşmedi).
- Komisyon: canlı 17.627 · panel 2.808 · varsayılan 4.661.
- Atlanan: onay bekleyen/reddedilen 2.551 · kapalı 527 · kategori eşleşmemiş 4.764 · aynı başlık 133 · üst sınır 81 · tekrar kod 14 · barkodsuz 238.
- V2 doğrulandı: approved/unapproved listeleme, nextPageToken, `commission`, `category.id`/`brand.id`, batch sonucu, storeFrontCode göndermeden TR.
- >%20 artan 5 ürün önceden kontrol edilemedi.

**Düzeltme:** workflow elle tetiklemede varsayılan mod `preview`, mod açılır liste.

**Sıradaki:** (K) Trendyol panelinden birkaç ürünü kontrol et, artifact `preview.csv`'yi ver (fiyat artışı analizi) → `auto_sync` aç → P1 yeni ürünler.

## 2026-10-16 (2) — Trendyol V2 geçişi

**Yapıldı**
- `trendyol.ts` V2: listeleme `products/approved` (100/sayfa, 10.000 sonrası `nextPageToken`) + `products/unapproved`; açma `/v2/products`; marka `by-name` dizi yanıtı; `batch-requests` ile ürün bazlı hata (`summary.batchCheck`).
- İlan durumu: `closed` (kilitli/arşiv/kara liste veya fiyat 0) ve `pending` (onay bekliyor/reddedildi) güncellenmez; `pending` yeniden açılmaz.
- Canlı komisyon (`variants[].commission`) öncelikli.
- V2'de olmayan `cargoCompanyId` kaldırıldı, resim en fazla 8.
- Kalıcı test: `worker/test/{mock,run}.mjs` (24 kontrol). Workflow'da sync öncesi koşar.
- `yedek/` zip'leri ve boş `API` alt modül kaydı silindi (kullanıcı onayı).

**Doğrulanmadı (canlı):** V2 uç yolları, `commission` birimi (yüzde/oran), `stock.quantity` alanı (referansta yok), batch sonuç biçimi. İlk `preview` özetindeki `listingTotals` ve `batchCheck`'e bak.

**Sıradaki:** (K) Actions'tan `preview` çalıştır → sonuçlara göre düzelt → P1.

## 2026-10-16

**Yapıldı**
- Repo senkronu: yerel klasör git'e bağlandı (`origin` = `awanexli-blip/API`). GitHub'da eksik olan komisyon mantığı, `commissions_*.json`, `CLAUDE.md` gönderildi. `yedek/` zip'leri korundu. (commit `3b1a4dc`)
- Çoklu pazaryeri mimarisi: `worker/marketplaces/{types,index,trendyol}.ts`, `worker/core/{util,xml}.ts`. `sync.ts` pazaryerinden bağımsız. Workflow ve `/api/run` `marketplace` girdisi alıyor (varsayılan `trendyol`). (commit `2f24b07`)
- Yeni ürün markası `Eco Lounge` (`TRENDYOL_BRAND_NAME`). (commit `4bddd82`)
- Pazaryeri zorunlu alan araştırması ve plan: `docs/TODO.md`.

**Doğrulandı**
- Eski ve yeni `sync.ts` sahte XML/Supabase/Trendyol ile 5 senaryoda (auto/update/preview/create/zero_missing, floor/formula/keep) birebir aynı CSV, özet ve Trendyol istekleri üretti. `tsc` temiz.
- Test düzeneği oturumun scratchpad'inde kaldı (kalıcı değil). Gerekirse `worker/test/` altına kalıcı mock test eklenmeli.

**Bulgu (kritik)**
- Trendyol V1 ürün servisleri 15.10.2026'da kapandı. Worker'ın ürün listeleme ve ürün açma uçları V1. Sıradaki `preview`/cron hata verebilir → TODO P0.
- V2 listeleme yanıtı ürün bazlı `commission` ve `category.id` döndürüyor: komisyon JSON'una ve kategori tahminine gerek kalmayabilir.

**Açık / kullanıcıdan**
- `storeFrontCode` TR değeri belgede yok, canlıda denenmeli.
- Hepsiburada / N11 / Amazon hesap ve API anahtarları, resmi doküman erişimi.
- Vercel: panel pazaryeri API'lerine erişeceği zaman kimlik bilgileri Vercel env'e girilecek.

**Sıradaki adım:** P0 Trendyol V2 geçişi.

## Notlar
- Yerel ortam: `npm install --prefix worker` yapıldı. Kök `package-lock.json` ve `worker/package-lock.json` gitignore'da (Vercel bağımlılık çözümü değişmesin).
- Commit/push: Claude doğrudan `main`'e gönderiyor (kullanıcı izni var). `main`'e giden worker kodu bir sonraki cron'da canlı çalışır.
