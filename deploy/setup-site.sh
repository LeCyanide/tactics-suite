#!/usr/bin/env bash
# One-time setup of the download site, on the VPS that already runs the update
# server (setup-vps.sh). Point the domain's and www's DNS records at the VPS
# first; Caddy fetches the HTTPS certificates on reload.
#
#   scp deploy/site.caddy deploy/setup-site.sh root@vps:
#   ssh root@vps 'bash setup-site.sh fw-suite.de'
#
# Safe to re-run. Then set VPS_SITE_DIR=/srv/wows-site in .env.release and
# `npm run release -- --notes-only` uploads the page.
set -euo pipefail

DOMAIN="${1:?usage: bash setup-site.sh <domain> [uploader]}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UPLOADER="${2:-wows-release}"
ROOT=/srv/wows-site

# The uploader writes, Caddy reads.
install -d -m 2775 -o "$UPLOADER" -g caddy "$ROOT"

mkdir -p /etc/caddy/conf.d
sed "s/SITE_DOMAIN/$DOMAIN/g" "$HERE/site.caddy" > /etc/caddy/conf.d/wows-site.caddy
chmod 644 /etc/caddy/conf.d/wows-site.caddy

# The main Caddyfile reads the update server's values from its env file.
(set -a; . /etc/caddy/wows-updates.env; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null)
systemctl reload caddy
echo "Download site configured for https://$DOMAIN, served from $ROOT."
