# github-sync-part.txt

GitHub `sync.yml` zamanlı çalışmasının kapsamı (K kararı 12.11, mimari a):

- `orders`: GitHub + Supabase yalnızca sipariş, iade, hakediş, takip kodu, müşteri soruları, satış özeti ve Telegram uyarıları. Pazaryerine stok/fiyat YAZMAZ, Toptancım XML'i Supabase'e aktarılmaz. Stok/fiyat sunucuda (`trentakip-sync-vps@`, `SYNC_PART=listings`), Toptancım içe aktarma sunucuda (`suppliers.runner=vps`).
- `all`: çökme yedeği. Sunucu çalışmıyorsa bu dosyayı `all` yap (GitHub web arayüzünden düzenlenebilir); GitHub eskisi gibi her şeyi Supabase'den yürütür.

Panelden elle çalıştırma (`/api/run`) her zaman `part=all` gönderir.
