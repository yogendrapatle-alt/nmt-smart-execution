# Deploying to a Linux VM

## Fast path (password SSH — no keys required)

From your **laptop** (in `prism-onboarding-ui/`):

```bash
./deploy/package-for-vm.sh
```

This creates **`deploy/prism-onboarding-ui-bundle.tar.gz`** (~15 MB). Copy it to the VM (enter the root password when prompted):

```bash
scp deploy/prism-onboarding-ui-bundle.tar.gz root@10.117.66.44:/tmp/
ssh root@10.117.66.44
```

On the **VM**:

```bash
mkdir -p /opt/nmt && tar xzf /tmp/prism-onboarding-ui-bundle.tar.gz -C /opt/nmt
cd /opt/nmt/prism-onboarding-ui
VM_PUBLIC_HOST=10.117.66.44 ./remote-install.sh
```

Then open **http://10.117.66.44/** in a browser.

**RHEL / CentOS / Fedora:** `remote-install.sh` uses `dnf` or `yum` (not `apt`). If you already extracted an old bundle, copy only the updated script and re-run:

`scp deploy/remote-install.sh root@10.117.66.44:/opt/nmt/prism-onboarding-ui/` then `VM_PUBLIC_HOST=10.117.66.44 ./remote-install.sh`

**macOS tar warnings** (`LIBARCHIVE.xattr...`) on the server are harmless; rebundling with `./deploy/package-for-vm.sh` reduces them (`COPYFILE_DISABLE=1`).

**Rocky/RHEL `Ident authentication failed for user "alertuser"`:** default `pg_hba.conf` matches `ident` before password auth. The current `remote-install.sh` prepends `md5` rules for `127.0.0.1` / `::1` and rewrites `DATABASE_URL` to use `127.0.0.1` instead of `localhost`. After editing `pg_hba.conf`, ownership must stay **`postgres:postgres`** (otherwise reload fails and `ident` rules stick). `remote-install.sh` sets `chown`/`chmod` on `pg_hba.conf` automatically.

**“Welcome to nginx on Rocky Linux” instead of the app:** the stock `server { ... default_server; root /usr/share/nginx/html; }` in **`/etc/nginx/nginx.conf`** wins over `conf.d/nmt.conf`. Current `remote-install.sh` strips `default_server` from that block and installs **`nmt.conf` with `listen 80 default_server`** so the SPA is served. Re-run the installer from an updated bundle, or comment out that `server` block by hand.

**Verify on the VM (after install):**

```bash
chmod +x /opt/nmt/prism-onboarding-ui/deploy-artifacts/vm-verify.sh
VM_PUBLIC_HOST=10.117.66.44 /opt/nmt/prism-onboarding-ui/deploy-artifacts/vm-verify.sh
```

---

This app is designed for **same-origin** access in production: **nginx** serves the built SPA and proxies **`/api`** and **`/socket.io`** to Flask on **127.0.0.1:5000**. The frontend uses relative `/api/...` URLs by default (`getApiBase()` empty).

## What gets uploaded

`deploy/sync-to-vm.sh` runs `npm run build:deploy` locally, then **rsync**:

- `backend/` (Python app; excludes `__pycache__`, logs, etc. via `rsync-exclude.txt`)
- `dist/` (built static assets only — no `src/`)

It does **not** upload `node_modules/`, `.git/`, or local `venv/`.

## One-time server setup

1. Install **nginx**, **Python 3**, **PostgreSQL** (or point `DATABASE_URL` at your DB).
2. Create venv and install backend deps:
   ```bash
   sudo mkdir -p /opt/nmt/prism-onboarding-ui
   sudo python3 -m venv /opt/nmt/venv
   sudo /opt/nmt/venv/bin/pip install -r /opt/nmt/prism-onboarding-ui/backend/requirements.txt
   ```
3. Copy `deploy/env.backend.example` to `/opt/nmt/prism-onboarding-ui/backend/.env` and set **`DATABASE_URL`** and **`CORS_ORIGINS`** (include `http://YOUR_VM_IP` for HTTP on port 80).
4. Install nginx site and systemd unit (paths in `sync-to-vm.sh` output).
5. `sudo systemctl enable --now nmt-backend nginx`

## Run deploy from your laptop

```bash
cd prism-onboarding-ui
export DEPLOY_HOST=10.117.66.44
export DEPLOY_USER=root
./deploy/sync-to-vm.sh
```

Use **SSH keys**; avoid passwords in scripts.

## Local development

- Backend: `cd backend && python3 app.py` (port 5000).
- Frontend: `npm run dev` — requests to `/api` are proxied to the backend (see `vite.config.ts`).
- Optional: set `VITE_API_BASE_URL` in `.env` if you must talk to another origin without a proxy.
