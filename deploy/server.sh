#!/usr/bin/env bash
# Puts Kalayaan Stewardship on a server. GitHub runs this on every push
# (.github/workflows/deploy-server.yml) — nobody signs in to the server.
# ORACLE.md walks through the one-time setup.
#
#   sudo bash server.sh STAGE_DIR
#
# STAGE_DIR holds what the workflow uploaded: app.tgz (the code at that
# commit), kalayaan.env (the email-login settings) and tunnel-token. It is
# deleted at the end — the settings are copied to /etc, readable by root only.
#
# Safe to run any number of times: what is already set up is left alone. If
# the new version doesn't come up, the previous one is put back, so a bad
# push can't take the app down.
set -euo pipefail
STAGE="${1:?usage: server.sh STAGE_DIR}"
trap 'rm -rf "$STAGE"' EXIT

APP=/srv/kalayaan-app        # the code, replaced on every deploy
DATA=/srv/kalayaan           # reports, prefs, LCR sign-in — never touched here
ENV_FILE=/etc/kalayaan.env
export DEBIAN_FRONTEND=noninteractive
# A fresh Ubuntu server runs its own updates on first boot; wait for them
# rather than fail on apt's lock.
APT="apt-get -o DPkg::Lock::Timeout=900 -y"
has() { command -v "$1" >/dev/null 2>&1; }

if ! has docker || ! has curl; then
  echo "== First deploy: installing Docker =="
  $APT update
  $APT install docker.io curl
fi
systemctl enable --now docker >/dev/null 2>&1

if ! swapon --show | grep -q '/swapfile'; then
  echo "== Adding 2 GB of swap, so a big LCR read never runs out of memory =="
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  echo "== Turning on automatic security updates =="
  $APT install unattended-upgrades >/dev/null
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
fi

install -m 600 -o root -g root "$STAGE/kalayaan.env" "$ENV_FILE"
mkdir -p "$DATA/output"

# The tunnel is reinstalled only when its token changes (or it has stopped).
if [ -s "$STAGE/tunnel-token" ]; then
  SUM="$(sha256sum "$STAGE/tunnel-token" | cut -c1-64)"
  if [ "$(cat /etc/kalayaan-tunnel.sum 2>/dev/null)" != "$SUM" ] || ! systemctl is-active --quiet cloudflared; then
    echo "== Connecting this server to your Cloudflare tunnel =="
    if ! has cloudflared; then
      curl -fsSL -o /tmp/cloudflared.deb \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture).deb"
      dpkg -i /tmp/cloudflared.deb >/dev/null
      rm -f /tmp/cloudflared.deb
    fi
    cloudflared service uninstall >/dev/null 2>&1 || true
    cloudflared service install "$(cat "$STAGE/tunnel-token")"
    echo "$SUM" > /etc/kalayaan-tunnel.sum
  fi
fi

echo "== Unpacking this version =="
rm -rf "$APP.new" && mkdir -p "$APP.new"
tar -xzf "$STAGE/app.tgz" -C "$APP.new"
rm -rf "$APP" && mv "$APP.new" "$APP"

echo "== Building (the first deploy takes several minutes) =="
docker image inspect kalayaan >/dev/null 2>&1 && docker tag kalayaan kalayaan:previous
docker build -t kalayaan "$APP"

start() {
  docker rm -f kalayaan >/dev/null 2>&1 || true
  # 127.0.0.1 only: the Cloudflare tunnel on this server is the only way in.
  # Port 4173 so a tunnel already pointed at localhost:4173 (REMOTE.md)
  # works unchanged.
  docker run -d --name kalayaan --restart unless-stopped \
    --env-file "$ENV_FILE" \
    -v "$DATA:/data" \
    -p 127.0.0.1:4173:8080 \
    "$1" >/dev/null
}
healthy() {
  for _ in $(seq 1 90); do
    curl -fsS http://127.0.0.1:4173/healthz >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "== Starting =="
start kalayaan
if healthy; then
  docker image prune -f >/dev/null 2>&1 || true
  echo "== Running =="
  exit 0
fi

echo "!! This version did not start. What it said:"
docker logs --tail 60 kalayaan 2>&1 || true
if docker image inspect kalayaan:previous >/dev/null 2>&1; then
  echo "!! Putting the previous version back."
  docker tag kalayaan:previous kalayaan
  start kalayaan
  healthy && echo "== The previous version is running again =="
fi
exit 1
