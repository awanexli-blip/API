#!/bin/bash
# Supabase -> sunucu sipariş tarafı birleştirme (tam taşıma 12.11). Ürün/ilan tablolarına dokunmaz (sunucu yetkili).
# Kullanım (root, sunucuda): bash ops/vps/db/orders-merge.sh check   # kopyala + birleştir + GERİ AL (sayılar ve farklar)
#                            bash ops/vps/db/orders-merge.sh apply   # aynısı, kalıcı
# Bağlantı: /etc/trentakip/env SUPABASE_DB_URL (Session pooler). Veri sunucu içinde akar; müşteri verisi ekrana/loga yazılmaz
# (yalnızca sayılar ve ayar farkları).
set -euo pipefail
MODE=${1:-check}
case "$MODE" in check|apply) ;; *) echo "kullanım: $0 check|apply"; exit 2 ;; esac
set -a; . /etc/trentakip/env; set +a
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL yok (/etc/trentakip/env)}"
DIR=$(cd "$(dirname "$0")" && pwd)
srv() { docker exec -i trentakip-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
sup() { docker exec -i -e U="$SUPABASE_DB_URL" trentakip-db-1 sh -c 'psql "$U" -v ON_ERROR_STOP=1 -q "$@"' -- "$@"; }
cols() { "$1" -Atc "select column_name from information_schema.columns where table_schema='public' and table_name='$2' order by 1"; }

TABLES="orders order_lines order_events order_invoices claims inbox_items notifications app_state product_overrides settings marketplace_settings user_roles"
srv -c "drop schema if exists stage cascade; create schema stage;"
for t in $TABLES; do
  # Ortak kolonlar (iki tarafın şeması farklıysa yalnızca ortaklar taşınır)
  c=$(LC_ALL=C comm -12 <(cols srv "$t" | LC_ALL=C sort) <(cols sup "$t" | LC_ALL=C sort) | paste -sd, -)
  [ -n "$c" ] || { echo "HATA: $t ortak kolon yok"; exit 1; }
  srv -c "create table stage.$t (like public.$t including defaults)"
  sup -c "\\copy (select $c from public.$t) to stdout" | srv -c "\\copy stage.$t ($c) from stdin"
  echo "kopyalandı: $t $(srv -Atc "select count(*) from stage.$t")"
done

if [ "$MODE" = apply ]; then END=commit; else END=rollback; fi
{ cat "$DIR/orders-merge.sql"; echo "$END;"; } | srv -P pager=off
echo "$MODE bitti ($END). Kopya: stage şeması (sonra: drop schema stage cascade)"
