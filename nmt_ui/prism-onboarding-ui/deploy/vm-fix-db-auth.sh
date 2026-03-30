#!/usr/bin/env bash
# One-shot on Rocky/RHEL VM when DATABASE_URL uses localhost (ident / ::1 issues).
# Run as root:  bash vm-fix-db-auth.sh

set -euo pipefail
[[ "${EUID:-0}" -eq 0 ]] || { echo "Run as root"; exit 1; }

BACKEND="${BACKEND:-/opt/nmt/prism-onboarding-ui/backend}"
VENV="${VENV:-/opt/nmt/venv}"

# RHEL/Rocky often uses /var/lib/pgsql/13/data (or similar), not /var/lib/pgsql/data.
# Editing the wrong pg_hba.conf leaves ident rules in effect for the running server.
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

PGDATA="${PGDATA:-}"
if [[ -z "$PGDATA" ]]; then
  PGDATA="$(resolve_pgdata)"
fi
if [[ -z "$PGDATA" || ! -f "${PGDATA}/pg_hba.conf" ]]; then
  echo "ERROR: Could not find PostgreSQL data directory (pg_hba.conf). Set PGDATA=... explicitly."
  exit 1
fi
HBA="${PGDATA}/pg_hba.conf"

# Must match remote-install / app default (TCP to IPv4 — avoids localhost → ::1 or unix socket)
GOOD_URL='postgresql://alertuser:alertpass@127.0.0.1:5432/alerts'

echo "==> Using PostgreSQL PGDATA=${PGDATA} (from SHOW data_directory or scan)"
echo "==> Prepend md5 rules to ${HBA}"
if [[ ! -f "$HBA" ]]; then
  echo "ERROR: $HBA not found"
  exit 1
fi
if ! grep -q 'NMT local TCP md5' "$HBA" 2>/dev/null; then
  cp -a "$HBA" "${HBA}.bak.vmfix-$(date +%s)"
  tmp="$(mktemp)"
  {
    echo '# NMT local TCP md5 (password auth for SQLAlchemy/psycopg2)'
    echo 'host    all    all    127.0.0.1/32    md5'
    echo 'host    all    all    ::1/128         md5'
    echo ''
    cat "$HBA"
  } >"$tmp"
  mv "$tmp" "$HBA"
fi
systemctl restart postgresql

echo "==> Verify top of pg_hba (NMT md5 lines must be first matching host rules):"
head -n 18 "$HBA"

echo "==> Force DATABASE_URL to 127.0.0.1 (TCP) in ${BACKEND}/.env"
mkdir -p "$BACKEND"
if [[ -f "${BACKEND}/.env" ]]; then
  grep -v '^DATABASE_URL=' "${BACKEND}/.env" > "${BACKEND}/.env.tmp.$$" || true
  mv "${BACKEND}/.env.tmp.$$" "${BACKEND}/.env"
fi
echo "DATABASE_URL=${GOOD_URL}" >> "${BACKEND}/.env"
grep '^DATABASE_URL=' "${BACKEND}/.env" || true

echo "==> init_db (DATABASE_URL passed in environment — do not rely on source .env)"
cd "$BACKEND"
DATABASE_URL="${GOOD_URL}" "${VENV}/bin/python" -c "from database import init_db; init_db()"

echo "==> restart backend"
systemctl restart nmt-backend 2>/dev/null || true
echo "Done. Check: systemctl status nmt-backend"
