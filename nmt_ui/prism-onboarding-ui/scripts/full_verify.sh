#!/usr/bin/env bash
# Full local verification: Python unit tests, API smoke, frontend build, Playwright (real-testbed smoke).
# Requires: backend on :5000, Vite on :3000, TESTBED_PC_IP optional (default 10.53.60.176).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export TESTBED_PC_IP="${TESTBED_PC_IP:-10.53.60.176}"
export SMOKE_API_BASE="${SMOKE_API_BASE:-http://127.0.0.1:5000}"

echo "=== Backend unit tests (services + controllers) ==="
cd "$ROOT/backend"
PYTHONPATH=. python3 -m unittest services.test_prometheus_url -v
PYTHONPATH=. python3 -m unittest discover -s controllers -p 'test_*.py' -q
PYTHONPATH=. python3 -m unittest discover -s services -p 'test_smart_execution_ai.py' -q

echo "=== API smoke ==="
cd "$ROOT"
python3 scripts/smoke_api.py
echo "=== API smoke (enhanced report; may be slow) ==="
SMOKE_INCLUDE_ENHANCED=1 python3 scripts/smoke_api.py

echo "=== Frontend build ==="
npm run build

echo "=== Playwright (install chromium if needed) ==="
npx playwright install chromium 2>/dev/null || true
TESTBED_PC_IP="${TESTBED_PC_IP:-10.53.60.176}" npx playwright test tests/e2e/real-testbed-smoke.spec.ts --config=playwright.config.3000.ts

echo "=== full_verify.sh done ==="
