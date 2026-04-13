#!/usr/bin/env python3
"""
Smoke-test the NMT Prism backend HTTP API (read-only GETs).
Usage:
  export SMOKE_API_BASE=http://127.0.0.1:5000
  python3 scripts/smoke_api.py

Exit 0 if all checks pass, 1 otherwise.
"""
from __future__ import annotations

import json
import os
import sys
from typing import List, Tuple

try:
    import requests
except ImportError:
    print('requests required: pip install requests', file=sys.stderr)
    sys.exit(1)

BASE = os.environ.get('SMOKE_API_BASE', 'http://127.0.0.1:5000').rstrip('/')
DEFAULT_TIMEOUT = float(os.environ.get('SMOKE_TIMEOUT', '20'))
INCLUDE_ENHANCED = os.environ.get('SMOKE_INCLUDE_ENHANCED', '').lower() in ('1', 'true', 'yes')


def check(method: str, path: str, ok_status: Tuple[int, ...] = (200,), timeout: float = DEFAULT_TIMEOUT) -> Tuple[bool, str]:
    url = f'{BASE}{path}'
    try:
        r = requests.request(method, url, timeout=timeout)
        if r.status_code not in ok_status:
            return False, f'{path} -> {r.status_code} (want {ok_status})'
        return True, f'{path} -> {r.status_code}'
    except Exception as e:
        return False, f'{path} -> {e}'


def main() -> int:
    checks: List[Tuple[str, str]] = [
        ('GET', '/api/health'),
        ('GET', '/api/db-pool-status'),
        ('GET', '/api/get-testbeds'),
        ('GET', '/api/prometheus-port'),
        ('GET', '/api/smart-execution/history'),
        ('GET', '/api/alerts'),
    ]
    failed = []
    for method, path in checks:
        ok, msg = check(method, path)
        print(msg)
        if not ok:
            failed.append(msg)

    # Optional: first testbed by UUID if present
    try:
        r = requests.get(f'{BASE}/api/get-testbeds', timeout=30)
        if r.status_code == 200:
            data = r.json()
            tbs = data.get('testbeds') or []
            if tbs:
                u = tbs[0].get('uuid') or ''
                ut = tbs[0].get('unique_testbed_id') or ''
                if u:
                    ok, msg = check('GET', f'/api/get-testbed/{u}')
                    print(msg)
                    if not ok:
                        failed.append(msg)
                if ut:
                    ok, msg = check('GET', f'/api/get-testbed/{ut}')
                    print(f'get-testbed by unique_testbed_id: {msg}')
                    if not ok:
                        failed.append(msg)
    except Exception as e:
        print(f'optional testbed checks skipped: {e}')

    # Enhanced JSON can take a long time (Prometheus + cluster health). Opt-in only.
    if INCLUDE_ENHANCED:
        try:
            h = requests.get(f'{BASE}/api/smart-execution/history', timeout=DEFAULT_TIMEOUT)
            if h.status_code == 200:
                ex = (h.json().get('executions') or [])
                if ex:
                    eid = ex[0].get('execution_id')
                    if eid:
                        path = f'/api/smart-execution/report/{eid}/enhanced?format=json'
                        ok, msg = check('GET', path, timeout=max(DEFAULT_TIMEOUT, 90.0))
                        print(msg)
                        if not ok:
                            failed.append(msg)
        except Exception as e:
            print(f'optional enhanced report check skipped: {e}')
    else:
        print('(skip /enhanced?format=json — set SMOKE_INCLUDE_ENHANCED=1 to include)')

    if failed:
        print('\nFAILED:', file=sys.stderr)
        for f in failed:
            print(' ', f, file=sys.stderr)
        return 1
    print('\nAll smoke checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
