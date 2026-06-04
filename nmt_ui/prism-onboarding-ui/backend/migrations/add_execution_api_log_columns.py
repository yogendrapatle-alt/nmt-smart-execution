"""
Add missing columns / indexes / unique constraint to ``execution_api_logs``.

The SQLAlchemy model ``models.execution_detail_tables.ExecutionApiLog`` declares
``operation_id`` and ``sequence_number`` columns (plus two helper indexes and a
``uq_api_logs_exec_op`` unique constraint) that some older databases never
received. Without ``operation_id`` the
``/api/smart-execution/<id>/failures`` endpoint fails with
``column execution_api_logs.operation_id does not exist``.

Safe to run multiple times (uses IF NOT EXISTS / pg_constraint guard).
"""

import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

logger = logging.getLogger(__name__)


def add_execution_api_log_columns():
    from sqlalchemy import text
    from database import SessionLocal
    session = SessionLocal()
    try:
        stmts = [
            "ALTER TABLE execution_api_logs ADD COLUMN IF NOT EXISTS operation_id VARCHAR(32)",
            "ALTER TABLE execution_api_logs ADD COLUMN IF NOT EXISTS sequence_number INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_api_logs_exec_status ON execution_api_logs (execution_id, status)",
            "CREATE INDEX IF NOT EXISTS ix_api_logs_exec_iter ON execution_api_logs (execution_id, iteration)",
            # Postgres has no "ADD CONSTRAINT IF NOT EXISTS" — guard via pg_constraint.
            # Existing rows have operation_id = NULL and Postgres treats NULLs as
            # distinct in a UNIQUE constraint, so this never conflicts.
            """
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_api_logs_exec_op'
                ) THEN
                    ALTER TABLE execution_api_logs
                        ADD CONSTRAINT uq_api_logs_exec_op UNIQUE (execution_id, operation_id);
                END IF;
            END $$;
            """,
        ]
        for stmt in stmts:
            try:
                session.execute(text(stmt))
                logger.info(f"  OK: {' '.join(stmt.split())[:80]}")
            except Exception as e:
                if 'already exists' in str(e).lower() or 'duplicate' in str(e).lower():
                    logger.info(f"  SKIP (exists): {' '.join(stmt.split())[:80]}")
                else:
                    logger.warning(f"  WARN: {e}")

        session.commit()
        logger.info("✅ execution_api_logs columns migration complete")
    except Exception as e:
        session.rollback()
        logger.error(f"Migration failed: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    add_execution_api_log_columns()
