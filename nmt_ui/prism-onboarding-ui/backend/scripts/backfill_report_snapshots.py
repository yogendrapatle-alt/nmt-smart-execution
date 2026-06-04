#!/usr/bin/env python3
"""
Backfill Layer-2 report snapshots for existing monitor sessions.
================================================================

Walks every row in ``monitor_sessions`` and materialises a
``monitor_report_snapshots`` row for it (via the same orchestration the
poller uses). One-time job to run after the table is created so historical
monitors get the fast read path immediately — without it, the first open of
an old report would still pay the slow rebuild once.

Safe to run repeatedly: each monitor is UPSERTed, so re-running just refreshes.
Processes one monitor at a time and never aborts the whole run on a single
bad row — failures are logged and counted.

Usage::

    python3 scripts/backfill_report_snapshots.py
    python3 scripts/backfill_report_snapshots.py --limit 50
    python3 scripts/backfill_report_snapshots.py --status STOPPED
    python3 scripts/backfill_report_snapshots.py --only MON-20260604-040703-4a697afb
"""

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger('backfill_report_snapshots')


def _monitor_ids(status_filter=None, limit=None, only=None):
    from database import SessionLocal
    from models.monitor_session import MonitorSession

    session = SessionLocal()
    try:
        q = session.query(MonitorSession.monitor_id, MonitorSession.status)
        if only:
            q = q.filter(MonitorSession.monitor_id == only)
        elif status_filter:
            q = q.filter(MonitorSession.status == status_filter)
        q = q.order_by(MonitorSession.started_at.desc())
        if limit:
            q = q.limit(limit)
        return [(r[0], r[1]) for r in q.all()]
    finally:
        session.close()


def main():
    ap = argparse.ArgumentParser(description='Backfill monitor report snapshots')
    ap.add_argument('--limit', type=int, default=None, help='Max monitors to process')
    ap.add_argument('--status', default=None, help='Only this status (e.g. STOPPED)')
    ap.add_argument('--only', default=None, help='Only this monitor_id')
    args = ap.parse_args()

    # Ensure the table exists before we try to write to it.
    try:
        from migrations.add_report_snapshot_tables import create_report_snapshot_tables
        create_report_snapshot_tables()
    except Exception as e:
        logger.warning('Could not ensure snapshot tables exist (continuing): %s', e)

    from services.report_snapshot_repo import refresh_monitor_snapshot

    monitors = _monitor_ids(status_filter=args.status, limit=args.limit, only=args.only)
    total = len(monitors)
    logger.info('Backfilling %d monitor(s)…', total)

    ok = 0
    skipped = 0
    failed = 0
    t0 = time.time()
    for i, (mid, status) in enumerate(monitors, 1):
        try:
            res = refresh_monitor_snapshot(mid)
            if res is None:
                skipped += 1
                logger.info('[%d/%d] %s — SKIP (not found)', i, total, mid)
            elif res.get('success'):
                ok += 1
                logger.info(
                    '[%d/%d] %s — OK (quality=%s size=%dB polls=%d)',
                    i, total, mid, res.get('data_quality'),
                    res.get('size_bytes'), res.get('poll_count_at_gen'),
                )
            else:
                failed += 1
                logger.warning('[%d/%d] %s — FAIL: %s', i, total, mid, res.get('error'))
        except Exception as e:  # noqa: BLE001 — never abort the whole backfill
            failed += 1
            logger.warning('[%d/%d] %s — EXC: %s', i, total, mid, e)

    elapsed = time.time() - t0
    logger.info('=' * 60)
    logger.info('Backfill complete in %.1fs: %d ok, %d skipped, %d failed (of %d)',
                elapsed, ok, skipped, failed, total)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
