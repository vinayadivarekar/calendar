#!/usr/bin/env bash
#
# install-el8.sh — install Family Calendar on Oracle Linux 8 / RHEL 8 / Rocky 8.
#
# Usage:
#   sudo bash install-el8.sh                       # HTTP only, no domain
#   sudo bash install-el8.sh calendar.example.com  # HTTPS via Let's Encrypt
#
# Optional env var for Let's Encrypt expiry warnings:
#   CERTBOT_EMAIL=you@example.com sudo -E bash install-el8.sh calendar.example.com
#
# Prerequisite: the app tarball must already be at /tmp/calendar.tar.gz.
# On your Mac, build it with:
#   cd ~/Desktop/claude_proj
#   tar -czf calendar.tar.gz --exclude=node_modules --exclude=data --exclude=.env calender
#   scp calendar.tar.gz install-el8.sh you@server:/tmp/

set -euo pipefail

DOMAIN="${1:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
APP_DIR="/opt/family-calendar"
APP_USER="familycal"
TARBALL="/tmp/calendar.tar.gz"
NODE_BIN="/usr/bin/node"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]]   || die "Run with sudo: sudo bash $0 ${DOMAIN:-}"
[[ -f $TARBALL ]]   || die "Source tarball not found at $TARBALL. scp it from your Mac first."

# ---------------------------------------------------------------------------
log "Step 1/12  Installing base packages"
dnf install -y -q curl tar nano sqlite policycoreutils-python-utils >/dev/null

# ---------------------------------------------------------------------------
log "Step 2/12  Installing Node.js 22 (if needed)"
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [[ $major -ge 22 ]] && need_node=0
fi
if [[ $need_node -eq 1 ]]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
  dnf install -y -q nodejs >/dev/null
fi
log "    Node $(node --version)"

# ---------------------------------------------------------------------------
log "Step 3/12  Unpacking app to $APP_DIR"
mkdir -p "$APP_DIR"
tar -xzf "$TARBALL" -C "$APP_DIR" --strip-components=1

# ---------------------------------------------------------------------------
log "Step 4/12  Installing npm dependencies (no native compile)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --silent )

# ---------------------------------------------------------------------------
log "Step 5/12  Configuring .env"
if [[ ! -f $APP_DIR/.env ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET=$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" "$APP_DIR/.env"
  sed -i "s|^HOST=.*|HOST=127.0.0.1|" "$APP_DIR/.env"
  [[ -n $DOMAIN ]] && sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" "$APP_DIR/.env"
  log "    Generated JWT_SECRET and wrote $APP_DIR/.env"
else
  warn "    $APP_DIR/.env already exists — leaving it untouched"
fi

# ---------------------------------------------------------------------------
log "Step 6/12  Creating service user '$APP_USER'"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$APP_USER"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
log "Step 7/12  Installing systemd unit"
cat > /etc/systemd/system/family-calendar.service <<EOF
[Unit]
Description=Family Calendar
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_NO_WARNINGS=1
ExecStart=$NODE_BIN --experimental-sqlite server.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$APP_DIR/data $APP_DIR/backups

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable family-calendar >/dev/null 2>&1 || true
systemctl restart family-calendar

# ---------------------------------------------------------------------------
log "Step 8/12  Smoke-testing on 127.0.0.1:3000"
ok=0
for i in 1 2 3 4 5 6 7 8; do
  if curl -fsS http://127.0.0.1:3000/api/auth/status | grep -q initialized; then
    ok=1; break
  fi
  sleep 1
done
if [[ $ok -ne 1 ]]; then
  journalctl -u family-calendar -n 40 --no-pager
  die "Smoke test failed — service is not responding on 127.0.0.1:3000"
fi
log "    Service is healthy"

# ---------------------------------------------------------------------------
log "Step 9/12  Installing and configuring nginx"
dnf install -y -q nginx >/dev/null
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/conf.d/family-calendar.conf <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
rm -f /etc/nginx/conf.d/default.conf
nginx -t >/dev/null
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

# ---------------------------------------------------------------------------
log "Step 10/12  Setting SELinux booleans"
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null)" != "Disabled" ]]; then
  setsebool -P httpd_can_network_connect 1
else
  warn "    SELinux is disabled — skipping booleans"
fi

# ---------------------------------------------------------------------------
log "Step 11/12  Configuring firewalld"
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http  >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
else
  warn "    firewalld not running — skipping firewall rules"
fi

# ---------------------------------------------------------------------------
log "Step 12/12  HTTPS via Let's Encrypt"
if [[ -n $DOMAIN ]]; then
  if ! rpm -q oracle-epel-release-el8 epel-release >/dev/null 2>&1; then
    dnf install -y -q oracle-epel-release-el8 >/dev/null 2>&1 \
      || dnf install -y -q epel-release >/dev/null
  fi
  dnf install -y -q certbot python3-certbot-nginx >/dev/null

  certbot_args=(--nginx --non-interactive --agree-tos --redirect -d "$DOMAIN")
  if [[ -n $CERTBOT_EMAIL ]]; then
    certbot_args+=(-m "$CERTBOT_EMAIL")
  else
    certbot_args+=(--register-unsafely-without-email)
  fi
  if ! certbot "${certbot_args[@]}"; then
    warn "    certbot failed — fix DNS for $DOMAIN, then re-run: sudo certbot --nginx -d $DOMAIN"
  fi
else
  warn "    No DOMAIN argument — skipping HTTPS. Re-run with: sudo bash $0 calendar.example.com"
fi

# ---------------------------------------------------------------------------
log "Setting up nightly SQLite backups (30-day retention)"
mkdir -p "$APP_DIR/backups"
chown "$APP_USER:$APP_USER" "$APP_DIR/backups"
cat > /etc/cron.d/family-calendar-backup <<EOF
0 3 * * * $APP_USER /usr/bin/sqlite3 $APP_DIR/data/calendar.db ".backup '$APP_DIR/backups/calendar-\$(date +\\%F).db'" && find $APP_DIR/backups -name 'calendar-*.db' -mtime +30 -delete
EOF

# ---------------------------------------------------------------------------
echo
log "Install complete."
echo

if [[ -n $DOMAIN ]]; then
  printf '  Open:  \033[1;32mhttps://%s\033[0m\n' "$DOMAIN"
else
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '  Open:  \033[1;32mhttp://%s\033[0m  (or your server hostname)\n' "${IP:-<server-ip>}"
fi

cat <<MSG

  The first visitor will see "Create the admin account" — that becomes you.
  From the top bar, click "Manage family" to add accounts for everyone else.

  Useful commands:
    sudo systemctl status family-calendar    # service health
    sudo journalctl -u family-calendar -f    # tail logs
    sudo systemctl restart family-calendar   # after .env/code changes

  Backups land in $APP_DIR/backups (nightly at 03:00, 30-day retention).
MSG
