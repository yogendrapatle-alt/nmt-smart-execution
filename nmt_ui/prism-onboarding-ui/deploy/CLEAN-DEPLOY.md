# Clean deploy: upload → use by IP

## On your laptop

```bash
cd prism-onboarding-ui
./deploy/package-for-vm.sh
scp deploy/prism-onboarding-ui-bundle.tar.gz root@YOUR_VM_IP:/tmp/
```

## On the VM (SSH as root) — **two lines**

Replace `YOUR_VM_IP` with the same address users will type in the browser.

```bash
export VM_PUBLIC_HOST=YOUR_VM_IP
mkdir -p /opt/nmt && tar xzf /tmp/prism-onboarding-ui-bundle.tar.gz -C /opt/nmt && bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh
```

That extracts the app, runs **`remote-install.sh`** (PostgreSQL, nginx, backend), then **`vm-verify.sh`**.

Open **`http://YOUR_VM_IP/`** in a browser.

## Updates later

Upload a **new** tarball to `/tmp`, then run the same **`vm-clean-deploy.sh`** line (it re-extracts and re-runs install).

```bash
export VM_PUBLIC_HOST=YOUR_VM_IP
bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh /tmp/prism-onboarding-ui-bundle.tar.gz
```

## Optional: remove old app files before extract

```bash
export VM_PUBLIC_HOST=YOUR_VM_IP
CLEAN_OLD=1 bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh /tmp/prism-onboarding-ui-bundle.tar.gz
```

## Troubleshooting

- `journalctl -u nmt-backend -n 50 --no-pager`
- `deploy/README.md` — Rocky/RHEL notes
- DB: `deploy-artifacts/vm-fix-db-auth.sh` (as root)
