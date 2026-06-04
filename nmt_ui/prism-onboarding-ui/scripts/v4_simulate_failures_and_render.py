#!/usr/bin/env python3
"""Simulate restarts / OOM kills / CPU throttling on top of a real
``cluster_health_snapshot`` and re-render the v4 Pod Health report.

Why this script exists
======================
The Smart Execution Report v4 was redesigned to put critical/watch pods
front-and-center with a sortable table and per-row expandable detail
(events, container breakdown, sparklines).  When you run a short, gentle
execution against a healthy cluster the table will (correctly) show
"every pod healthy", which makes it hard for a stakeholder to *see* what
the report does in worst-case scenarios.

This script lets you say:

    "Take the real Regression-10.122.27.229 snapshot we just captured,
     pretend three pods OOMKilled and one had heavy CPU throttling,
     and show me what the v4 report would render."

It NEVER touches the testbed.  All it does is:

1. Load the persisted cluster_health_snapshot for an execution from the
   local DB (the same data the live report endpoint consumes).
2. Inject a configurable set of synthetic events into the snapshot:
   - OOMKill rows (``cluster_health['oom_killed']`` + a matching
     ``window_oom_events`` entry so the v4 events column shows it)
   - Restart rows (``container_restarts`` + a ``restart_events`` entry
     in ``pod_restart_tracking`` so the events column shows the timeline)
   - CPU-throttle spikes (``cpu_throttling`` + ``container_cpu`` peak)
3. Run the same ``EnhancedReportService.generate_enhanced_report`` the
   real route runs and writes the output HTML to a file.
4. Optionally writes a JSON sidecar so you can diff the pod_health block.

Usage
=====

    cd nmt_ui/prism-onboarding-ui
    python3 scripts/v4_simulate_failures_and_render.py \
        --execution-id AI-EXEC-20260513-163830-33c91fa9 \
        --out /tmp/v4_simulated.html

Optional flags:
    --oom-pods 3                # how many real pods to OOMKill
    --restart-pods 2            # how many real pods to mark restarting
    --throttle-pods 4           # how many real pods to push to >95% throttle
    --keep-real-events          # keep already-real OOM/restart rows
    --json /tmp/v4_simulated.json
    --prometheus-url URL        # override resolver
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import random
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# Make backend importable when run from the repo root.
HERE = Path(__file__).resolve().parent.parent
BACKEND = HERE / 'backend'
sys.path.insert(0, str(BACKEND))


def _now_iso(offset_min: int = 0) -> str:
    return (datetime.now(tz=timezone.utc) + timedelta(minutes=offset_min)).isoformat()


def _sample(rows: List[Dict], n: int, seed: int) -> List[Dict]:
    if not rows:
        return []
    rng = random.Random(seed)
    return rng.sample(rows, min(n, len(rows)))


def _inject_oom(
    snapshot: Dict,
    pod_restart_tracking: Dict,
    n_pods: int,
    seed: int,
) -> List[str]:
    """Add ``n_pods`` OOMKill rows. Picks pods with the highest memory %."""
    pool = sorted(
        (snapshot.get('pod_memory') or []),
        key=lambda r: -(r.get('memory_pct') or 0),
    )
    chosen = _sample(pool[: max(n_pods * 4, n_pods)], n_pods, seed)
    snapshot.setdefault('oom_killed', [])
    snapshot.setdefault('window_oom_events', [])
    pod_restart_tracking.setdefault('restart_events', [])
    affected = []
    for i, row in enumerate(chosen):
        ns, pod = row.get('namespace'), row.get('pod')
        ts = _now_iso(-(i * 3 + 1))
        # 1) raw oom_killed array (used by classifier "did it OOM" check).
        snapshot['oom_killed'].append({
            'namespace': ns, 'pod': pod,
            'container': row.get('container') or pod.split('-')[0],
        })
        # 2) window_oom_events drives the per-pod events timeline.
        snapshot['window_oom_events'].append({
            'namespace': ns, 'pod': pod,
            'container': row.get('container') or pod.split('-')[0],
            'timestamp': ts,
            'count': 1,
        })
        # 3) Live pod-restart-tracking event with the rich detail the
        #    v4 expand row shows (memory, exit code, log snippet).
        pod_restart_tracking['restart_events'].append({
            'namespace': ns, 'pod': pod,
            'container': row.get('container') or pod.split('-')[0],
            'restart_reason': 'OOMKilled',
            'exit_code': 137,
            'detected_at': ts,
            'new_restarts': 1,
            'pod_memory_mb': row.get('memory_mb'),
            'pod_memory_limit_mb': row.get('memory_limit_mb'),
            'pod_cpu_cores': None,
            'pod_cpu_limit_cores': None,
            'log_snippet': '[SIMULATED] killed by oom-killer; '
                           'memory cgroup out of memory.',
            'concurrent_operation': 'simulated.oom',
        })
        affected.append(f'{ns}/{pod}')
    return affected


def _inject_restarts(
    snapshot: Dict,
    pod_restart_tracking: Dict,
    n_pods: int,
    seed: int,
) -> List[str]:
    """Add restart events for pods (non-OOM, e.g. CrashLoopBackOff)."""
    pool = (snapshot.get('pod_cpu') or [])
    chosen = _sample(pool, n_pods, seed)
    snapshot.setdefault('container_restarts', [])
    pod_restart_tracking.setdefault('restart_events', [])
    affected = []
    reasons = ['Error', 'CrashLoopBackOff', 'Killed', 'ContainerCannotRun']
    rng = random.Random(seed)
    for i, row in enumerate(chosen):
        ns, pod = row.get('namespace'), row.get('pod')
        ts = _now_iso(-(i * 4 + 2))
        reason = reasons[i % len(reasons)]
        n_restarts = rng.randint(1, 3)
        snapshot['container_restarts'].append({
            'namespace': ns, 'pod': pod,
            'container': pod.split('-')[0],
            'restarts': n_restarts,
            'reason': reason,
            'timestamp': ts,
        })
        pod_restart_tracking['restart_events'].append({
            'namespace': ns, 'pod': pod,
            'container': pod.split('-')[0],
            'restart_reason': reason,
            'exit_code': 1 if reason == 'Error' else (137 if reason == 'Killed' else 2),
            'detected_at': ts,
            'new_restarts': n_restarts,
            'pod_cpu_cores': row.get('cpu_cores'),
            'pod_cpu_limit_cores': row.get('cpu_limit_cores'),
            'log_snippet': f'[SIMULATED] container exited '
                           f'reason={reason}; restarting…',
            'concurrent_operation': 'simulated.restart',
        })
        affected.append(f'{ns}/{pod}')
    return affected


def _inject_throttling(
    snapshot: Dict,
    n_pods: int,
    seed: int,
) -> List[str]:
    """Push a few pods to >95% CPU throttle so the table flags them."""
    pool = (snapshot.get('container_cpu') or snapshot.get('pod_cpu') or [])
    chosen = _sample(pool, n_pods, seed)
    snapshot.setdefault('cpu_throttling', [])
    affected = []
    for i, row in enumerate(chosen):
        ns, pod = row.get('namespace'), row.get('pod')
        ts = _now_iso(-(i * 2 + 1))
        snapshot['cpu_throttling'].append({
            'namespace': ns, 'pod': pod,
            'container': row.get('container') or pod.split('-')[0],
            'throttle_ratio': round(95 + ((i % 4) * 1.1), 1),
            'timestamp': ts,
            'throttle_history': [
                {'timestamp': _now_iso(-30 + (j * 3)),
                 'throttle_pct': round(80 + (j * 2), 1)}
                for j in range(8)
            ],
        })
        affected.append(f'{ns}/{pod}')
    return affected


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--execution-id', required=True,
                    help='execution_id whose persisted cluster_health to use')
    ap.add_argument('--out', default='/tmp/v4_simulated.html',
                    help='Path to write the rendered v4 HTML report')
    ap.add_argument('--json', default=None,
                    help='Optional path to dump the resulting pod_health JSON')
    ap.add_argument('--oom-pods', type=int, default=3)
    ap.add_argument('--restart-pods', type=int, default=2)
    ap.add_argument('--throttle-pods', type=int, default=4)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--keep-real-events', action='store_true',
                    help='Do NOT clear pre-existing OOM/restart rows; merge.')
    ap.add_argument('--prometheus-url', default=None,
                    help='Override the Prometheus URL the renderer uses '
                         '(skip live enrichment if you want pure replay)')
    args = ap.parse_args(argv)

    os.environ.setdefault('POD_COVERAGE_V3', 'true')

    from services.smart_execution_db import load_smart_execution
    from services.enhanced_report_service import EnhancedReportService

    db_data = load_smart_execution(args.execution_id)
    if not db_data:
        print(f'ERROR: execution {args.execution_id} not found in DB',
              file=sys.stderr)
        return 2
    fed = db_data.get('full_execution_data') or {}
    base_snapshot = copy.deepcopy(fed.get('cluster_health_snapshot') or {})
    if not base_snapshot:
        print('ERROR: persisted cluster_health_snapshot is empty; nothing '
              'to simulate against. Run a real execution first.',
              file=sys.stderr)
        return 3

    pod_count_before = len(base_snapshot.get('pod_cpu') or [])
    print(f'• Loaded snapshot from execution {args.execution_id}')
    print(f'• Real pod_cpu rows: {pod_count_before}')
    print(f'• Real oom_killed rows: {len(base_snapshot.get("oom_killed") or [])}')
    print(f'• Real container_restarts rows: {len(base_snapshot.get("container_restarts") or [])}')
    print(f'• Real cpu_throttling rows: {len(base_snapshot.get("cpu_throttling") or [])}')

    pod_restart_tracking = copy.deepcopy(fed.get('pod_restart_tracking') or {})
    if not args.keep_real_events:
        base_snapshot['oom_killed'] = []
        base_snapshot['window_oom_events'] = []
        base_snapshot['container_restarts'] = []
        pod_restart_tracking['restart_events'] = []

    print()
    oom_affected = _inject_oom(
        base_snapshot, pod_restart_tracking,
        args.oom_pods, args.seed,
    )
    restart_affected = _inject_restarts(
        base_snapshot, pod_restart_tracking,
        args.restart_pods, args.seed + 1,
    )
    throttle_affected = _inject_throttling(
        base_snapshot, args.throttle_pods, args.seed + 2,
    )
    print(f'• Simulated OOM kills:     {len(oom_affected):>2}  → {oom_affected}')
    print(f'• Simulated restarts:      {len(restart_affected):>2}  → {restart_affected}')
    print(f'• Simulated throttle hits: {len(throttle_affected):>2}  → {throttle_affected}')
    print()

    # Build the same status dict the live route builds when loading from DB.
    status = {
        'execution_id': db_data.get('execution_id') or args.execution_id,
        'status': db_data.get('status') or 'COMPLETED',
        'start_time': db_data.get('start_time'),
        'end_time': db_data.get('end_time'),
        'duration_minutes': db_data.get('duration_minutes') or 0,
        'total_operations': db_data.get('total_operations') or 0,
        'successful_operations': db_data.get('successful_operations') or 0,
        'failed_operations': db_data.get('failed_operations') or 0,
        'success_rate': db_data.get('success_rate') or 0,
        'operations_per_minute': db_data.get('operations_per_minute') or 0,
        'target_config': db_data.get('target_config') or {},
        'baseline_metrics': db_data.get('baseline_metrics') or {},
        'final_metrics': db_data.get('final_metrics') or {},
        'metrics_history': db_data.get('metrics_history') or [],
        'operations_history': db_data.get('operations_history') or [],
        'cluster_health_snapshot': base_snapshot,
        'pod_restart_tracking': pod_restart_tracking,
        'testbed_info': {
            'testbed_label': db_data.get('testbed_label') or 'Unknown',
            'testbed_id': db_data.get('testbed_id') or 'unknown',
        },
    }
    report_data = status

    prom_url = args.prometheus_url or fed.get('prometheus_url')
    print(f'• Will render against Prometheus: {prom_url}')
    # Sanity-check the simulation by classifying once locally; the live
    # render below uses the same classifier path so summary numbers will
    # match what the user sees in the report.
    ers = EnhancedReportService(prometheus_url=prom_url)
    enhanced = ers.generate_enhanced_report(
        report_data=report_data,
        status_data=status,
        execution_id=args.execution_id,
        testbed_id=db_data.get('testbed_id'),
    )
    summary = (enhanced.get('pod_health') or {}).get('summary') or {}
    print(f'• pod_health.summary AFTER simulation: {summary}')

    # The simplest, most-faithful render is to clone the DB row under a
    # synthetic execution_id, write the simulated snapshot in, and call
    # the LIVE /enhanced endpoint via the running backend on 5000. That
    # way the rendered HTML is byte-for-byte identical to what users see
    # in the UI (no risk of the script's manual context drifting from
    # the route's). We delete the synthetic row at the end.
    sim_eid = f'{args.execution_id}-SIMULATED-{datetime.now().strftime("%H%M%S")}'
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution
    except Exception as exc:  # noqa: BLE001
        print(f'ERROR: cannot import DB layer to clone execution: {exc}',
              file=sys.stderr)
        return 4

    session = SessionLocal()
    try:
        original = session.query(SmartExecution).filter_by(
            execution_id=args.execution_id,
        ).first()
        if not original:
            print(f'ERROR: execution row {args.execution_id} not found',
                  file=sys.stderr)
            return 5
        # Build a shallow clone with overridden full_execution_data.
        cloned_fed = copy.deepcopy(original.full_execution_data or {})
        cloned_fed['cluster_health_snapshot'] = base_snapshot
        cloned_fed['pod_restart_tracking'] = pod_restart_tracking
        cloned_fed.setdefault('prometheus_url', prom_url)

        clone = SmartExecution(
            execution_id=sim_eid,
            execution_name=(original.execution_name or '') + ' [SIMULATED]',
            execution_description=(
                'Synthetic OOM / restart / throttle injected for v4 '
                'visualization demo. Cloned from '
                f'{args.execution_id}; this row will be deleted '
                'when the script exits.'
            ),
            testbed_id=original.testbed_id,
            unique_testbed_id=original.unique_testbed_id,
            testbed_label=original.testbed_label,
            status=original.status,
            start_time=original.start_time,
            end_time=original.end_time,
            duration_minutes=original.duration_minutes,
            total_operations=original.total_operations,
            successful_operations=original.successful_operations,
            failed_operations=original.failed_operations,
            success_rate=original.success_rate,
            operations_per_minute=original.operations_per_minute,
            target_config=original.target_config,
            ai_settings=original.ai_settings,
            entities_config=original.entities_config,
            rule_config=original.rule_config,
            baseline_metrics=original.baseline_metrics,
            final_metrics=original.final_metrics,
            metrics_history=original.metrics_history,
            operations_history=original.operations_history,
            entity_breakdown=original.entity_breakdown,
            full_execution_data=cloned_fed,
            report_generated=True,
        )
        session.add(clone)
        session.commit()
        print(f'• Cloned execution row → {sim_eid}')
    finally:
        session.close()

    html = None
    try:
        import requests
        api_base = os.environ.get('API_BASE', 'http://127.0.0.1:5000')
        url = f'{api_base}/api/smart-execution/report/{sim_eid}/enhanced'
        print(f'• Fetching rendered HTML from {url}')
        r = requests.get(url, timeout=180)
        if r.status_code == 200 and len(r.text) > 5000:
            html = r.text
        else:
            print(f'WARN: backend returned HTTP {r.status_code} '
                  f'(size {len(r.text)}); leaving file unwritten',
                  file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f'WARN: live render fetch failed: {exc}', file=sys.stderr)
    finally:
        # Always clean up the cloned row so the simulation doesn't
        # pollute the user's history.
        try:
            session = SessionLocal()
            try:
                row = session.query(SmartExecution).filter_by(
                    execution_id=sim_eid,
                ).first()
                if row:
                    session.delete(row)
                    session.commit()
                    print(f'• Cleaned up cloned execution row {sim_eid}')
            finally:
                session.close()
        except Exception as exc:  # noqa: BLE001
            print(f'WARN: failed to clean up clone {sim_eid}: {exc}',
                  file=sys.stderr)

    if html:
        Path(args.out).write_text(html)
        print()
        print(f'✅ Wrote rendered v4 report ({len(html):,} bytes) → {args.out}')
        print(f'   open file://{args.out}')

    if args.json:
        Path(args.json).write_text(json.dumps({
            'pod_health': enhanced.get('pod_health'),
            'verdict': enhanced.get('verdict'),
            'simulated': {
                'oom_pods': oom_affected,
                'restart_pods': restart_affected,
                'throttle_pods': throttle_affected,
            },
        }, indent=2, default=str))
        print(f'✅ Wrote JSON sidecar → {args.json}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
