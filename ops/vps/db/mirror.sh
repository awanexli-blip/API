#!/bin/bash
# Supabase -> sunucu veritabanı: tam kopya (deneme süresi boyunca tekrarlanır; Supabase'e yazmaz, yalnızca okur).
#   bash /opt/trentakip/ops/vps/db/mirror.sh
# Kaynak: /etc/trentakip/env içinde SUPABASE_DB_URL (Supabase > Connect > Session pooler, parolalı) ve SUPABASE_URL.
# Hedefteki public şeması her seferinde baştan kurulur: sunucuya yazılan deneme verisi kalıcı değildir (asıl geçişte son kopya alınır).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "root olarak çalıştır"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
set -a; . /etc/trentakip/env; . /etc/trentakip/db.env; set +a
SRC=${SUPABASE_DB_URL:?SUPABASE_DB_URL yok (/etc/trentakip/env)}
export PGPASSWORD=$POSTGRES_PASSWORD
DST="host=127.0.0.1 port=5432 user=postgres dbname=postgres"
W=/var/lib/trentakip/backup; t0=$(date +%s)
psql_dst() { psql "$DST" -v ON_ERROR_STOP=1 -qAt "$@"; }

echo "== 1/6 kaynaktan döküm (public şema + giriş kullanıcıları)"
pg_dump "$SRC" --schema=public --no-owner --no-privileges --no-publications --no-subscriptions -Fc -f $W/mirror-public.dump
pg_dump "$SRC" --data-only -t auth.users -t auth.identities --no-owner --no-privileges -Fc -f $W/mirror-auth.dump
ls -la $W/mirror-*.dump | awk '{print "   "$5" bayt "$9}'

echo "== 2/6 hedef public şeması baştan"
psql_dst -c "drop schema if exists public cascade; create schema public;"
pg_restore -l $W/mirror-public.dump | grep -vE ' SCHEMA - public | COMMENT - SCHEMA public ' > $W/mirror-public.list
pg_restore -d "$DST" --no-owner --no-acl --exit-on-error -L $W/mirror-public.list $W/mirror-public.dump

echo "== 3/6 yetkiler (Supabase ile aynı: yalnızca service_role)"
psql_dst <<'SQL'
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
SQL

echo "== 4/6 giriş kullanıcıları (parola özetleri aynı: aynı parolayla girilir)"
if psql_dst -c "select 1 from pg_tables where schemaname='auth' and tablename='users'" | grep -q 1; then
  psql_dst -c "truncate auth.identities, auth.users cascade;"
  pg_restore -d "$DST" --data-only --no-owner --exit-on-error $W/mirror-auth.dump
  echo "   kullanıcı: $(psql_dst -c 'select count(*) from auth.users')"
else
  echo "   UYARI: auth şeması hazır değil (giriş servisi açılmadı mı?): kullanıcılar kopyalanmadı"
fi

echo "== 5/6 görseller (yalnızca eksikler) ve adresler"
SRC_PUB="${SUPABASE_URL%/}/storage/v1/object/public"
DST_PUB="https://$DOMAIN/storage/v1/object/public"
n=0
while IFS= read -r name; do
  [[ "$name" =~ ^[A-Za-z0-9._/-]+$ && "$name" != *..* ]] || { echo "   atlandı (ad): $name"; continue; }
  f=/var/lib/trentakip/storage/product-images/$name
  [ -s "$f" ] && continue
  install -d -o 1000 -g 1000 "$(dirname "$f")"
  curl -sf -m 60 -o "$f.tmp" "$SRC_PUB/product-images/$name" && mv "$f.tmp" "$f" && chown 1000:1000 "$f" && n=$((n+1)) || { rm -f "$f.tmp"; echo "   indirilemedi: $name"; }
done < <(psql "$SRC" -qAt -c "select name from storage.objects where bucket_id='product-images' order by name")
echo "   yeni indirilen: $n"
psql_dst -c "update product_images set url = replace(url, '$SRC_PUB/', '$DST_PUB/') where url like '$SRC_PUB/%';" >/dev/null
psql_dst -c "notify pgrst, 'reload schema';"

echo "== 6/6 doğrulama: tablo satır sayıları kaynak = hedef"
psql "$SRC" -qAt -f /opt/trentakip/ops/db-counts.sql > $W/counts-src.txt
psql_dst -f /opt/trentakip/ops/db-counts.sql > $W/counts-dst.txt
if diff -q $W/counts-src.txt $W/counts-dst.txt >/dev/null; then
  echo "   TAMAM: $(wc -l < $W/counts-dst.txt) tablo, satır sayıları aynı"
else
  # Kopya sırasında senkron çalıştıysa birkaç tabloda küçük fark olabilir (sync_runs, audit_log vb.)
  echo "   FARK (kaynak | hedef):"; { diff $W/counts-src.txt $W/counts-dst.txt || true; } | grep '^[<>]' | head -20 || true
fi
echo "süre: $(( $(date +%s) - t0 )) sn · boyut: $(psql_dst -c "select pg_size_pretty(pg_database_size('postgres'))")"
