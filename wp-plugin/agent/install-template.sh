#!/usr/bin/env bash
#
# Hatch Frontend Agent — installer template.
#
# This file is a TEMPLATE. The Hatch WP plugin serves a copy of this with
# real values substituted before sending.
#
# SECURITY: every free-text value arrives BASE64-ENCODED. Base64 contains only
# [A-Za-z0-9+/=], none of which the shell treats specially, so a value can
# never close a quote or start a command substitution no matter what it
# contains. Values are decoded into variables and VALIDATED before use; the
# config file is written by node from environment variables, never through a
# shell heredoc.
#
# Placeholders:
#   {{HATCH_SECRET_B64}}    — HMAC shared secret (48 chars)
#   {{HATCH_PORT}}          — agent listen port (integer, default 34210)
#   {{HATCH_WORKDIR_B64}}   — where Astro frontend lives (default /var/www/hatch-frontend)
#   {{HATCH_WP_URL_B64}}    — the user's WordPress URL (for logging only)
#   {{HATCH_GIT_REPO_B64}}  — frontend git repository URL
#   {{HATCH_BRANCH_B64}}    — branch to track (default main)
#   {{HATCH_PM2_NAME_B64}}  — PM2 process name (default hatch-frontend)
#   {{AGENT_JS_BASE64}}     — agent.js source base64-encoded (no second download)
#
# Run as root on a fresh-ish Ubuntu 22.04 / 24.04 / Debian 12 VPS.

set -euo pipefail

b64() { printf '%s' "$1" | base64 -d; }

SECRET="$(b64 '{{HATCH_SECRET_B64}}')"
PORT='{{HATCH_PORT}}'
WORKDIR="$(b64 '{{HATCH_WORKDIR_B64}}')"
WP_URL="$(b64 '{{HATCH_WP_URL_B64}}')"
GIT_REPO="$(b64 '{{HATCH_GIT_REPO_B64}}')"
BRANCH="$(b64 '{{HATCH_BRANCH_B64}}')"
PM2_NAME="$(b64 '{{HATCH_PM2_NAME_B64}}')"

# ---- validate (defence in depth: encoding already makes injection impossible) ----
fail() { echo "ERROR: $1" >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]{2,5}$ ]]                          || fail "invalid port"
[[ "$WORKDIR" =~ ^/[A-Za-z0-9._/-]+$ ]]                || fail "invalid workdir (absolute path, letters/digits/._/- only)"
[[ "$WORKDIR" != *".."* ]]                             || fail "workdir must not contain .."
[[ "$PM2_NAME" =~ ^[A-Za-z0-9._-]+$ ]]                 || fail "invalid pm2 name"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]                  || fail "invalid branch name"
[[ "$SECRET" =~ ^[A-Za-z0-9]{32,}$ ]]                  || fail "invalid secret"
[[ -z "$GIT_REPO" || "$GIT_REPO" =~ ^(https://|ssh://|git@)[A-Za-z0-9._@:/~+-]+$ ]] || fail "invalid git repository URL"
[[ "$WP_URL" =~ ^https?://[A-Za-z0-9._:/-]+$ ]]        || fail "invalid WordPress URL"

# ---- preflight ----
if [ "$(id -u)" -ne 0 ]; then
	echo "ERROR: This installer must be run as root." >&2
	echo "Try: curl ... | sudo bash" >&2
	exit 1
fi

if ! grep -qE '^(Ubuntu 22|Ubuntu 24|Debian GNU/Linux 12)' /etc/os-release 2>/dev/null; then
	echo "WARNING: Tested on Ubuntu 22.04/24.04 and Debian 12. Your OS may need manual tweaks." >&2
fi

if ! command -v systemctl >/dev/null 2>&1; then
	echo "ERROR: systemd is required (this installer uses systemctl)." >&2
	exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Hatch Frontend Agent — installer"
echo "  WordPress: $WP_URL"
echo "  Agent dir: /opt/hatch-agent"
echo "  Workdir:   $WORKDIR"
echo "  Port:      $PORT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ---- install packages ----
echo "▶ Installing dependencies (apt) …"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw openssl >/dev/null

# Node.js 22 LTS via NodeSource (skip if recent enough already installed)
NODE_OK=0
if command -v node >/dev/null 2>&1; then
	NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
	if [ "${NODE_MAJOR:-0}" -ge 20 ]; then NODE_OK=1; fi
fi
if [ "$NODE_OK" -eq 0 ]; then
	echo "▶ Installing Node.js 22 LTS …"
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
	apt-get install -y -qq nodejs >/dev/null
fi

# PM2 (global)
if ! command -v pm2 >/dev/null 2>&1; then
	echo "▶ Installing PM2 …"
	npm install -g pm2 --silent
fi

# ---- create user + dirs ----
if ! id -u hatch >/dev/null 2>&1; then
	echo "▶ Creating hatch system user …"
	useradd --system --create-home --shell /bin/bash hatch
fi

mkdir -p /opt/hatch-agent /etc/hatch-agent/tls
chown hatch:hatch /opt/hatch-agent

# ---- frontend workdir ----
if [ ! -d "$WORKDIR" ]; then
	echo "▶ Creating frontend workdir at $WORKDIR …"
	mkdir -p "$WORKDIR"
	chown hatch:hatch "$WORKDIR"
fi

if [ -n "$GIT_REPO" ] && [ ! -d "$WORKDIR/.git" ]; then
	echo "▶ Cloning frontend from $GIT_REPO …"
	sudo -u hatch git clone -- "$GIT_REPO" "$WORKDIR" || {
		echo "WARNING: git clone failed. You can clone manually later into $WORKDIR" >&2
	}
fi

# ---- drop agent.js (base64-decoded from template) ----
echo "▶ Writing agent.js …"
echo '{{AGENT_JS_BASE64}}' | base64 -d > /opt/hatch-agent/agent.js
chown hatch:hatch /opt/hatch-agent/agent.js
chmod 755 /opt/hatch-agent/agent.js

# ---- TLS certificate (self-signed; the WordPress plugin pins its key) ----
# Generated ONCE and kept: the plugin pins this key the first time you click
# "Verify connection", so replacing it later means verifying again.
if [ ! -f /etc/hatch-agent/tls/key.pem ] || [ ! -f /etc/hatch-agent/tls/cert.pem ]; then
	echo "▶ Generating TLS certificate …"
	openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
		-subj "/CN=hatch-agent" \
		-keyout /etc/hatch-agent/tls/key.pem \
		-out /etc/hatch-agent/tls/cert.pem >/dev/null 2>&1
fi
chmod 600 /etc/hatch-agent/tls/key.pem
chmod 644 /etc/hatch-agent/tls/cert.pem
chown -R hatch:hatch /etc/hatch-agent/tls

# ---- config (written by node from the environment: no shell expansion of values) ----
echo "▶ Writing /etc/hatch-agent/config.json …"
HATCH_CFG_SECRET="$SECRET" HATCH_CFG_PORT="$PORT" HATCH_CFG_WORKDIR="$WORKDIR" \
HATCH_CFG_PM2="$PM2_NAME" HATCH_CFG_WP="$WP_URL" \
node -e '
const e = process.env;
const cfg = {
  secret: e.HATCH_CFG_SECRET,
  port: Number(e.HATCH_CFG_PORT),
  bind: "0.0.0.0",
  workdir: e.HATCH_CFG_WORKDIR,
  pm2_name: e.HATCH_CFG_PM2,
  wp_url: e.HATCH_CFG_WP,
  tls_cert: "/etc/hatch-agent/tls/cert.pem",
  tls_key: "/etc/hatch-agent/tls/key.pem"
};
require("fs").writeFileSync("/etc/hatch-agent/config.json", JSON.stringify(cfg, null, 2) + "\n");
'
chmod 600 /etc/hatch-agent/config.json
chown hatch:hatch /etc/hatch-agent/config.json

# ---- systemd unit ----
echo "▶ Registering systemd service hatch-agent.service …"
cat > /etc/systemd/system/hatch-agent.service <<'UNITEND'
[Unit]
Description=Hatch Frontend Agent
After=network.target

[Service]
Type=simple
User=hatch
Group=hatch
WorkingDirectory=/opt/hatch-agent
ExecStart=/usr/bin/node /opt/hatch-agent/agent.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hatch-agent
# Hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEND

systemctl daemon-reload
systemctl enable hatch-agent.service >/dev/null 2>&1 || true
systemctl restart hatch-agent.service

# ---- firewall ----
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
	echo "▶ Opening port $PORT/tcp on ufw …"
	ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
fi

# ---- wait for service to come up (HTTPS, self-signed: -k is for this local probe only) ----
echo ""
echo "▶ Waiting for agent to come up …"
ATTEMPTS=0
while [ $ATTEMPTS -lt 15 ]; do
	if curl -fsSk "https://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
		break
	fi
	ATTEMPTS=$((ATTEMPTS + 1))
	sleep 1
done

if curl -fsSk "https://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
	IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
	echo ""
	echo "✓ Hatch Agent is running (HTTPS)."
	echo ""
	echo "  Now in WordPress admin, go to:  Tools → Hatch → Frontend"
	echo "  Paste this host:                $IP:$PORT"
	echo "  Click:                          Verify connection"
	echo "  (the first Verify pins this agent's certificate)"
	echo ""
	echo "  Logs:    journalctl -u hatch-agent -f"
	echo "  Status:  systemctl status hatch-agent"
	echo ""
else
	echo "" >&2
	echo "✕ Agent did not start. Check logs with:" >&2
	echo "    journalctl -u hatch-agent -n 50 --no-pager" >&2
	exit 1
fi
