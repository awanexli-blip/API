# Çoklu pazaryeri yol haritası

Hedef: aynı XML ve aynı fiyat motoru ile birden fazla pazaryerine (Trendyol, Hepsiburada, N11, Amazon TR) satış. Trendyol canlı ve 17 bin ürünle çalıştığı için **davranışı değişmeden** taşınır, yeni pazaryerleri sonra eklenir.

## Mimari

```
worker/
  sync.ts                  orkestratör (pazaryerinden bağımsız): XML -> eşleştir -> fiyat -> gönder
  pricing.ts               fiyat formülü (ortak)
  core/{util,xml}.ts       ortak yardımcılar, XML okuma
  marketplaces/
    types.ts               Marketplace arayüzü (adaptör sözleşmesi)
    index.ts               kayıt defteri: getMarketplace("trendyol")
    trendyol.ts            Trendyol adaptörü (API, barkod kuralı, komisyon kaynağı, ürün açma)
    <yeni>.ts              Hepsiburada / N11 / Amazon TR aynı arayüzü uygular
```

Adaptör sözleşmesi: `loadListings`, `findListing` (XML ürünü -> pazaryerindeki ilan), `newListingId`, `commission`, `pushInventory`, `zeroStock`, `createProducts`, isteğe bağlı `diagnostics`.
Pazaryerine özgü her şey (kimlik doğrulama, hız sınırı, barkod kuralı, marka, kategori ağacı) adaptörde kalır. Orkestratör hiçbir pazaryeri adı bilmez.

## Aşamalar

| # | Aşama | Durum |
|---|---|---|
| 0 | Repo senkronu (yerel = GitHub) | Bitti |
| 1 | Adaptör mimarisi, Trendyol davranışı birebir aynı (mock regresyon testi ile doğrulanır) | Bitti |
| 2 | Pazaryeri bazlı ayarlar: `marketplace_settings` tablosu (açık/kapalı, auto_sync, auto_create, komisyon, kargo kuralı, fiyat politikası). `category_map` ve `product_overrides` için `marketplace` kolonu. Panelde pazaryeri seçici | Sırada |
| 3 | Trendyol: ilk gerçek `update` (önce preview, >%20 artanlar kontrol), `failedBatches` 0 doğrulaması, sonra `auto_sync` | Kullanıcı onayı ile |
| 4 | Trendyol: yeni ürünler (marka `Eco Lounge`, `categoryId` önerisi, 50 ürünlük deneme) | Sırada |
| 5 | İkinci pazaryeri adaptörü (öneri: Hepsiburada veya N11, API belgesine göre karar) | Sonra |
| 6 | Workflow matrisi: her pazaryeri ayrı job ve ayrı secret seti, panelde pazaryeri başına düğmeler ve geçmiş | Sonra |

## Kurallar

- Fiyat formülü ve iş kuralları (`CLAUDE.md` bölüm 3) pazaryeri bazında ayarla değişebilir, varsayılan Trendyol değerleridir. Başka pazaryerinin komisyonu ve kargo eşiği farklıdır.
- Yeni pazaryeri her zaman `preview` ile başlar, `auto_sync` ve `auto_create` varsayılan kapalıdır.
- Şema değişiklikleri geriye uyumlu olur (`add column if not exists`), çalışan sistem migration beklemeden kırılmaz.
- Secret'lar yalnızca GitHub Secrets ve Vercel Environment Variables içindedir.
