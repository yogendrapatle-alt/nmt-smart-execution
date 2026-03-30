#!/usr/bin/env bash
# Run ON THE VM as root after extracting the deployment bundle (same folder as backend/ and dist/).
# Supports: Debian/Ubuntu (apt) and RHEL/CentOS/Fedora/Alma/Rocky (dnf/yum).
# Usage: VM_PUBLIC_HOST=10.117.66.44 ./remote-install.sh

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

VM_PUBLIC_HOST="${VM_PUBLIC_HOST:-10.117.66.44}"
INSTALL_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="${INSTALL_ROOT}/backend"
DIST="${INSTALL_ROOT}/dist"
ART="${INSTALL_ROOT}/deploy-artifacts"
VENV="/opt/nmt/venv"

if [[ ! -d "$BACKEND" ]] || [[ ! -d "$DIST" ]]; then
  echo "ERROR: Expected directories backend/ and dist/ under $INSTALL_ROOT"
  exit 1
fi

detect_pkg() {
  if command -v apt-get >/dev/null 2>&1; then echo apt; return; fi
  if command -v dnf >/dev/null 2>&1; then echo dnf; return; fi
  if command -v yum >/dev/null 2>&1; then echo yum; return; fi
  echo ""
}

install_packages_debian() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y nginx python3 python3-venv python3-pip postgresql postgresql-contrib
}

install_packages_rhel() {
  local pm="$1"
  $pm install -y nginx python3 python3-pip postgresql-server postgresql-contrib
  if [[ -x /usr/bin/postgresql-setup ]]; then
    if [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
      /usr/bin/postgresql-setup --initdb
    fi
  elif compgen -G "/usr/bin/postgresql*-setup" >/dev/null; then
    setup_bin="$(compgen -G "/usr/bin/postgresql*-setup" | head -1)"
    if [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
      "$setup_bin" --initdb
    fi
  fi
  systemctl enable postgresql --now
}

# RHEL/Rocky may use /var/lib/pgsql/13/data (or similar), not /var/lib/pgsql/data.
resolve_pgdata() {
  local d=""
  if command -v sudo >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
    d="$(sudo -u postgres psql -X -tAc 'SHOW data_directory;' 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  if [[ -n "$d" && -f "$d/pg_hba.conf" ]]; then
    echo "$d"
    return 0
  fi
  for p in /var/lib/pgsql/data /var/lib/pgsql/*/data; do
    if [[ -f "$p/pg_hba.conf" ]]; then
      echo "$p"
      return 0
    fi
  done
  echo ""
}

# RHEL default pg_hba often uses "ident" for 127.0.0.1 / ::1 — first matching rule wins.
# Prepend md5 rules so TCP password auth works (PostgreSQL reads rules top-to-bottom).
fix_pg_hba_local_tcp_password() {
  local PGDATA="${PGDATA:-}"
  if [[ -z "$PGDATA" ]]; then
    PGDATA="$(resolve_pgdata)"
  fi
  if [[ -z "$PGDATA" ]]; then
    PGDATA="/var/lib/pgsql/data"
  fi
  local HBA="${PGDATA}/pg_hba.conf"
  [[ -f "$HBA" ]] || return 0
  if grep -q 'NMT local TCP md5' "$HBA" 2>/dev/null; then
    return 0
  fi
  cp -a "$HBA" "${HBA}.bak.nmt-$(date +%s)"
  local tmp
  tmp="$(mktemp)"
  {
    echo '# NMT local TCP md5 (password auth for SQLAlchemy/psycopg2)'
    echo 'host    all    all    127.0.0.1/32    md5'
    echo 'host    all    all    ::1/128         md5'
    echo ''
    cat "$HBA"
  } >"$tmp"
  mv "$tmp" "$HBA"
  systemctl restart postgresql
}

# Avoid localhost → ::1 + ident; force IPv4 TCP password auth.
normalize_database_url_in_env() {
  local f="${BACKEND}/.env"
  [[ -f "$f" ]] || return 0
  sed -i.bak.nmturl '/^DATABASE_URL=/s/@localhost/@127.0.0.1/g' "$f"
}

install_nginx_site() {
  local src="$1"
  if [[ -d /etc/nginx/sites-available ]] && [[ -d /etc/nginx/sites-enabled ]]; then
    cp -f "$src" /etc/nginx/sites-available/nmt
    ln -sf /etc/nginx/sites-available/nmt /etc/nginx/sites-enabled/nmt
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  else
    # RHEL/Fedora: conf.d
    cp -f "$src" /etc/nginx/conf.d/nmt.conf
    rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
  fi
}

PKG="$(detect_pkg)"
if [[ -z "$PKG" ]]; then
  echo "ERROR: No supported package manager (apt-get, dnf, or yum)."
  exit 1
fi

echo "==> Detected package manager: $PKG"
echo "==> Installing packages (nginx, Python, PostgreSQL)..."

case "$PKG" in
  apt)
    install_packages_debian
    systemctl enable postgresql --now 2>/dev/null || systemctl start postgresql
    ;;
  dnf|yum)
    install_packages_rhel "$PKG"
    ;;
esac

# SELinux: allow nginx to proxy to Flask
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null)" == "Enforcing" ]]; then
  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

echo "==> PostgreSQL user and database..."
sudo -u postgres psql -c "CREATE USER alertuser WITH PASSWORD 'alertpass';" 2>/dev/null || true
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='alerts'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE alerts OWNER alertuser;"
fi
sudo -u postgres psql -d alerts -c "GRANT ALL ON SCHEMA public TO alertuser;" 2>/dev/null || true
sudo -u postgres psql -d alerts -c "ALTER DATABASE alerts OWNER TO alertuser;" 2>/dev/null || true

echo "==> PostgreSQL: allow password auth on 127.0.0.1 / ::1 (RHEL ident -> md5)..."
fix_pg_hba_local_tcp_password

echo "==> Python venv + requirements..."
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip -q
"$VENV/bin/pip" install -r "${BACKEND}/requirements.txt"

echo "==> Backend .env..."
if [[ ! -f "${BACKEND}/.env" ]]; then
  cat > "${BACKEND}/.env" <<EOF
DATABASE_URL=postgresql://alertuser:alertpass@127.0.0.1:5432/alerts
CORS_ORIGINS=http://${VM_PUBLIC_HOST},http://127.0.0.1,http://localhost,http://localhost:3000,http://127.0.0.1:3000
EOF
else
  echo "(keeping existing ${BACKEND}/.env — normalizing DATABASE_URL host if needed)"
fi
normalize_database_url_in_env

echo "==> Initialize DB tables..."
INIT_DB_URL='postgresql://alertuser:alertpass@127.0.0.1:5432/alerts'
if [[ -f "${BACKEND}/.env" ]] && grep -q '^DATABASE_URL=' "${BACKEND}/.env"; then
  INIT_DB_URL="$(grep '^DATABASE_URL=' "${BACKEND}/.env" | head -1 | sed "s/^DATABASE_URL=//;s/^[\"']//;s/[\"']$//")"
fi
(
  cd "$BACKEND"
  DATABASE_URL="${INIT_DB_URL}" "$VENV/bin/python" -c "from database import init_db; init_db()"
)

NGINX_SRC=""
if [[ -f "${ART}/nginx-nmt-site.conf" ]]; then
  NGINX_SRC="${ART}/nginx-nmt-site.conf"
elif [[ -f "${INSTALL_ROOT}/nginx-nmt-site.conf" ]]; then
  NGINX_SRC="${INSTALL_ROOT}/nginx-nmt-site.conf"
else
  echo "ERROR: nginx config not found in deploy-artifacts/"
  exit 1
fi

echo "==> nginx..."
install_nginx_site "$NGINX_SRC"
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx
systemctl enable nginx

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-service=http 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi

echo "==> systemd backend..."
if [[ -f "${ART}/nmt-backend.service" ]]; then
  cp -f "${ART}/nmt-backend.service" /etc/systemd/system/nmt-backend.service
elif [[ -f "${INSTALL_ROOT}/nmt-backend.service" ]]; then
  cp -f "${INSTALL_ROOT}/nmt-backend.service" /etc/systemd/system/nmt-backend.service
else
  echo "ERROR: nmt-backend.service not found"
  exit 1
fi
systemctl daemon-reload
systemctl enable nmt-backend
systemctl restart nmt-backend

echo ""
echo "Done. Open: http://${VM_PUBLIC_HOST}/"
echo "Check: systemctl status nmt-backend nginx postgresql"
echo "Logs: journalctl -u nmt-backend -n 80 --no-pager"
