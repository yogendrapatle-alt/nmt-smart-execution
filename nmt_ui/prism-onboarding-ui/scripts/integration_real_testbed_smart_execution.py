#!/usr/bin/env python3
"""
Integration checks for Smart Execution + enhanced report on a real testbed.

Default: validates latest (or given) execution report structure + pre-check at 80%/80%.
Optional live run: starts a bounded execution (short max duration), polls, validates reports.

Environment:
  API_BASE              http://127.0.0.1:5000
  TESTBED_UNIQUE_ID     onboarding unique_testbed_id (e.g. 3aa79d59-...)
  TESTBED_PC_IP         10.53.60.176 (used to pick testbed from /api/get-testbeds if UNIQUE_ID unset)
  CPU_THRESHOLD         80
  MEMORY_THRESHOLD      80
  LIVE_RUN              0|1   (default 0 = no new execution)
  MAX_DURATION_MINUTES  cap for live run (default 4)
  POLL_SEC              status poll interval (default 8)
  EXECUTION_ID          if set, skip live run and only validate this execution's reports
  E2E_SAVE_ARTIFACTS    1 = write e2e-artifacts/e2e-execution-meta.json, HTML + JSON snapshots

Usage:
  python3 scripts/integration_real_testbed_smart_execution.py
  LIVE_RUN=1 python3 scripts/integration_real_testbed_smart_execution.py
  E2E_SAVE_ARTIFACTS=1 LIVE_RUN=1 python3 scripts/integration_real_testbed_smart_execution.py
  npm run test:e2e:smart-execution-full   # integration + Playwright report UI checks
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

try:
    import requests
except ImportError:
    print('pip install requests', file=sys.stderr)
    sys.exit(1)

API = os.environ.get('API_BASE', 'http://127.0.0.1:5000').rstrip('/')
PC_IP = os.environ.get('TESTBED_PC_IP', '10.53.60.176')
UID = os.environ.get('TESTBED_UNIQUE_ID', '').strip()
CPU_T = float(os.environ.get('CPU_THRESHOLD', '80'))
MEM_T = float(os.environ.get('MEMORY_THRESHOLD', '80'))
LIVE = os.environ.get('LIVE_RUN', '0').lower() in ('1', 'true', 'yes')
MAX_DUR = float(os.environ.get('MAX_DURATION_MINUTES', '4'))
POLL = float(os.environ.get('POLL_SEC', '8'))
FIXED_EID = os.environ.get('EXECUTION_ID', '').strip()

# Minimum keys expected in enhanced_report JSON (contract)
ENHANCED_KEYS: Set[str] = {
    'verdict',
    'spike_analysis',
    'cluster_health',
    'failure_analysis',
    'operation_heatmap',
    'pod_stability',
    'historical_comparison',
    'capacity_planning',
    'ml_report_insights',
    'latency_report',
    'learning_summary',
    'iteration_timeline',
    'entity_operation_counts',
    'effective_metrics',
    'report_metadata',
}


def get(path: str, timeout: float = 120.0) -> requests.Response:
    return requests.get(f'{API}{path}', timeout=timeout)


def post(path: str, body: Dict[str, Any], timeout: float = 120.0) -> requests.Response:
    return requests.post(
        f'{API}{path}',
        json=body,
        headers={'Content-Type': 'application/json'},
        timeout=timeout,
    )


def resolve_testbed_id() -> str:
    global UID
    if UID:
        return UID
    r = get('/api/get-testbeds')
    r.raise_for_status()
    data = r.json()
    tbs = data.get('testbeds') or []
    for t in tbs:
        if str(t.get('pc_ip', '')) == PC_IP:
            UID = str(t.get('unique_testbed_id', ''))
            return UID
    raise RuntimeError(f'No testbed with pc_ip={PC_IP} in /api/get-testbeds')


def validate_enhanced_payload(er: Dict[str, Any], execution_id: str) -> List[str]:
    errs: List[str] = []
    missing = ENHANCED_KEYS - set(er.keys())
    if missing:
        errs.append(f'{execution_id}: enhanced_report missing keys: {sorted(missing)}')
    vm = er.get('verdict') or {}
    if not isinstance(vm, dict) or not vm.get('result'):
        errs.append(f'{execution_id}: verdict.result missing')
    meta = er.get('report_metadata') or {}
    if not isinstance(meta, dict) or 'metrics_samples' not in meta:
        errs.append(f'{execution_id}: report_metadata incomplete')
    eff = er.get('effective_metrics') or {}
    if 'baseline' not in eff or 'final' not in eff:
        errs.append(f'{execution_id}: effective_metrics missing baseline/final')
    return errs


def fetch_enhanced(execution_id: str) -> Dict[str, Any]:
    r = get(f'/api/smart-execution/report/{execution_id}/enhanced?format=json', timeout=180.0)
    r.raise_for_status()
    return r.json()


def fetch_basic_report(execution_id: str) -> Dict[str, Any]:
    r = get(f'/api/smart-execution/report/{execution_id}', timeout=120.0)
    r.raise_for_status()
    return r.json()


def save_e2e_artifacts(execution_id: str, enhanced_raw: Dict[str, Any], basic_report: Dict[str, Any]) -> None:
    """Write HTML download, enhanced JSON, and meta for Playwright / manual UI verification."""
    root = Path(__file__).resolve().parent.parent
    # Use e2e-artifacts/ (not test-results/) — Playwright clears test-results on run.
    out = root / 'e2e-artifacts'
    out.mkdir(parents=True, exist_ok=True)
    safe = execution_id.replace('/', '_')
    html_path = out / f'e2e-smart-execution-{safe}.html'
    json_path = out / f'e2e-enhanced-report-{safe}.json'

    rh = get(f'/api/smart-execution/report/{execution_id}/enhanced', timeout=180.0)
    rh.raise_for_status()
    html_path.write_bytes(rh.content)

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(enhanced_raw, f, indent=2)

    er = enhanced_raw.get('enhanced_report') or enhanced_raw
    verdict = (er.get('verdict') or {}) if isinstance(er, dict) else {}
    meta: Dict[str, Any] = {
        'execution_id': execution_id,
        'api_base': API,
        'ui_report_path': f'/smart-execution/report/{execution_id}',
        'artifacts': {
            'html_relative': str(html_path.relative_to(root)),
            'enhanced_json_relative': str(json_path.relative_to(root)),
        },
        'verdict_result': verdict.get('result') if isinstance(verdict, dict) else None,
        'basic_report_snapshot': {
            'total_operations': basic_report.get('total_operations'),
            'status': basic_report.get('status'),
            'success_rate': basic_report.get('success_rate'),
            'duration_minutes': basic_report.get('duration_minutes'),
        },
    }
    meta_path = out / 'e2e-execution-meta.json'
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
    print('E2E artifacts written:', meta_path)
    print('  HTML:', html_path)
    print('  JSON:', json_path)


def main() -> int:
    print('API:', API)
    print('Thresholds:', CPU_T, '/', MEM_T, '%')

    tid = resolve_testbed_id()
    print('Testbed unique_testbed_id:', tid)

    # Pre-check (no execution start)
    print('\n--- Pre-check ---')
    pc_body = {
        'testbed_id': tid,
        'target_config': {
            'cpu_threshold': CPU_T,
            'memory_threshold': MEM_T,
            'stop_condition': 'any',
        },
        'entities_config': {'vm': {'create': 2, 'delete': 1}},
    }
    pr = post('/api/smart-execution/pre-check', pc_body)
    print('pre-check HTTP', pr.status_code)
    if pr.status_code != 200:
        print(pr.text[:800])
        return 1
    pcj = pr.json()
    if not pcj.get('success'):
        print('pre-check failed:', pcj)
        return 1
    print('pre-check checks:', json.dumps(pcj.get('checks'), indent=2)[:2000])

    execution_id: Optional[str] = FIXED_EID or None

    if LIVE and not FIXED_EID:
        print('\n--- LIVE_RUN: starting bounded Smart Execution ---')
        start_body = {
            'testbed_id': tid,
            'target_config': {
                'cpu_threshold': CPU_T,
                'memory_threshold': MEM_T,
                'stop_condition': 'any',
                'max_duration_minutes': MAX_DUR,
                'advanced': {
                    'operations_per_iteration': 2,
                    'iteration_delay_seconds': 5,
                    'max_parallel_operations': 2,
                },
            },
            'entities_config': {'vm': {'create': 2, 'delete': 1}},
        }
        sr = post('/api/smart-execution/start', start_body, timeout=60.0)
        print('start HTTP', sr.status_code, sr.text[:500])
        if sr.status_code != 200:
            return 1
        sj = sr.json()
        if not sj.get('success'):
            print('start failed:', sj)
            return 1
        execution_id = sj.get('execution_id')
        print('execution_id:', execution_id)

        deadline = time.time() + max(120.0, MAX_DUR * 60 + 60)
        last = ''
        while time.time() < deadline:
            st = get(f'/api/smart-execution/status/{execution_id}', timeout=30.0)
            if st.status_code == 200:
                sj = st.json()
                status = sj.get('status', '')
                if status != last:
                    print('status:', status)
                    last = status
                if status in ('COMPLETED', 'STOPPED', 'FAILED', 'TIMEOUT', 'THRESHOLD_REACHED'):
                    break
            time.sleep(POLL)
        else:
            print('Timeout waiting for terminal status; stopping execution...')
            requests.post(f'{API}/api/smart-execution/stop/{execution_id}', timeout=60)

    if not execution_id:
        print('\n--- No EXECUTION_ID / LIVE_RUN: using latest from history ---')
        hr = get('/api/smart-execution/history')
        hr.raise_for_status()
        ex = (hr.json().get('executions') or [])
        if not ex:
            print('No executions in history; set LIVE_RUN=1 or EXECUTION_ID=<id>')
            return 1
        execution_id = ex[0].get('execution_id')
        print('Using execution_id:', execution_id)

    assert execution_id

    print('\n--- Basic report ---')
    br = fetch_basic_report(execution_id)
    need = ('execution_id', 'metrics_history', 'operations_history', 'target_config')
    for k in need:
        if k not in br:
            print(f'WARNING: basic report missing {k}')
    tc = br.get('target_config') or {}
    print('target_config in report:', json.dumps(tc)[:300])

    print('\n--- Enhanced report (JSON) ---')
    raw = fetch_enhanced(execution_id)
    er = raw.get('enhanced_report') or raw
    errs = validate_enhanced_payload(er, execution_id)
    if errs:
        for e in errs:
            print('ERROR:', e)
        return 1
    print('enhanced_report keys OK:', sorted(er.keys()))
    print('verdict:', er.get('verdict', {}).get('result'), '-', (er.get('verdict') or {}).get('summary', '')[:120])
    rm = er.get('report_metadata') or {}
    print('report_metadata:', json.dumps(rm, indent=2)[:1200])
    ch = er.get('cluster_health') or {}
    print('cluster_health.collection_status:', ch.get('collection_status'), ch.get('collection_reason', '')[:80])

    if os.environ.get('E2E_SAVE_ARTIFACTS', '').lower() in ('1', 'true', 'yes'):
        save_e2e_artifacts(execution_id, raw, br)

    print('\n=== Integration check PASSED ===')
    print('Validated execution:', execution_id)
    return 0


if __name__ == '__main__':
    sys.exit(main())
