# Clean deploy: upload → use by IP

**Important — two machines**

| Step | Where | Why |
|------|--------|-----|
| Build + `scp` | **Your Mac / laptop** (where the git repo and `npm` live) | `package-for-vm.sh` runs `vite build` and creates the tarball. The VM has no project source. |
| Extract + install | **The Linux VM** (SSH as `root`) | Only here you unpack `/tmp/*.tar.gz` and run `vm-clean-deploy.sh`. |

Do **not** run `package-for-vm.sh` or `scp … deploy/prism-onboarding-ui-bundle.tar.gz` **on the VM** — that path does not exist there and the build tools are not the workflow.

## On your laptop

From the folder that **already contains** `deploy/` (usually `…/nmt_ui/prism-onboarding-ui`). Do **not** `cd prism-onboarding-ui` if you are already inside it.

```bash
./deploy/package-for-vm.sh
scp deploy/prism-onboarding-ui-bundle.tar.gz root@10.117.66.44:/tmp/
```

(Replace `10.117.66.44` with your VM’s IP.)

## On the VM (SSH as root) — **two lines**

Use the same IP as in `scp` (e.g. `10.117.66.44`).

```bash
export VM_PUBLIC_HOST=10.117.66.44
mkdir -p /opt/nmt && tar xzf /tmp/prism-onboarding-ui-bundle.tar.gz -C /opt/nmt && bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh
```

That extracts the app, runs **`remote-install.sh`** (PostgreSQL, nginx, backend), then **`vm-verify.sh`**.

Open **`http://10.117.66.44/`** in a browser (adjust IP).

## Updates later

Upload a **new** tarball to `/tmp`, then run the same **`vm-clean-deploy.sh`** line (it re-extracts and re-runs install).

```bash
export VM_PUBLIC_HOST=10.117.66.44
bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh /tmp/prism-onboarding-ui-bundle.tar.gz
```

## Optional: remove old app files before extract

```bash
export VM_PUBLIC_HOST=10.117.66.44
CLEAN_OLD=1 bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh /tmp/prism-onboarding-ui-bundle.tar.gz
```

## Troubleshooting

- `journalctl -u nmt-backend -n 50 --no-pager`
- `deploy/README.md` — Rocky/RHEL notes
- DB: `deploy-artifacts/vm-fix-db-auth.sh` (as root)
