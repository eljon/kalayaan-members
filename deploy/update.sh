#!/usr/bin/env bash
# Build and (re)start Kalayaan Stewardship on the server. ORACLE.md.
#
#   sudo ./deploy/update.sh
#
# Pulls the latest code, rebuilds the image, and swaps the running copy for
# the new one. Data lives in /srv/kalayaan and is untouched.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo:  sudo ./deploy/update.sh"; exit 1; }
cd "$(dirname "$0")/.."

# git refuses to work in a folder owned by somebody else, so pull as the
# person who cloned it, not as root.
if [ -n "${SUDO_USER:-}" ]; then
  sudo -u "$SUDO_USER" git pull --ff-only || echo "  (could not pull — building the code that is here)"
else
  git pull --ff-only || echo "  (could not pull — building the code that is here)"
fi

echo "== Building (the first time takes several minutes) =="
docker build -t kalayaan .

echo "== Starting =="
docker rm -f kalayaan >/dev/null 2>&1 || true
# 127.0.0.1 only: the Cloudflare tunnel on this server is the only way in.
# Port 4173 so a tunnel already pointed at localhost:4173 (REMOTE.md) works
# unchanged.
docker run -d --name kalayaan --restart unless-stopped \
  --env-file /etc/kalayaan.env \
  -v /srv/kalayaan:/data \
  -p 127.0.0.1:4173:8080 \
  kalayaan >/dev/null

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4173/healthz >/dev/null 2>&1; then
    echo "== Running. Logs: sudo docker logs -f kalayaan =="
    exit 0
  fi
  sleep 1
done
echo "!! The app did not answer within a minute. Look at: sudo docker logs kalayaan"
exit 1
