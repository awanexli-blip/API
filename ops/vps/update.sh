#!/bin/bash
# Kod güncelleme (trentakip-update.timer, 10 dakikada bir; trentakip kullanıcısı): GitHub main'den yalnızca ileri sarma.
# worker bağımlılıkları değişince npm ci; panel kuruluysa (panel.env var) ve panel dosyaları değişince panel yeniden derlenir
# (ops/vps/panel-build.sh; yeniden başlatma ExecStartPost ile root olarak).
set -uo pipefail
cd /opt/trentakip
old=$(git rev-parse HEAD)
git pull -q --ff-only || { echo "git pull başarısız"; exit 1; }
new=$(git rev-parse HEAD)
if [ "$old" != "$new" ]; then
  git diff --quiet "$old" "$new" -- worker/package-lock.json || npm ci --prefix worker --no-audit --no-fund --silent
  if [ -r /etc/trentakip/panel.env ] && ! git diff --quiet "$old" "$new" -- app lib public package.json package-lock.json next.config.mjs tsconfig.json; then
    bash ops/vps/panel-build.sh || echo "panel derlenemedi (çalışan sürüm kaldı)"
  fi
fi
echo "kod: $(git rev-parse --short HEAD)"
