#!/usr/bin/env bash
# Trentakip VPS kurulumu (Ubuntu 24.04+, root olarak bir kez): güvenlik, Node 24, depo, zamanlayıcılar.
# Tekrar çalıştırmak güvenli (var olanı bozmaz). Kullanım (Claude, K'nın bilgisayarından):
#   scp ops/vps/setup.sh root@<IP>:/root/ && ssh root@<IP> 'bash /root/setup.sh'
# Sonra /etc/trentakip/env doldurulur (docs/VPS_KURULUM.md) ve: systemctl start trentakip-dispatch.timer trentakip-supplier-vps.timer
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "root olarak çalıştır"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
APP=/opt/trentakip USER_NAME=trentakip REPO_URL=https://github.com/awanexli-blip/API.git

echo "== 1/8 paketler"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl git ufw fail2ban unattended-upgrades jq gnupg
timedatectl set-timezone Europe/Istanbul || true

echo "== 2/8 otomatik güvenlik güncellemeleri"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== 3/8 SSH: yalnızca anahtar (kilitlenmemek için önce anahtar kontrolü)"
if [ -s /root/.ssh/authorized_keys ] && grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-)' /root/.ssh/authorized_keys; then
  install -d -m 755 /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/10-trentakip.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 4
EOF
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
  echo "   şifreli giriş kapatıldı"
else
  echo "   UYARI: /root/.ssh/authorized_keys boş: şifreli giriş AÇIK bırakıldı (önce açık anahtarı ekle, betiği yeniden çalıştır)"
fi

echo "== 4/8 güvenlik duvarı (yalnızca SSH) + fail2ban"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

echo "== 5/8 2 GB swap (1 CPU / 2 GB RAM: XML ayrıştırmada bellek taşmasın)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/90-trentakip.conf
fi

echo "== 6/8 Node 24 + PostgreSQL 17 istemcisi (yedek / taşıma için)"
if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get -y -q install nodejs
fi
if ! command -v pg_dump >/dev/null || ! pg_dump --version | grep -q ' 17'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q && apt-get -y -q install postgresql-client-17
fi
node -v; pg_dump --version

echo "== 7/8 uygulama kullanıcısı, depo, ortam dosyası"
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$USER_NAME --shell /usr/sbin/nologin "$USER_NAME"
if [ ! -d "$APP/.git" ]; then git clone -q "$REPO_URL" "$APP"; fi
chown -R "$USER_NAME:$USER_NAME" "$APP"
sudo -u "$USER_NAME" git -C "$APP" pull -q --ff-only
sudo -u "$USER_NAME" npm ci --prefix "$APP/worker" --no-audit --no-fund --silent
install -d -m 750 -o root -g "$USER_NAME" /etc/trentakip
if [ ! -f /etc/trentakip/env ]; then
  install -m 640 -o root -g "$USER_NAME" "$APP/ops/vps/trentakip.env.example" /etc/trentakip/env
  echo "   /etc/trentakip/env oluşturuldu: değerleri doldur"
fi
install -d -m 750 -o "$USER_NAME" -g "$USER_NAME" /var/log/trentakip

echo "== 8/8 zamanlayıcılar (systemd)"
install -m 644 "$APP"/ops/vps/systemd/*.service "$APP"/ops/vps/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable trentakip-update.timer >/dev/null && systemctl start trentakip-update.timer
# Senkron tetikleyici ve tedarikçi içe aktarma: env doldurulunca elle açılır (boş anahtarla hata üretmesin)
systemctl enable trentakip-dispatch.timer trentakip-supplier-vps.timer >/dev/null
echo
echo "Kurulum bitti. Sıradaki: /etc/trentakip/env doldur, sonra:"
echo "  systemctl start trentakip-dispatch.timer trentakip-supplier-vps.timer"
echo "  systemctl list-timers 'trentakip-*'   ·   journalctl -u trentakip-dispatch -n 20"
