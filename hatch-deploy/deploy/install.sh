#!/usr/bin/env bash
#
# Install the Hatch deploy broker on a Debian/Ubuntu VPS.
#
# Idempotent: safe to re-run to pick up new code. It never deletes anything and
# never overwrites an existing .env — re-running upgrades the code and restarts
# the service, nothing else.
#
#   sudo bash deploy/install.sh
#
# On a RunCloud / Ploi / Forge box, see the note at the bottom: those manage
# nginx and process supervision themselves, so use their UI for those two parts
# and let this script do the rest.
#
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_USER="${SERVICE_USER:-hatch}"
PORT="${PORT:-3000}"
ENV_FILE="$APP_DIR/.env"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo — it creates a user and a systemd unit."

# ── Prerequisites ──────────────────────────────────────────────────────────
say "Checking prerequisites"

command -v git >/dev/null || die "git is missing. apt-get install -y git"
command -v node >/dev/null || die "node is missing. Install Node 20+ (e.g. via nodesource) and re-run."
command -v npm  >/dev/null || die "npm is missing."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR found; the broker needs >= 20 (package.json engines)."

# Every deploy shells out to `npx vercel` / `npx wrangler@latest`, which are NOT
# dependencies — they are fetched at build time. A box that cannot reach the npm
# registry will clone and build fine, then fail at the upload step, which is a
# miserable thing to debug later.
say "Checking npm registry reachability (needed at deploy time, not just now)"
npm ping >/dev/null 2>&1 || die "cannot reach the npm registry. Deploys fetch vercel/wrangler via npx and would fail at upload."

echo "  node $(node -v), npm $(npm -v), git $(git --version | awk '{print $3}')"

# ── Service user ───────────────────────────────────────────────────────────
if id "$SERVICE_USER" >/dev/null 2>&1; then
	echo "  user '$SERVICE_USER' already exists"
else
	say "Creating service user '$SERVICE_USER'"
	useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── Dependencies ───────────────────────────────────────────────────────────
say "Installing dependencies in $APP_DIR"
cd "$APP_DIR"
# `npm ci` when a lockfile exists, so the install is reproducible.
if [ -f package-lock.json ]; then
	sudo -u "$SERVICE_USER" npm ci --omit=dev
else
	sudo -u "$SERVICE_USER" npm install --omit=dev --no-audit --no-fund
fi

# ── Configuration ──────────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
	say "Keeping existing $ENV_FILE"
else
	say "Writing a starter $ENV_FILE — EDIT IT before the service is useful"
	cat > "$ENV_FILE" <<EOF
# The port nginx forwards to.
PORT=$PORT

# This instance's own public URL. Used to build the links it hands back.
HATCH_DEPLOY_BASE=https://CHANGE-ME.example.com

# Repo the Astro starter is cloned from. Must contain a top-level astro-starter/.
# The default below is public, so it needs no credentials. For a PRIVATE repo see
# the README — do not put a token here on a broker older than the redaction fix,
# because the clone URL is written into the build log.
HATCH_REPO=https://github.com/eticastudio/hatch.git
HATCH_BRANCH=main

# Optional: where builds are staged. Defaults to the system temp dir.
# HATCH_ROOT_DIR=/var/lib/hatch-deploy
EOF
fi
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── systemd ────────────────────────────────────────────────────────────────
say "Installing the systemd unit"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__USER__|$SERVICE_USER|g" \
	"$APP_DIR/deploy/hatch-deploy.service" > /etc/systemd/system/hatch-deploy.service

systemctl daemon-reload
systemctl enable hatch-deploy >/dev/null 2>&1 || true
systemctl restart hatch-deploy

sleep 2
if systemctl is-active --quiet hatch-deploy; then
	echo "  service is running"
else
	journalctl -u hatch-deploy -n 30 --no-pager || true
	die "the service did not start — the log above should say why."
fi

# ── Verify ─────────────────────────────────────────────────────────────────
say "Checking it answers locally"
if curl -fsS --max-time 10 "http://127.0.0.1:$PORT/health" >/dev/null; then
	echo "  /health OK on 127.0.0.1:$PORT"
else
	die "/health did not answer on port $PORT. Check: journalctl -u hatch-deploy -f"
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────
Running on 127.0.0.1:$PORT. Three things left, none of which this script
should be doing for you:

 1. Edit $ENV_FILE — at minimum HATCH_DEPLOY_BASE — then:
      sudo systemctl restart hatch-deploy

 2. Put HTTPS in front of it. See deploy/nginx.conf.example, then:
      sudo certbot --nginx -d your.domain
    TLS is not optional: /prepare carries a WordPress Application Password
    and the customer's Vercel/Cloudflare token.

 3. Point WordPress at it, in wp-config.php:
      define( 'HATCH_DEPLOY_BROKER_URL', 'https://your.domain' );

Managed panel (RunCloud, Ploi, Forge)? Skip steps involving nginx and
systemd — create a Web Application for the domain and a supervisor/daemon
job running 'npm start' in $APP_DIR as '$SERVICE_USER', with $ENV_FILE
loaded. Those panels rewrite their own nginx configs, so a hand-written
vhost will be overwritten.

Logs:    journalctl -u hatch-deploy -f
Restart: sudo systemctl restart hatch-deploy
────────────────────────────────────────────────────────────────────────
EOF
