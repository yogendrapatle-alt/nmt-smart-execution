#!/usr/bin/env python3
"""
Backfill Layer-2 report snapshots for existing smart-executions (Phase D).
=========================================================================

Walks terminal rows in ``smart_executions`` and materialises a
``smart_execution_report_snapshots`` row for each by driving the SAME enhanced
report route the UI uses (``GET /api/smart-execution/report/<id>/enhanced
?source=live``) through an in-process Flask test client. Because the route's
read-through capture stores EXACTLY what it renders, this reuses the real
assembly logic with zero duplication / zero divergence — the script just
"warms" each report once so the first real open is instant.

Safe to run repeatedly (each execution is UPSERTed). Never aborts the whole run
on a single bad execution — failures are logged and counted. Running executions
are skipped (their data is still changing; they get captured on first terminal
view).

Usage::

    python3 scripts/backfill_smart_report_snapshots.py
    python3 scripts/backfill_smart_report_snapshots.py --limit 20
    python3 scripts/backfill_smart_report_snapshots.py --only AI-EXEC-20260514-123439-e8cd0604
"""

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('backfill_smart_report_snapshots')

TERMINAL = {'COMPLETED', 'STOPPED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ERROR'}


def _execution_ids(limit=None, only=None, include_running=False):
    from database import SessionLocal
    from models.smart_execution import SmartExecution

    session = SessionLocal()
    try:
        q = session.query(SmartExecution.execution_id, SmartExecution.status)
        if only:
            q = q.filter(SmartExecution.execution_id == only)
        q = q.order_by(SmartExecution.start_time.desc())
        if limit:
            q = q.limit(limit)
        rows = [(r[0], r[1]) for r in q.all()]
    finally:
        session.close()
    if only or include_running:
        return rows
    return [(eid, st) for (eid, st) in rows if (st or '').upper() in TERMINAL]


def main():
    ap = argparse.ArgumentParser(description='Backfill smart-execution report snapshots')
    ap.add_argument('--limit', type=int, default=None, help='Max executions to process')
    ap.add_argument('--only', default=None, help='Only this execution_id')
    ap.add_argument('--include-running', action='store_true', help='Also warm non-terminal executions')
    args = ap.parse_args()

    try:
        from migrations.add_report_snapshot_tables import create_report_snapshot_tables
        create_report_snapshot_tables()
    except Exception as e:  # noqa: BLE001
        logger.warning('Could not ensure snapshot tables exist (continuing): %s', e)

    import app as appmod
    from services.report_snapshot_repo import get_smart_snapshot
    client = appmod.app.test_client()

    execs = _execution_ids(limit=args.limit, only=args.only, include_running=args.include_running)
    total = len(execs)
    logger.info('Backfilling %d smart-execution(s)…', total)

    ok = failed = 0
    t0 = time.time()
    for i, (eid, status) in enumerate(execs, 1):
        try:
            resp = client.get(f'/api/smart-execution/report/{eid}/enhanced?source=live&nocache=1')
            if resp.status_code != 200:
                failed += 1
                logger.warning('[%d/%d] %s — HTTP %s', i, total, eid, resp.status_code)
                continue
            # capture is async; give the daemon thread a moment to persist
            row = None
            for _ in range(20):
                time.sleep(0.5)
                row = get_smart_snapshot(eid)
                if row:
                    break
            if row:
                ok += 1
                logger.info('[%d/%d] %s — OK (quality=%s size=%dKB)',
                            i, total, eid, row.get('data_quality'),
                            int((row.get('size_bytes') or 0) / 1024))
            else:
                failed += 1
                logger.warning('[%d/%d] %s — rendered but snapshot not persisted', i, total, eid)
        except Exception as e:  # noqa: BLE001
            failed += 1
            logger.warning('[%d/%d] %s — EXC: %s', i, total, eid, e)

    logger.info('=' * 60)
    logger.info('Backfill complete in %.1fs: %d ok, %d failed (of %d)',
                time.time() - t0, ok, failed, total)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
