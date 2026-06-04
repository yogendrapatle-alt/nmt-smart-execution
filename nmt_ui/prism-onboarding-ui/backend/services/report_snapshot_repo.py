"""
Report Snapshot Repository (Layer-2 persistence + orchestration)
================================================================

Thin data-access layer for ``monitor_report_snapshots`` plus the orchestration
helper that ties together:

    build_report (compute)  →  build_snapshot (bound)  →  UPSERT (persist)

Kept separate from the pure builder so the builder stays I/O-free and unit-
testable, while all DB concerns live here.

All imports of heavier modules are lazy (inside functions) to avoid an import
cycle: the poller lives in ``monitor_only_service`` which is imported by
``monitor_only_report``, which this module imports for ``build_report``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def get_monitor_snapshot(monitor_id: str) -> Optional[Dict[str, Any]]:
    """Return the stored snapshot row as a dict, or ``None`` if absent.

    Single indexed PK lookup — this is the hot read path the API uses.
    """
    from database import SessionLocal
    from models.monitor_report_snapshot import MonitorReportSnapshot

    session = SessionLocal()
    try:
        row = (
            session.query(MonitorReportSnapshot)
            .filter(MonitorReportSnapshot.monitor_id == monitor_id)
            .first()
        )
        return row.to_dict() if row else None
    finally:
        session.close()


def upsert_monitor_snapshot(monitor_id: str, result, *, now: Optional[datetime] = None) -> bool:
    """Insert-or-replace the snapshot row for ``monitor_id``.

    ``result`` is a ``report_snapshot_builder.SnapshotResult``. Atomic UPSERT
    keyed on the PK so concurrent writers (poller + manual rebuild) can't
    create duplicates. Never raises — returns False on failure.
    """
    from database import SessionLocal
    from models.monitor_report_snapshot import MonitorReportSnapshot
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    now = now or datetime.utcnow()
    session = SessionLocal()
    try:
        values = {
            'monitor_id': monitor_id,
            'generated_at': now,
            'generator_version': result.generator_version,
            'data_quality': result.data_quality,
            'banner_text': result.banner_text,
            'size_bytes': result.size_bytes,
            'poll_count_at_gen': result.poll_count_at_gen,
            'payload': result.payload,
        }
        stmt = pg_insert(MonitorReportSnapshot).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=['monitor_id'],
            set_={
                'generated_at': stmt.excluded.generated_at,
                'generator_version': stmt.excluded.generator_version,
                'data_quality': stmt.excluded.data_quality,
                'banner_text': stmt.excluded.banner_text,
                'size_bytes': stmt.excluded.size_bytes,
                'poll_count_at_gen': stmt.excluded.poll_count_at_gen,
                'payload': stmt.excluded.payload,
            },
        )
        session.execute(stmt)
        session.commit()
        logger.debug(
            "[%s] snapshot upserted (quality=%s size=%dB polls=%d)",
            monitor_id, result.data_quality, result.size_bytes, result.poll_count_at_gen,
        )
        return True
    except Exception as e:  # noqa: BLE001 — snapshotting must never crash the poller
        session.rollback()
        logger.warning("[%s] snapshot upsert failed: %s", monitor_id, e, exc_info=True)
        return False
    finally:
        session.close()


# ── smart-execution snapshots (Phase D) ─────────────────────────────────

def get_smart_snapshot(execution_id: str) -> Optional[Dict[str, Any]]:
    """Return the stored smart-execution snapshot row, or None. Hot read path."""
    from database import SessionLocal
    from models.smart_execution_report_snapshot import SmartExecutionReportSnapshot

    session = SessionLocal()
    try:
        row = (
            session.query(SmartExecutionReportSnapshot)
            .filter(SmartExecutionReportSnapshot.execution_id == execution_id)
            .first()
        )
        return row.to_dict() if row else None
    finally:
        session.close()


def upsert_smart_snapshot(execution_id: str, result, *, now: Optional[datetime] = None) -> bool:
    """Insert-or-replace the smart-execution snapshot row. Never raises."""
    from database import SessionLocal
    from models.smart_execution_report_snapshot import SmartExecutionReportSnapshot
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    now = now or datetime.utcnow()
    session = SessionLocal()
    try:
        values = {
            'execution_id': execution_id,
            'generated_at': now,
            'generator_version': result.generator_version,
            'data_quality': result.data_quality,
            'banner_text': result.banner_text,
            'size_bytes': result.size_bytes,
            'poll_count_at_gen': result.poll_count_at_gen,
            'payload': result.payload,
        }
        stmt = pg_insert(SmartExecutionReportSnapshot).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=['execution_id'],
            set_={
                'generated_at': stmt.excluded.generated_at,
                'generator_version': stmt.excluded.generator_version,
                'data_quality': stmt.excluded.data_quality,
                'banner_text': stmt.excluded.banner_text,
                'size_bytes': stmt.excluded.size_bytes,
                'poll_count_at_gen': stmt.excluded.poll_count_at_gen,
                'payload': stmt.excluded.payload,
            },
        )
        session.execute(stmt)
        session.commit()
        logger.debug("[%s] smart snapshot upserted (quality=%s size=%dB)",
                     execution_id, result.data_quality, result.size_bytes)
        return True
    except Exception as e:  # noqa: BLE001
        session.rollback()
        logger.warning("[%s] smart snapshot upsert failed: %s", execution_id, e, exc_info=True)
        return False
    finally:
        session.close()


def refresh_monitor_snapshot(monitor_id: str) -> Optional[Dict[str, Any]]:
    """Compute → bound → persist a fresh snapshot for ``monitor_id``.

    This is the orchestration entry point used by the poller hook, the backfill
    script, and the manual rebuild endpoint. Returns a small status dict (not
    the full payload) or ``None`` if the monitor doesn't exist.

    Never raises — any failure is logged and encoded in the return dict so the
    poller loop keeps running.
    """
    from services import monitor_only_report as report_svc
    from services import monitor_only_service as svc
    from services import report_snapshot_builder as builder

    try:
        report = report_svc.build_report(monitor_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("[%s] refresh_monitor_snapshot: build_report failed: %s",
                       monitor_id, e, exc_info=True)
        return {'success': False, 'monitor_id': monitor_id, 'error': f'build_report: {e}'}

    if not report:
        return None

    # poll count for the "from poll N" UI label
    poll_count = 0
    try:
        mon = svc.get_monitor(monitor_id) or {}
        poll_count = int(mon.get('total_polls') or 0)
    except Exception:
        poll_count = int(((report.get('overview') or {}).get('total_polls')) or 0)

    now = datetime.utcnow()
    try:
        result = builder.build_snapshot(report, now=now, poll_count=poll_count)
    except Exception as e:  # noqa: BLE001
        logger.warning("[%s] refresh_monitor_snapshot: build_snapshot failed: %s",
                       monitor_id, e, exc_info=True)
        return {'success': False, 'monitor_id': monitor_id, 'error': f'build_snapshot: {e}'}

    ok = upsert_monitor_snapshot(monitor_id, result, now=now)
    return {
        'success': ok,
        'monitor_id': monitor_id,
        'data_quality': result.data_quality,
        'size_bytes': result.size_bytes,
        'poll_count_at_gen': result.poll_count_at_gen,
        'generated_at': now.isoformat() + 'Z',
        'notes': result.notes,
    }
