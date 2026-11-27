# Pazarama kurulumu

Adaptör: `worker/marketplaces/pazarama.ts` (kayıt defterinde `pazarama`). Test: `worker/test/pazarama.test.ts` (sahte fetch, canlıya istek atmaz).
**Durum: canlıda hiçbir uç doğrulanmadı.** Resmi doküman (`isortagimapi.pazarama.com/docs`) herkese açık değil; uçlar ikincil kaynaklardan.

## Ortam değişkenleri (yalnızca adlar)

Sunucuda `/etc/trentakip/env` içine (GitHub/Vercel'e gerek yok, K 12.11 tam taşıma):

- `PAZARAMA_CLIENT_ID` (panel: Hesabım > Hesap Bilgileri > Entegrasyon Bilgileri, "API Key")
- `PAZARAMA_CLIENT_SECRET` ("API Secret"; yeni secret üretmek eskisini hemen geçersiz kılar)
- isteğe bağlı: `PAZARAMA_ENV` (yalnızca `prod`; bilinen test ortamı yok), `PAZARAMA_BRAND_NAME` (tedarikçinin panelde ayarlı pazaryeri markası yoksa kullanılır; kod içi varsayılan yok), `PAZARAMA_API_URL`, `PAZARAMA_AUTH_URL` (yalnızca host değişirse)

Anahtarlar koda, commit'e, sohbete yazılmaz.

## Doğrulama durumu

| Bilgi | Durum | Kaynak |
|---|---|---|
| API host `https://isortagimapi.pazarama.com`, panel `isortagim.pazarama.com` | ikincil, tutarlı | anythingmcp.com/guides/pazarama-to-mcp; erhan-flowers-erp PR 331 |
| Token: `POST https://isortagimgiris.pazarama.com/connect/token`, Basic (id:secret), `grant_type=client_credentials`, scope `merchantgatewayapi.fullaccess`, 1 saat | ikincil | aynı + PR 599 |
| Yanıt zarfı `{success,messageCode,message,data}`, HTTP 200 + `success:false` olabilir | ikincil | anythingmcp |
| `product/create` (en çok 500, 10 sn ara), `product/updateStock`, `product/updatePrice` (en çok 3000 kod, 10 sn ara), `product/getProductBatchResult` (status 1/2/3, 4 saat saklanır), `category/getCategoryTree`, `category/getCategoryWithAttributes` | uç adları ikincil | apps.odoo.com/apps/modules/18.0/pazarama_connector; PR 331 |
| Cloudflare bazı veri merkezi IP'lerini 403 ile engelleyebilir | ikincil | anythingmcp |
| İstek gövdesi anahtarları (`stockList`/`priceList`/`products`, `code`, `images[].imageurl`) | **VARSAYIM** | PR 331 farklı (tek nesne `productCode`, dizi gövde): çelişkili |
| Onaylı ürün listesi yolu (`/product/products`, `Cursor`/`nextCursor`), marka ucu (`/brand/getBrands`), stok/fiyat sonuç ucu (`/product/getListingResult`) | **VARSAYIM** (yol tahmin) | anythingmcp yalnızca "onaylı liste, 100'lük, nextCursor" der |
| Ürün durum kodları, satış kapalı alanı, sipariş/iade adaptörü | yapılmadı | |

Tüm yollar `EP` sabitinde (tek yer); canlıda farklıysa yalnızca orası değişir.

## İlk salt okunur canlı deneme (yazma yok)

1. Anahtarları sunucuda `/etc/trentakip/env`'e ekle (Pazarama panelinden). Migration `102_pazarama.sql` ile `marketplace_settings.pazarama` satırı kapalı (`enabled=false`) gelir.
2. Token kontrolü: sunucuda kısa bir betikle `pazaramaClient().getToken()` çağır (çıktıya token yazma). Beklenen: 200 + `access_token`. 400/401 ise kimlik ya da host yanlış.
3. Liste kontrolü: `createPazarama().loadListings()` ile yalnızca oku, sayıyı Pazarama panelindeki ürün sayısıyla karşılaştır. 404 ise `EP.approved` yolunu dokümandan düzelt; alan adları farklıysa `loadListings` eşlemesini düzelt.
4. `node --experimental-strip-types worker/sync.ts preview pazarama`: `enabled=false` iken yazma yapmaz; CSV'yi incele.
5. Yazma sırası (her adımda K onayı): önce 1-3 ürüne `pushInventory` (stok, sonra fiyat), `getListingResult` ile sonucu doğrula; ürün açma için önce `SEND_DRY=1`, sonra 50 ürün. `auto_create` ve `auto_sync` en son açılır.

## Açık noktalar

- Pazarama komisyon oranları kategoriye göre (satıcı panelinden); tablo yok, panel/varsayılan %18 kullanılır.
- Kargo tarifesi (desi) bilinmiyor: `shippingCost` yok, sabit kargo ayarı geçerli.
- Pazarama kategori ağacı eşlemesi (`category_map`, marketplace=pazarama) henüz yok; `categoryLeaves` yazılmadı (`category/getCategoryTree` ile eklenebilir).
- Sipariş/iade/soru: kapsam dışı (ayrı iş).
