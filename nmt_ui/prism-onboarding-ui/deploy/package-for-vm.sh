#!/usr/bin/env bash
# Build the SPA and create a single tarball you can copy to the VM (scp with password is fine).
# Produces: deploy/prism-onboarding-ui-bundle.tar.gz
#
# On the VM (as root):
#   mkdir -p /opt/nmt && tar xzf prism-onboarding-ui-bundle.tar.gz -C /opt/nmt
#   cd /opt/nmt/prism-onboarding-ui && chmod +x remote-install.sh && VM_PUBLIC_HOST=10.117.66.44 ./remote-install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm run build:deploy"
npm run build:deploy

STAGE="$(mktemp -d)"
BUNDLE_NAME="prism-onboarding-ui"
OUT="${ROOT}/deploy/${BUNDLE_NAME}-bundle.tar.gz"

mkdir -p "${STAGE}/${BUNDLE_NAME}/deploy-artifacts"

rsync -a --delete \
  --exclude-from="${ROOT}/deploy/rsync-exclude.txt" \
  --exclude 'venv/' \
  "${ROOT}/backend/" "${STAGE}/${BUNDLE_NAME}/backend/"

rsync -a --delete "${ROOT}/dist/" "${STAGE}/${BUNDLE_NAME}/dist/"

cp "${ROOT}/deploy/nginx-nmt-site.conf" \
  "${ROOT}/deploy/nmt-backend.service" \
  "${ROOT}/deploy/env.backend.example" \
  "${STAGE}/${BUNDLE_NAME}/deploy-artifacts/"

cp "${ROOT}/deploy/remote-install.sh" "${STAGE}/${BUNDLE_NAME}/"
chmod +x "${STAGE}/${BUNDLE_NAME}/remote-install.sh"

cp "${ROOT}/deploy/vm-verify.sh" "${STAGE}/${BUNDLE_NAME}/deploy-artifacts/"
cp "${ROOT}/deploy/vm-fix-db-auth.sh" "${STAGE}/${BUNDLE_NAME}/deploy-artifacts/"
chmod +x "${STAGE}/${BUNDLE_NAME}/deploy-artifacts/vm-verify.sh" \
  "${STAGE}/${BUNDLE_NAME}/deploy-artifacts/vm-fix-db-auth.sh"

# Avoid macOS extended attributes in the tarball (stops Linux tar "LIBARCHIVE.xattr" warnings)
export COPYFILE_DISABLE=1
tar -C "${STAGE}" -czf "${OUT}" "${BUNDLE_NAME}"
rm -rf "${STAGE}"

echo ""
echo "Created: ${OUT}"
ls -lh "${OUT}"
echo ""
echo "Copy to VM (from your Mac):"
echo "  scp \"${OUT}\" root@10.117.66.44:/tmp/"
echo "Then on the VM:"
echo "  mkdir -p /opt/nmt && tar xzf /tmp/prism-onboarding-ui-bundle.tar.gz -C /opt/nmt"
echo "  cd /opt/nmt/prism-onboarding-ui && VM_PUBLIC_HOST=10.117.66.44 ./remote-install.sh"
