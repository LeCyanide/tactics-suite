#!/usr/bin/env bash
# One-time setup of the update server on a fresh Debian/Ubuntu VPS.
#
#   scp deploy/Caddyfile deploy/setup-vps.sh you@vps:
#   ssh you@vps 'sudo bash setup-vps.sh updates.example.com [uploader]'
#
# Releases are uploaded as <uploader>: the sudo user by default, or, when run
# as root, a dedicated wows-release account created here with root's SSH keys
# so the build machine never needs root to publish.
#
# Point the domain's DNS A/AAAA record at the VPS first; Caddy fetches the
# HTTPS certificate on start. Safe to re-run: it keeps an existing token.
set -euo pipefail

DOMAIN="${1:?usage: sudo bash setup-vps.sh <domain> [uploader]}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UPLOADER="${2:-${SUDO_USER:-wows-release}}"
ROOT=/srv/wows-updates
ENV_FILE=/etc/caddy/wows-updates.env

if ! command -v caddy >/dev/null; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! id "$UPLOADER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$UPLOADER"
  install -d -m 700 -o "$UPLOADER" -g "$UPLOADER" "/home/$UPLOADER/.ssh"
  install -m 600 -o "$UPLOADER" -g "$UPLOADER" /root/.ssh/authorized_keys "/home/$UPLOADER/.ssh/authorized_keys"
fi

# Release folder: the uploader writes, Caddy reads.
install -d -m 2775 -o "$UPLOADER" -g caddy "$ROOT"

# Token: generated once, kept across re-runs so shipped builds keep working.
if [[ -f "$ENV_FILE" ]] && grep -q '^UPDATE_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(grep '^UPDATE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
else
  TOKEN="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
fi
install -m 640 -o root -g caddy /dev/null "$ENV_FILE"
printf 'UPDATE_DOMAIN=%s\nUPDATE_TOKEN=%s\n' "$DOMAIN" "$TOKEN" > "$ENV_FILE"

mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=%s\n' "$ENV_FILE" > /etc/systemd/system/caddy.service.d/wows-updates.conf

if [[ -f /etc/caddy/Caddyfile ]] && ! cmp -s "$HERE/Caddyfile" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%s)"
fi
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

cat <<DONE

Update server is up. Put these in .env.release on your build machine:

UPDATE_URL=https://$DOMAIN
UPDATE_TOKEN=$TOKEN
VPS_SSH=$UPLOADER@$(hostname -I | awk '{print $1}')
VPS_DIR=$ROOT
DONE
