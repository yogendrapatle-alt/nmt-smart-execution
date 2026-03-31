#!/usr/bin/env bash
# Run ON THE VM as root. Extracts the bundle to /opt/nmt, runs install + verify.
#
# First time you only have the tarball in /tmp — extract once to get this script, OR
# run the two-line bootstrap in deploy/CLEAN-DEPLOY.md.
#
# Usage (after bundle is at /tmp/prism-onboarding-ui-bundle.tar.gz):
#   export VM_PUBLIC_HOST=10.117.66.44
#   bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh
#   bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh /tmp/other-name.tar.gz
#
# Optional: CLEAN_OLD=1 rm -rf /opt/nmt/prism-onboarding-ui before extract.

set -euo pipefail
[[ "${EUID:-0}" -eq 0 ]] || { echo "Run as root"; exit 1; }

TAR="${1:-/tmp/prism-onboarding-ui-bundle.tar.gz}"
VM_PUBLIC_HOST="${VM_PUBLIC_HOST:?export VM_PUBLIC_HOST to the IP users open in the browser (e.g. export VM_PUBLIC_HOST=10.117.66.44)}"

if [[ ! -f "$TAR" ]]; then
  echo "ERROR: tarball not found: $TAR"
  exit 1
fi

if [[ "${CLEAN_OLD:-0}" == "1" ]]; then
  echo "==> CLEAN_OLD=1: removing /opt/nmt/prism-onboarding-ui"
  rm -rf /opt/nmt/prism-onboarding-ui
fi

mkdir -p /opt/nmt
echo "==> Extracting $(basename "$TAR") -> /opt/nmt"
tar xzf "$TAR" -C /opt/nmt

cd /opt/nmt/prism-onboarding-ui
chmod +x remote-install.sh
chmod +x deploy-artifacts/vm-verify.sh deploy-artifacts/vm-fix-db-auth.sh 2>/dev/null || true
chmod +x vm-clean-deploy.sh 2>/dev/null || true

echo "==> remote-install.sh"
VM_PUBLIC_HOST="$VM_PUBLIC_HOST" ./remote-install.sh

echo "==> vm-verify.sh"
VM_PUBLIC_HOST="$VM_PUBLIC_HOST" ./deploy-artifacts/vm-verify.sh

echo ""
echo "Done. Open: http://${VM_PUBLIC_HOST}/"
