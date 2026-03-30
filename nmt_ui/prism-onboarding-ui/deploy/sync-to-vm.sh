#!/usr/bin/env bash
# Build the SPA and sync only what is needed to the VM (backend + dist + nginx unit).
# Usage:
#   export DEPLOY_HOST=10.117.66.44
#   export DEPLOY_USER=root
#   ./deploy/sync-to-vm.sh
#
# Requires: npm, ssh, rsync. Run from prism-onboarding-ui/.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-10.117.66.44}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_BASE="${REMOTE_BASE:-/opt/nmt/prism-onboarding-ui}"

echo "==> Building frontend (vite only; use full 'npm run build' if you need tsc -b)..."
npm run build:deploy

echo "==> rsync backend + built dist to ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_BASE}/"
rsync -avz --delete \
  --exclude-from="${ROOT}/deploy/rsync-exclude.txt" \
  --exclude 'venv/' \
  "${ROOT}/backend/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_BASE}/backend/"

rsync -avz --delete "${ROOT}/dist/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_BASE}/dist/"

rsync -avz \
  "${ROOT}/deploy/nginx-nmt-site.conf" \
  "${ROOT}/deploy/nmt-backend.service" \
  "${ROOT}/deploy/env.backend.example" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_BASE}/deploy-artifacts/"

echo ""
echo "Done. On the server (first time):"
echo "  1. apt install -y nginx python3 python3-venv python3-pip postgresql  # or use existing"
echo "  2. python3 -m venv /opt/nmt/venv && /opt/nmt/venv/bin/pip install -r ${REMOTE_BASE}/backend/requirements.txt"
echo "  3. cp ${REMOTE_BASE}/deploy-artifacts/env.backend.example ${REMOTE_BASE}/backend/.env  # then edit DATABASE_URL and CORS_ORIGINS"
echo "  4. sudo cp ${REMOTE_BASE}/deploy-artifacts/nginx-nmt-site.conf /etc/nginx/sites-available/nmt && sudo ln -sf /etc/nginx/sites-available/nmt /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx"
echo "  5. sudo cp ${REMOTE_BASE}/deploy-artifacts/nmt-backend.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now nmt-backend"
echo "Open: http://${DEPLOY_HOST}/"
