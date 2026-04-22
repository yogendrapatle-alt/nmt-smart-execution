"""
Add missing columns to smart_executions and alert_summaries tables.

Safe to run multiple times (uses IF NOT EXISTS).
"""

import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

logger = logging.getLogger(__name__)


def add_missing_columns():
    from sqlalchemy import text
    from database import SessionLocal
    session = SessionLocal()
    try:
        stmts = [
            "ALTER TABLE smart_executions ADD COLUMN IF NOT EXISTS execution_name VARCHAR(100)",
            "ALTER TABLE smart_executions ADD COLUMN IF NOT EXISTS execution_description TEXT",
            "ALTER TABLE alert_summaries ADD COLUMN IF NOT EXISTS duration_minutes FLOAT",
            "ALTER TABLE alert_summaries ADD COLUMN IF NOT EXISTS diagnostic_context JSONB",
            "ALTER TABLE alert_summaries ADD COLUMN IF NOT EXISTS resolved_reason TEXT",
        ]
        for stmt in stmts:
            try:
                session.execute(text(stmt))
                col_name = stmt.split('ADD COLUMN')[-1].strip()
                logger.info(f"  OK: {col_name}")
            except Exception as e:
                if 'already exists' in str(e).lower() or 'duplicate' in str(e).lower():
                    logger.info(f"  SKIP (exists): {stmt.split('ADD COLUMN')[-1].strip()}")
                else:
                    logger.warning(f"  WARN: {e}")

        session.commit()
        logger.info("✅ Missing columns migration complete")
    except Exception as e:
        session.rollback()
        logger.error(f"Migration failed: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    add_missing_columns()
