#!/bin/bash
# Geçiş: Supabase -> sunucu SON kopya, sunucuya özel veri korunarak (docs/SUNUCU_PLAN.md §7 adım 6). K onayıyla, senkron duraklatılmışken.
#   bash /opt/trentakip/ops/vps/db/cutover.sh            -> kuru: yalnızca korunacak verinin sayıları + döküm (geri yükleme yok)
#   bash /opt/trentakip/ops/vps/db/cutover.sh --apply    -> döküm + mirror.sh + migration 074-076 + geri yükleme + sayı kontrolü
# Korunan (yalnızca sunucuda olan): yeni tedarikçiler (runner=vps) ve ürünleri / varyant / görsel / stok geçmişi / puan-yıldız /
# yapay zekâ açıklama ve özellik denemeleri, sunucuda eklenen yasaklı markalar. "deneme" şeması mirror'da silinmez (yalnızca public).
# Döküm /var/backups/trentakip/cutover-<zaman>/ altında kalır (geri dönüş için). Supabase'e YAZMAZ (mirror yalnızca okur).
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
PSQL="docker exec -i trentakip-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt"
OUT=/var/backups/trentakip/cutover-$(date +%Y%m%d-%H%M); mkdir -p "$OUT"; chmod 700 "$OUT"
SRC="(select 'xml:'||code from public.suppliers where runner = 'vps')"
# tablo|seçim sorgusu (geri yüklemede sıra önemli: yabancı anahtarlar)
TABLES=(
  "suppliers|select * from public.suppliers where runner = 'vps'"
  "products|select * from public.products where source in $SRC"
  "product_variants|select v.* from public.product_variants v join public.products p on p.id = v.product_id where p.source in $SRC"
  "product_images|select i.* from public.product_images i join public.products p on p.id = i.product_id where p.source in $SRC"
  "supplier_stock_snap|select s.* from public.supplier_stock_snap s join public.products p on p.id = s.product_id where p.source in $SRC"
  "product_opportunity|select o.* from public.product_opportunity o join public.products p on p.id = o.product_id where p.source in $SRC"
  "product_descriptions|select d.* from public.product_descriptions d join public.products p on p.id = d.product_id where p.source in $SRC"
  "ai_attr_runs|select r.* from public.ai_attr_runs r join public.products p on p.id = r.product_id where p.source in $SRC"
  "brand_blocklist|select * from public.brand_blocklist"
)
echo "== 1) Döküm: $OUT"
for t in "${TABLES[@]}"; do
  name=${t%%|*}; q=${t#*|}
  $PSQL -c "\\copy ($q) to stdout with (format csv, header true)" > "$OUT/$name.csv"
  echo "   $name: $(($(wc -l < "$OUT/$name.csv") - 1)) satır"
done
# Kolon listeleri (geri yüklemede aynı sırayla)
for t in "${TABLES[@]}"; do name=${t%%|*}; head -1 "$OUT/$name.csv" > "$OUT/$name.cols"; done
[ $APPLY = 1 ] || { echo "Kuru çalışma: geri yükleme yapılmadı. Uygulamak için --apply"; exit 0; }

echo "== 2) Supabase son kopya (mirror.sh)"
bash /opt/trentakip/ops/vps/db/mirror.sh

echo "== 3) Supabase'de olmayan şema değişiklikleri (074-076)"
for m in /opt/trentakip/supabase/migrations/07[4-6]_*.sql; do echo "   $(basename "$m")"; $PSQL < "$m"; done

echo "== 4) Sunucuya özel veriyi geri yükle"
for t in "${TABLES[@]}"; do
  name=${t%%|*}; cols=$(cat "$OUT/$name.cols")
  n=$(($(wc -l < "$OUT/$name.csv") - 1)); [ "$n" -gt 0 ] || continue
  if [ "$name" = brand_blocklist ]; then
    # Supabase'den gelen liste + sunucuda eklenenler (ör. nomination, ezere, android); var olan atlanır
    python3 -c "
import csv, sys
for r in csv.DictReader(open(sys.argv[1], encoding='utf-8')):
    w = r['word'].replace(\"'\", \"''\")
    print(f\"insert into public.brand_blocklist (word) values ('{w}') on conflict do nothing;\")" "$OUT/$name.csv" | $PSQL >/dev/null
    echo "   brand_blocklist: birleştirildi"
    continue
  fi
  $PSQL -c "\\copy public.$name ($cols) from stdin with (format csv, header true)" < "$OUT/$name.csv"
  echo "   $name: $n"
done
$PSQL -c "notify pgrst, 'reload schema';"

echo "== 5) Kontrol"
$PSQL -c "select 'tedarikçi(vps)', count(*) from public.suppliers where runner='vps' union all select 'ürün', count(*) from public.products where source in $SRC union all select 'yıldızlı', count(*) from public.product_opportunity where stars is not null"
echo "TAMAM. Sıradaki: sunucu senkron zamanlayıcıları + ACTIVE_SITE=sunucu (docs/SUNUCU_PLAN.md)"
