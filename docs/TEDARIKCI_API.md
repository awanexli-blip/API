# Tedarikçi REST API ekleme

Ürünleri XML yerine REST API ile veren tedarikçiler aynı hattan geçer: sayfalar okunur, alan eşlemesi ve gruplama XML'deki gibidir (`lib/supplier-api.ts`). Ürün veritabanına `xml:<kod>` kaynağıyla yazılır; fiyat, stok ve pazaryeri gönderimi değişmez.

## Tedarikçiden istenecekler

1. **API dokümanı:** ürün listesi uç noktası, örnek yanıt, alan listesi (kod, ad, açıklama, fiyat ve KDV dahil mi, stok, barkod, görseller, kategori, desi, varyant yapısı).
2. **Kimlik doğrulama:** anahtar (Bearer / başlık / adres parametresi), kullanıcı adı ve parola (Basic) ya da OAuth2 client_credentials.
3. **Sayfalama:** sayfa numarası, offset, imleç (cursor) ya da "sonraki sayfa adresi"; en büyük sayfa boyutu.
4. **Hız sınırı** (dakikada / günde kaç istek) ve stokun ne sıklıkla güncellendiği.
5. **IP izni** gerekiyor mu? Gerekiyorsa sunucunun IP'si verilir ve linkte `"runner": "vps"` seçilir (`docs/VPS_KURULUM.md`).
6. **Sipariş API'si** var mı (sipariş oluşturma, durum, kargo takip no, iptal)? Bunlar ayrıca bağlanır (Faz 6 F4: önce kuru deneme, onaylı gönderim).
7. **Test ortamı** var mı?

## Panelden ekleme

Tedarikçiler → **+ Tedarikçi ekle** (ya da düzenle):

1. Ad / kısa kod. Ana XML adresini boş bırak.
2. **Ek linkler → + Ek link → REST API.** Adres: ürün listesi uç noktası.
3. **API ayarı (JSON).** Anahtarı buraya yazma; "Anahtar" alanına yaz ya da `auth.secret_env` ile ortam değişkeni adını ver.
4. **Test et (ilk 3 sayfa):** alanlar ve önerilen eşleme gelir.
5. 2. adımda eşlemeyi kontrol et (zorunlu: Model kodu, Ürün adı), kaydet, **İçe aktar**.

Anahtar iki yoldan biriyle saklanır:
- **Panelde "Anahtar" alanı:** veritabanında durur, panele geri gönderilmez. En kolayı budur.
- **Ortam değişkeni:** `auth.secret_env: "TEDARIKCI_X_TOKEN"`. Değer GitHub Secret `SUPPLIER_SECRETS` içinde (`TEDARIKCI_X_TOKEN=...` satırı, her tedarikçi bir satır) ve VPS'te `/etc/trentakip/env` içinde durur. Bu yolla panelden test edilemez.

## Ayar örnekleri

Sayfa numaralı, Bearer:
```json
{ "auth": { "type": "bearer" }, "items_path": "data",
  "paging": { "type": "page", "param": "page", "size_param": "limit", "size": 100, "start": 1 } }
```
Offset, başlıkta anahtar, toplam sayı:
```json
{ "auth": { "type": "header", "name": "X-Api-Key" }, "items_path": "result.items",
  "paging": { "type": "offset", "param": "skip", "size_param": "take", "size": 200, "total_path": "result.total" } }
```
İmleç:
```json
{ "auth": { "type": "query", "name": "apikey" }, "items_path": "products",
  "paging": { "type": "cursor", "cursor_param": "cursor", "cursor_path": "meta.next_cursor" } }
```
Sonraki sayfa adresi, Basic:
```json
{ "auth": { "type": "basic", "user": "bayi123" }, "items_path": "results",
  "paging": { "type": "next_url", "next_path": "links.next" } }
```
OAuth2, POST ile liste, yalnızca sunucudan (IP izni):
```json
{ "method": "POST", "body": { "onlyActive": true },
  "auth": { "type": "oauth2", "token_url": "https://api.x.com/oauth/token", "client_id": "abc", "client_secret_env": "X_SECRET" },
  "items_path": "data", "paging": { "type": "page", "size_param": "pageSize", "size": 500 }, "runner": "vps" }
```

Diğer alanlar:

| Alan | Anlamı |
|---|---|
| `headers` | Ek başlıklar. Anahtar buraya yazılamaz, kaydetme reddedilir. |
| `query` | Sabit adres parametreleri. |
| `format` | `auto` / `json` / `xml`. XML dönen API'ler de okunur. |
| `delay_ms` | Sayfalar arası bekleme (varsayılan 300 ms). |
| `max_pages` | En fazla kaç sayfa okunur (varsayılan 2000). |

## Güvenlikler

- Tüm sayfalar okunamazsa (yetki, hız sınırı, sayfa sınırı) içe aktarma durur. Stoklar sıfırlanmaz, Telegram'a uyarı gider.
- 429 ve 5xx yanıtlarında 3 kez beklenip yeniden denenir.
- API sayfa parametresini yok sayıp hep aynı sayfayı döndürürse döngü durur.
- İç ağ adresleri ve yönlendirmeler engellenir (SSRF koruması).
- `runner: "vps"` olan tedarikçiyi GitHub atlar; yalnızca sunucu okur, aynı veri iki kez okunmaz.
