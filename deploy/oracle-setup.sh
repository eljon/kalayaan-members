#!/usr/bin/env bash
# One-time setup of Kalayaan Stewardship on a fresh Ubuntu server
# (Oracle Cloud Always Free). ORACLE.md walks through it.
#
#   sudo ./deploy/oracle-setup.sh
#
# Asks for four things, then installs Docker, builds and starts the app,
# and connects the server to your Cloudflare tunnel. Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo:  sudo ./deploy/oracle-setup.sh"; exit 1; }
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
ENV_FILE=/etc/kalayaan.env

echo
echo "== Kalayaan Stewardship: server setup =="
if [ -f "$ENV_FILE" ]; then
  echo "  Email-login settings already saved in $ENV_FILE (delete it to enter them again)."
else
  read -rp "  Cloudflare team domain (e.g. kalayaan.cloudflareaccess.com): " TEAM
  read -rp "  Access application AUD tag: " AUD
  read -rp "  Owner email(s), comma-separated: " OWNERS
  ( umask 077; printf 'ACCESS_TEAM_DOMAIN=%s\nACCESS_AUD=%s\nOWNER_EMAILS=%s\n' "$TEAM" "$AUD" "$OWNERS" > "$ENV_FILE" )
fi
echo "  Cloudflare tunnel token — paste it and press Enter (nothing shows as you paste)."
echo "  Just press Enter if this server is already connected to the tunnel."
read -rsp "  Token: " TUNNEL_TOKEN; echo

echo "== Installing Docker, git and curl =="
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io git curl
systemctl enable --now docker

echo "== Adding 2 GB of swap, so a big LCR read never runs out of memory =="
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Turning on automatic security updates =="
DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

mkdir -p /srv/kalayaan/output
"$APP_DIR/deploy/update.sh"

if [ -n "$TUNNEL_TOKEN" ]; then
  echo "== Connecting this server to your Cloudflare tunnel =="
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  dpkg -i /tmp/cloudflared.deb >/dev/null
  cloudflared service uninstall >/dev/null 2>&1 || true
  cloudflared service install "$TUNNEL_TOKEN"
fi

echo
echo "== Done =="
echo "  The app runs here and restarts by itself after a reboot."
echo "  Next: ORACLE.md step 6 (point the tunnel at this server)."
