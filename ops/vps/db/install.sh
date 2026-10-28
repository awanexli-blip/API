#!/bin/bash
# Sunucuda veritabanı katmanını kurar (root, tekrar çalıştırılabilir): Docker, parolalar/anahtarlar, servisler, HTTPS.
#   bash /opt/trentakip/ops/vps/db/install.sh <panel adresi, ör. https://xxx.vercel.app>
# Mevcut sisteme dokunmaz: Supabase ana kalır; veri mirror.sh ile kopyalanır. Ayrıntı: docs/VPS_TASIMA.md
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "root olarak çalıştır"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
DOMAIN=${DOMAIN:-trentakip.duckdns.org}
PANEL_URL=${1:-${PANEL_URL:-}}
[[ "$PANEL_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "panel adresi gerekli (https://..., sonda / yok)"; exit 2; }
export DEBIAN_FRONTEND=noninteractive

echo "== 1/5 Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q && apt-get -y -q install docker.io docker-compose-v2
fi
install -d -m 755 /etc/docker
[ -f /etc/docker/daemon.json ] || echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
systemctl enable --now docker >/dev/null
systemctl restart docker

echo "== 2/5 klasörler"
install -d -m 700 /var/lib/trentakip/pg
install -d -m 755 -o 1000 -g 1000 /var/lib/trentakip/storage /var/lib/trentakip/storage/product-images
install -d -m 700 /var/lib/trentakip/caddy /var/lib/trentakip/backup

echo "== 3/5 parolalar ve anahtarlar (/etc/trentakip/db.env, keys.env: yalnızca root)"
umask 077
if [ ! -s /etc/trentakip/db.env ]; then
  cat > /etc/trentakip/db.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTHENTICATOR_PASSWORD=$(openssl rand -hex 24)
AUTH_ADMIN_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
DOMAIN=$DOMAIN
PANEL_URL=$PANEL_URL
PG_SHARED_BUFFERS=256MB
PG_CACHE=1GB
EOF
  echo "   oluşturuldu"
else
  sed -i "s|^PANEL_URL=.*|PANEL_URL=$PANEL_URL|; s|^DOMAIN=.*|DOMAIN=$DOMAIN|" /etc/trentakip/db.env
  echo "   var olan korundu (parolalar değişmedi)"
fi
set -a; . /etc/trentakip/db.env; set +a
if [ ! -s /etc/trentakip/keys.env ]; then
  { echo "VPS_SUPABASE_URL=https://$DOMAIN"
    echo "VPS_ANON_KEY=$(JWT_SECRET=$JWT_SECRET node "$HERE/jwt.mjs" anon)"
    echo "VPS_SERVICE_ROLE_KEY=$(JWT_SECRET=$JWT_SECRET node "$HERE/jwt.mjs" service_role)"; } > /etc/trentakip/keys.env
fi
umask 022

echo "== 4/5 güvenlik duvarı: 80/443 (HTTPS); veritabanı portları yalnızca sunucu içinde (127.0.0.1)"
ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null

echo "== 5/5 servisler"
cd "$HERE"
docker compose --env-file /etc/trentakip/db.env pull -q
docker compose --env-file /etc/trentakip/db.env up -d
for i in $(seq 1 60); do
  curl -sf -m 5 http://127.0.0.1:9999/health >/dev/null && curl -s -m 5 -o /dev/null http://127.0.0.1:3000/ && break
  sleep 5
done
docker compose --env-file /etc/trentakip/db.env ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
echo "Kuruldu. Sıradaki: mirror.sh (Supabase'den veri kopyası). HTTPS denemesi: curl -s https://$DOMAIN/auth/v1/health"
