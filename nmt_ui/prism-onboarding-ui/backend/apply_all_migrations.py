#!/usr/bin/env python3
"""
Run all database migrations in order.

Safe to run multiple times — every migration is idempotent
(uses IF NOT EXISTS / column-exists checks).

Usage:
    python3 apply_all_migrations.py
"""

import sys
import os
import logging

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def run_all():
    logger.info("=" * 60)
    logger.info("Running all database migrations ...")
    logger.info("=" * 60)

    from database import init_db
    logger.info("\n[0/7] init_db (create base tables if missing)")
    init_db()

    logger.info("\n[1/7] add_ai_fields_to_smart_executions")
    from migrations.add_ai_fields_to_smart_executions import add_ai_fields
    add_ai_fields()

    logger.info("\n[2/7] add_alert_config_to_testbeds")
    from migrations.add_alert_config_to_testbeds import add_alert_config_to_testbeds
    add_alert_config_to_testbeds()

    logger.info("\n[3/7] add_scheduled_executions_tables")
    from migrations.add_scheduled_executions_tables import create_scheduled_executions_tables
    create_scheduled_executions_tables()

    logger.info("\n[4/7] add_multi_testbed_tables")
    from migrations.add_multi_testbed_tables import add_multi_testbed_tables
    add_multi_testbed_tables()

    logger.info("\n[5/7] add_cost_tracking_tables")
    from migrations.add_cost_tracking_tables import add_cost_tracking_tables
    add_cost_tracking_tables()

    logger.info("\n[6/7] add_execution_templates_table")
    from migrations.add_execution_templates_table import migrate_execution_templates
    migrate_execution_templates()

    logger.info("\n[7/8] add_missing_columns (smart_executions + alert_summaries)")
    from migrations.add_missing_columns import add_missing_columns
    add_missing_columns()

    logger.info("\n[8/9] add_report_snapshot_tables (Layer-2 materialised reports)")
    from migrations.add_report_snapshot_tables import create_report_snapshot_tables
    create_report_snapshot_tables()

    logger.info("\n[9/9] add_execution_api_log_columns (operation_id / sequence_number)")
    from migrations.add_execution_api_log_columns import add_execution_api_log_columns
    add_execution_api_log_columns()

    logger.info("\n" + "=" * 60)
    logger.info("All migrations complete.")
    logger.info("=" * 60)


if __name__ == "__main__":
    run_all()
