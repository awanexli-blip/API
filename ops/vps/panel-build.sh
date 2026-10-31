#!/bin/bash
# Paneli sunucuda derle (docs/SUNUCU_PLAN.md adım 3). trentakip kullanıcısıyla; ortam /etc/trentakip/panel.env (NEXT_PUBLIC_* derlemeye girer).
# Yeni sürüm .next-build'e derlenir, başarılıysa .next-live ile yer değiştirir; başarısızsa çalışan panel olduğu gibi kalır.
set -euo pipefail
cd /opt/trentakip
set -a; . /etc/trentakip/panel.env; set +a
[ -d node_modules/next ] && git diff --quiet HEAD@{1} HEAD -- package-lock.json 2>/dev/null || npm ci --no-audit --no-fund --silent
rm -rf .next-build
NODE_OPTIONS=--max-old-space-size=1800 NEXT_DIST_DIR=.next-build npx next build > /tmp/panel-build.log 2>&1 || { tail -20 /tmp/panel-build.log; exit 1; }
rm -rf .next-old; [ -d .next-live ] && mv .next-live .next-old; mv .next-build .next-live
echo "panel derlendi: $(git rev-parse --short HEAD)"
touch /opt/trentakip/.panel-restart
