# github-sync-part.txt

GitHub `sync.yml` çalışmasının kapsamı (`part` girdisi `auto` iken bu dosya okunur):

- `off` (**tam taşıma, 12.11**): her şey sunucuda. GitHub senkronu hiçbir şey yazmaz (yalnızca test adımı). Sunucu: ilanlar `trentakip-sync-vps@` (`SYNC_PART=listings`), siparişler `trentakip-orders` (`SYNC_PART=orders`), panel `https://trentakip.duckdns.org` (`RUN_SITE=sunucu`, düğmeler sunucu iş kuyruğunu tetikler: `ops/vps/runq.sh`). Supabase acil yedek; GitHub ona yazarsa eski siparişleri yeniden bildirirdi.
- `orders` (12.11 sabah-akşam, mimari a): GitHub + Supabase yalnızca sipariş/iade/soru; stok/fiyat sunucuda.
- `all`: çökme yedeği. Sunucu çalışmıyorsa bu dosyayı `all` yap (GitHub web arayüzünden düzenlenebilir); GitHub eskisi gibi her şeyi Supabase'den yürütür. Ayrıntı `docs/SUNUCU_PLAN.md` §4.

Elle çalıştırmada `part` seçilebilir (`all` / `orders` / `off`); Vercel paneli (yedek) `part=all` gönderir.
