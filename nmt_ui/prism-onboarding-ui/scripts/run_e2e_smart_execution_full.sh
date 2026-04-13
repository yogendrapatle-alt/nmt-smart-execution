#!/usr/bin/env bash
# End-to-end: start bounded Smart Execution on the testbed (or validate EXECUTION_ID),
# save report artifacts under test-results/, then verify the report page in Playwright.
#
# Requires: Flask on :5000, Vite on :3000 (proxy /api).
#
#   cd nmt_ui/prism-onboarding-ui
#   bash scripts/run_e2e_smart_execution_full.sh
#
# Environment (optional):
#   API_BASE, TESTBED_PC_IP, TESTBED_UNIQUE_ID, CPU_THRESHOLD, MEMORY_THRESHOLD,
#   MAX_DURATION_MINUTES, LIVE_RUN (default 1 here), EXECUTION_ID (skip start if set),
#   SMOKE_API_BASE (Playwright API checks; default http://127.0.0.1:5000)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export E2E_SAVE_ARTIFACTS="${E2E_SAVE_ARTIFACTS:-1}"
export LIVE_RUN="${LIVE_RUN:-1}"
export API_BASE="${API_BASE:-http://127.0.0.1:5000}"
export SMOKE_API_BASE="${SMOKE_API_BASE:-$API_BASE}"

echo "=== Smart Execution API integration + artifact save ==="
python3 scripts/integration_real_testbed_smart_execution.py

echo "=== Playwright: report page verification ==="
npx playwright install chromium 2>/dev/null || true
npx playwright test tests/e2e/smart-execution-report-verify.spec.ts --config=playwright.config.3000.ts

echo "=== run_e2e_smart_execution_full.sh done ==="
