# NMT — NCM Monitoring & Smart Execution Tool

Production-grade tool for monitoring **Nutanix Cloud Manager (NCM)** stacks and running adaptive AI-driven workloads against them to surface scaling, sizing and reliability bugs.

React + TypeScript frontend, Flask backend, PostgreSQL persistence, Prometheus metrics, optional Slack alerting.

---

## What it does

| Capability | Page | Purpose |
|---|---|---|
| **Onboard testbeds** | `/onboarding` | Register a PC + cluster + Prometheus URL with credentials |
| **Smart Execution (AI)** | `/smart-execution` | Run an adaptive load loop that obeys CPU/Mem thresholds, uses a PID-style controller, and only fires the operations the user picked |
| **Monitor-Only mode** | `/monitor-only` | Same monitoring + alerting pipeline without driving any workload (pure observability) |
| **Monitoring Rules** | inside Smart Execution / Monitor-Only | Composable per-pod / per-node / per-cluster Prometheus rules with AND/OR conditions, custom PromQL, and built-in templates |
| **Alerts page** | `/alert-summary` | Every rule firing persisted with timestamps, values, severity, scope (pod / namespace / node / cluster), filter + paginate |
| **Enhanced Reports** | `/smart-execution-report/<id>` and `/monitor-report/<id>` | Per-execution HTML/JSON report with operation breakdown, entity performance, spike analysis, cluster-health, restart timeline, OOM/throttle inventory |
| **Status / Diagnostics** | `/status` | Live Prometheus reachability, NCM client state, scheduler state |
| **Slack notifications** | optional | Per-rule control: silence / first-fire / re-arm; rule-level summary messages instead of per-pod spam |

---

## Architecture

```
┌────────────────────┐      HTTPS       ┌─────────────────────┐
│  React UI (Vite)   │ ───────────────▶ │  Flask backend      │
│  src/, components/ │                  │  backend/app.py     │
└────────────────────┘                  │                     │
                                        │  ┌───────────────┐  │
                                        │  │ Smart Exec AI │  │  PID-style adaptive
                                        │  │  engine + ctl │  │  load controller
                                        │  └───────────────┘  │
                                        │  ┌───────────────┐  │
                                        │  │ Monitoring    │  │  per-series rule
                                        │  │ rule engine   │  │  evaluator + cooldowns
                                        │  └───────────────┘  │
                                        │  ┌───────────────┐  │
                                        │  │ Enhanced      │  │  builds report JSON
                                        │  │ report svc    │  │  + Jinja2 HTML
                                        │  └───────────────┘  │
                                        └────┬────────────────┘
                                             │ psycopg2 / SQLAlchemy
                                             ▼
                                        ┌─────────────────────┐
                                        │ PostgreSQL          │
                                        │  testbeds           │
                                        │  smart_executions   │
                                        │  monitor_sessions   │
                                        │  alert_summaries    │
                                        │  operation_metrics  │
                                        └─────────────────────┘
                                             ▲
                                             │ HTTPS
                                        ┌─────────────────────┐
                                        │ Prometheus (NCM PC) │
                                        └─────────────────────┘
```

---

## Quick Start (local dev)

### Prereqs

- Python 3.10+
- Node 18+
- PostgreSQL 14+ (local or remote)
- A reachable Prometheus endpoint (NCM PC) for live testing — synthetic mode falls back when absent

### Backend

```bash
cd backend
pip install -r requirements.txt              # if present, otherwise:
pip install flask flask-cors flask-sqlalchemy psycopg2-binary requests paramiko \
            apscheduler PyYAML jinja2

# Configure DB + secrets via .env (see .env.example)
cp ../.env.example ../.env
# Edit ../.env with DATABASE_URL, SLACK_WEBHOOK_URL (optional), etc.

python app.py
# → http://localhost:5000
```

### Frontend

```bash
npm install
npm run dev
# → http://localhost:5173
```

### .env essentials

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/nmt
VITE_BACKEND_URL=http://localhost:5000
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...   # optional
NMT_FAKE_MODE=false                                       # true → demo data
```

See `.env.example` for the full set.

---

## Deploying to a VM

See **`deploy/CLEAN-DEPLOY.md`** for the one-path bundle-and-install flow:

```bash
./deploy/package-for-vm.sh
scp deploy/prism-onboarding-ui-bundle.tar.gz root@<VM_IP>:/tmp/
ssh root@<VM_IP>
mkdir -p /opt/nmt && tar xzf /tmp/prism-onboarding-ui-bundle.tar.gz -C /opt/nmt
bash /opt/nmt/prism-onboarding-ui/vm-clean-deploy.sh
```

Then open **http://<VM_IP>/**.

---

## Smart Execution AI — how it works

1. **User picks**: testbed, target CPU% / Mem% (e.g., 80 / 80), entity-operation whitelist (e.g., only `LIST` for `VirtualMachine`, `User`, …), max parallel ops, runtime cap, monitoring rules.
2. **Controller** captures baseline pod-restart counts and starts the adaptive loop.
3. Each iteration:
   - Probe CPU/Mem from Prometheus.
   - PID controller decides: ramp up / hold / back off.
   - Engine picks the next operation **only from the user-selected whitelist** and dispatches it via the NCM REST client.
   - Result + metrics persisted to `operation_metrics`.
   - Monitoring rules evaluated per-series; violations persisted to `alert_summaries` and (optionally) sent to Slack as **one rule-level summary message per evaluation** (deduplicated by `(namespace, pod_or_node)`).
4. Loop ends when: hard runtime cap reached, user clicks Stop, or sustained-target window completes.
5. Enhanced report aggregates everything for the run.

### Adaptive control phases

```
RAMP_UP → SUSTAIN → BACK_OFF → SUSTAIN → … → COMPLETE
            ▲           │
            └───────────┘
```

The **SUSTAIN** phase keeps load near target until the configured "sustain duration" elapses, then ramps further or terminates per config.

---

## Monitoring rules

Built-in templates: pod CPU > X%, pod Memory > X%, container restarts > N, OOMKilled, CPU throttling > X%, custom PromQL.

Each rule supports:

- **Scope**: cluster / namespace / pod / node
- **Conditions**: AND / OR composition, multiple metrics per rule
- **Per-rule Slack control**:
  - `silenceSlack` → never sends Slack (still persists to alerts page)
  - default → one summary message per evaluation
- **Cooldowns**: per-series 5-minute throttle to prevent re-fire spam
- **Restart counters get baseline-subtracted** so only NEW restarts since execution start trigger alerts (no more "the pod has 4 restarts since last week" spam).

---

## Recent fixes & improvements

The 4-file backend change in this revision delivers:

### `routes/smart_execution_ai_routes.py`

- AI controller now inherits the AI engine's `execution_id` so all rows it writes (`operation_metrics`, `alert_summaries`, …) are filterable by the same `AI-EXEC-*` ID surfaced in the UI.
- Pod-restart baseline is captured before the loop starts.
- Monitoring rules are evaluated every iteration (was missing from the AI path — only the legacy non-AI path ran them).

### `services/smart_execution_service.py` (~430 lines added)

- New `_eval_rule_per_series()` evaluator: fires per-pod / per-node violations (legacy code only fired on the *first* series Prometheus returned, which was usually a healthy pod, so rules silently never fired).
- Per-series cooldown + per-evaluation cap to prevent fan-out floods.
- **Slack rollup**: one summary message per rule per evaluation, deduplicated `(ns, pod_or_node)` so a pod with N containers doesn't appear N times.
- **Cumulative-counter awareness**: restart counters are baseline-subtracted; rules only fire on NEW restarts during the run.
- New `_query_prometheus(aggregator='max'|'min'|'first')` so `>` / `<` rules look at the worst / best series instead of an arbitrary one.
- `silenceSlack` / `silence_slack` / `notify_slack=false` rule-level controls honoured.

### `services/enhanced_report_service.py`

- New `_op_succeeded()` helper + `SUCCESS_STATES = {'SUCCESS', 'COMPLETED', 'OK'}`.
- 5 call sites updated to recognise both engine (`SUCCESS`) and DB (`COMPLETED`) terminal-success states. Fixes the 0% pass-rate that DB-loaded reports used to show.

### `app.py` enhanced-report endpoint

- For active AI executions, the status dict now passes through `successful_operations`, `failed_operations`, `success_rate`, `duration_minutes`, `start_time`, `end_time`, `iterations`, `baseline_metrics`, `final_metrics`, `testbed_info` from the engine summary (was dropping all of them, causing "0% success / 0.1m duration" for live runs).
- Duration falls back to `now - start_time` when not stored, instead of the cosmetic `0.1` placeholder that made 72-h runs look 6 seconds long.
- Success/fail counts are recomputed from `operations_history` when summary values are missing.
- Success rate uses the **attempted** denominator (success + fail) so SKIPPED ops don't drag it down.

---

## Project structure

```
nmt_ui/prism-onboarding-ui/
├── backend/
│   ├── app.py                       # Flask entrypoint, all routes
│   ├── routes/
│   │   ├── smart_execution_ai_routes.py
│   │   ├── qa_routes.py
│   │   └── …
│   ├── services/
│   │   ├── smart_execution_service.py     # controller + rule evaluator
│   │   ├── smart_execution_engine_ai.py   # PID-style AI brain
│   │   ├── enhanced_report_service.py     # report JSON builder
│   │   ├── scheduler_service.py
│   │   └── …
│   ├── models/                      # SQLAlchemy models
│   ├── templates/
│   │   └── enhanced_report.html     # Jinja2 report template
│   └── configs/                     # generated rule configs
├── src/                             # React frontend
│   ├── pages/
│   │   ├── SmartExecutionConfigureAI.tsx
│   │   ├── SmartExecutionMonitorAI.tsx
│   │   ├── SmartExecutionReport.tsx
│   │   ├── AlertConfiguration.tsx
│   │   ├── DashboardHome.tsx
│   │   └── …
│   ├── components/
│   │   ├── MonitoringRulesEditor/
│   │   ├── PodMultiSelect/
│   │   ├── AlertSummary.tsx
│   │   └── …
│   └── context/
├── deploy/                          # VM bundle + install scripts
└── package.json
```

---

## Key API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/smart-execution/start-ai` | Kick off an adaptive AI run |
| `POST /api/smart-execution/stop/<id>` | Graceful stop |
| `GET  /api/smart-execution/monitor/<id>` | Live status + metrics |
| `GET  /api/smart-execution/report/<id>` | Report JSON |
| `GET  /api/smart-execution/report/<id>/enhanced` | Rendered HTML report |
| `GET  /api/smart-execution/available-pods` | Pod list for rule editor |
| `GET  /api/smart-execution/available-nodes` | Node list for rule editor |
| `POST /api/smart-execution/test-rule-query` | PromQL dry-run from the rule editor |
| `POST /api/monitor-only/start` | Start observation-only session |
| `GET  /api/alerts` | Paginated alert summaries |
| `POST /api/check-prometheus` | Connectivity test |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Report shows 0% success / 0.1 m duration | Pre-fix code on the VM | Pull this revision, restart `nmt-backend.service` |
| Slack flooded with restart alerts | Pre-fix code without baseline subtraction | Pull this revision; existing rules keep their behaviour, restarts now alert only on deltas |
| Monitoring rule never fires even when Prometheus shows a violation | Pre-fix `_query_prometheus` only checked `results[0]` | Pull this revision; rules now per-series with `aggregator='max'` |
| `Loading diagnostics…` stuck on Alert Summary | Frontend retry storm — usually network blip | Refresh; if persistent check `/api/alerts` directly |
| Monitor-only report missing | New mode — earlier deploys lacked the dedicated route | Pull this revision |

---

## License & ownership

Internal NCM tooling. Not for external distribution.
