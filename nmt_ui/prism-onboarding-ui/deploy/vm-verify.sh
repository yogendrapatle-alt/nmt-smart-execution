#!/usr/bin/env bash
# Run ON THE VM as root after deployment. Checks paths, services, nginx, DB readability.
# Usage: VM_PUBLIC_HOST=10.117.66.44 ./vm-verify.sh

set -euo pipefail

ROOT="${ROOT:-/opt/nmt/prism-onboarding-ui}"
BACKEND="${ROOT}/backend"
DIST="${ROOT}/dist"
VM_PUBLIC_HOST="${VM_PUBLIC_HOST:-127.0.0.1}"

fail=0
ok() { echo "OK  $*"; }
warn() { echo "WARN $*"; }
bad() { echo "FAIL $*"; fail=1; }

echo "==> Paths"
[[ -f "${BACKEND}/app.py" ]] && ok "backend/app.py" || bad "missing ${BACKEND}/app.py"
[[ -f "${DIST}/index.html" ]] && ok "dist/index.html" || bad "missing ${DIST}/index.html (run npm run build:deploy before package-for-vm.sh)"

echo "==> Services"
for s in postgresql nginx nmt-backend; do
  if systemctl is-active --quiet "$s" 2>/dev/null; then
    ok "$s active"
  else
    bad "$s not active (systemctl status $s)"
  fi
done

echo "==> PostgreSQL pg_hba (postgres must read file)"
HBA="$(sudo -u postgres psql -X -tAc 'SHOW hba_file;' 2>/dev/null | tr -d '[:space:]' || true)"
if [[ -n "$HBA" ]]; then
  if sudo -u postgres test -r "$HBA" 2>/dev/null; then
    ok "postgres can read $HBA"
  else
    bad "postgres cannot read $HBA — chown postgres:postgres $HBA && chmod 600 $HBA"
  fi
else
  warn "could not read hba_file (is PostgreSQL up?)"
fi

echo "==> HTTP (nginx → SPA or API)"
code="$(curl -s -o /tmp/nmt-verify-body.html -w '%{http_code}' "http://127.0.0.1/" || echo 000)"
if [[ "$code" == "200" ]]; then
  ok "GET / → HTTP $code"
  if grep -qi 'Welcome to nginx on Rocky\|nginx on Rocky Linux' /tmp/nmt-verify-body.html 2>/dev/null; then
    bad "still seeing Rocky default welcome page — disable default server in /etc/nginx/nginx.conf or re-run remote-install.sh from a fresh bundle"
  else
    ok "body does not look like stock Rocky welcome page"
  fi
else
  bad "GET / → HTTP $code"
fi

rm -f /tmp/nmt-verify-body.html

code_api="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1/api/" 2>/dev/null || echo 000)"
[[ "$code_api" =~ ^(200|401|404|405)$ ]] && ok "GET /api/ → HTTP $code_api (backend reachable)" || warn "GET /api/ → HTTP $code_api"

echo "==> Summary"
if [[ "$fail" -eq 0 ]]; then
  echo "All checks passed. Open: http://${VM_PUBLIC_HOST}/"
  exit 0
fi
echo "Some checks failed. Fix items above and re-run."
exit 1
