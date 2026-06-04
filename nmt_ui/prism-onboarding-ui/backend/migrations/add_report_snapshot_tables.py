"""
Migration: report snapshot tables (Layer-2 materialised reports)
================================================================

Adds:
  * ``monitor_report_snapshots``        — one materialised report per monitor
  * ``smart_execution_report_snapshots`` — same, for smart-execution reports
                                           (created now so Phase-D needs no
                                           further DDL; written/read later)

Idempotent — uses ``CREATE TABLE IF NOT EXISTS`` and guards index creation,
so it is safe to run on every startup and re-run by hand.

Design note: the SQLAlchemy model (models/monitor_report_snapshot.py) would
also create the monitor table via Base.metadata.create_all(), but we keep an
explicit SQL migration too because:
  * it documents the exact DDL (incl. indexes) in one reviewable place,
  * it lets ops apply the schema without importing the whole app, and
  * it provisions the smart-execution table that has no model yet.
"""

import logging

logger = logging.getLogger(__name__)


def create_report_snapshot_tables():
    from sqlalchemy import text
    from database import SessionLocal

    session = SessionLocal()
    try:
        stmts = [
            # ── monitor-only ──────────────────────────────────────────
            """
            CREATE TABLE IF NOT EXISTS monitor_report_snapshots (
                monitor_id         VARCHAR(128) PRIMARY KEY,
                generated_at       TIMESTAMP    NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
                generator_version  INTEGER      NOT NULL DEFAULT 1,
                data_quality       VARCHAR(32)  NOT NULL DEFAULT 'persisted_only',
                banner_text        TEXT,
                size_bytes         INTEGER      NOT NULL DEFAULT 0,
                poll_count_at_gen  INTEGER      NOT NULL DEFAULT 0,
                payload            JSONB        NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_monitor_report_snapshots_generated_at "
            "ON monitor_report_snapshots (generated_at)",

            # ── smart-execution (provisioned for Phase-D) ─────────────
            """
            CREATE TABLE IF NOT EXISTS smart_execution_report_snapshots (
                execution_id       VARCHAR(128) PRIMARY KEY,
                generated_at       TIMESTAMP    NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
                generator_version  INTEGER      NOT NULL DEFAULT 1,
                data_quality       VARCHAR(32)  NOT NULL DEFAULT 'persisted_only',
                banner_text        TEXT,
                size_bytes         INTEGER      NOT NULL DEFAULT 0,
                poll_count_at_gen  INTEGER      NOT NULL DEFAULT 0,
                payload            JSONB        NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_smart_exec_report_snapshots_generated_at "
            "ON smart_execution_report_snapshots (generated_at)",
        ]

        for stmt in stmts:
            try:
                session.execute(text(stmt))
                session.commit()
                logger.info("  OK: %s", stmt.strip().split('\n')[0][:80])
            except Exception as e:  # noqa: BLE001 — keep going on partial state
                session.rollback()
                msg = str(e).lower()
                if 'already exists' in msg or 'duplicate' in msg:
                    logger.info("  SKIP (exists): %s", stmt.strip().split('\n')[0][:80])
                else:
                    logger.warning("  WARN: %s", e)

        logger.info("Report snapshot tables migration complete")
        return True
    finally:
        session.close()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    create_report_snapshot_tables()
