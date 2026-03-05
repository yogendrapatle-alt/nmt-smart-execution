"""
Database Migration: Add Scheduled Executions Tables

Creates tables for scheduled execution functionality:
- scheduled_executions: Stores schedule configuration
- schedule_execution_history: Tracks individual execution runs

Safe to run multiple times (uses IF NOT EXISTS).
"""

import sys
import os
import logging

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import SessionLocal, engine
from sqlalchemy import text, inspect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_scheduled_executions_tables():
    """Create scheduled executions tables"""
    
    logger.info("🚀 Starting scheduled executions tables migration...")
    
    session = SessionLocal()
    
    try:
        # Check existing tables
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        logger.info(f"✓ Found {len(tables)} existing tables")
        
        # Create scheduled_executions table
        if 'scheduled_executions' in tables:
            logger.info("  ✓ Table 'scheduled_executions' already exists - skipping")
        else:
            logger.info("  + Creating table 'scheduled_executions'...")
            
            session.execute(text("""
                CREATE TABLE scheduled_executions (
                    id SERIAL PRIMARY KEY,
                    schedule_id VARCHAR(128) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    created_by VARCHAR(128),
                    
                    schedule_type VARCHAR(50) NOT NULL,
                    schedule_config JSON NOT NULL,
                    next_run_time TIMESTAMP,
                    last_run_time TIMESTAMP,
                    
                    testbed_id VARCHAR(128) NOT NULL,
                    target_config JSON NOT NULL,
                    entities_config JSON NOT NULL,
                    rule_config JSON,
                    ai_settings JSON,
                    
                    is_active BOOLEAN DEFAULT TRUE,
                    is_paused BOOLEAN DEFAULT FALSE,
                    
                    total_executions INTEGER DEFAULT 0,
                    successful_executions INTEGER DEFAULT 0,
                    failed_executions INTEGER DEFAULT 0,
                    last_execution_id VARCHAR(128),
                    last_execution_status VARCHAR(50),
                    
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_modified_by VARCHAR(128),
                    
                    execution_window_start VARCHAR(10),
                    execution_window_end VARCHAR(10),
                    
                    max_executions INTEGER,
                    max_concurrent INTEGER DEFAULT 1,
                    
                    notify_on_completion BOOLEAN DEFAULT FALSE,
                    notify_on_failure BOOLEAN DEFAULT TRUE,
                    notification_channels JSON,
                    
                    tags JSON,
                    priority INTEGER DEFAULT 5
                )
            """))
            session.commit()
            
            logger.info("  ✅ Table 'scheduled_executions' created")
        
        # Create schedule_execution_history table
        if 'schedule_execution_history' in tables:
            logger.info("  ✓ Table 'schedule_execution_history' already exists - skipping")
        else:
            logger.info("  + Creating table 'schedule_execution_history'...")
            
            session.execute(text("""
                CREATE TABLE schedule_execution_history (
                    id SERIAL PRIMARY KEY,
                    history_id VARCHAR(128) UNIQUE NOT NULL,
                    
                    schedule_id VARCHAR(128) NOT NULL,
                    execution_id VARCHAR(128),
                    
                    scheduled_time TIMESTAMP NOT NULL,
                    actual_start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    duration_minutes INTEGER,
                    
                    status VARCHAR(50) NOT NULL,
                    error_message TEXT,
                    
                    total_operations INTEGER DEFAULT 0,
                    successful_operations INTEGER DEFAULT 0,
                    failed_operations INTEGER DEFAULT 0,
                    threshold_reached BOOLEAN DEFAULT FALSE,
                    
                    triggered_by VARCHAR(128) DEFAULT 'scheduler',
                    notes TEXT,
                    
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            session.commit()
            
            logger.info("  ✅ Table 'schedule_execution_history' created")
        
        # Create indexes
        logger.info("\n📊 Creating indexes...")
        
        indexes = [
            ("idx_scheduled_exec_id", "scheduled_executions", "schedule_id"),
            ("idx_scheduled_testbed", "scheduled_executions", "testbed_id"),
            ("idx_scheduled_active", "scheduled_executions", "is_active"),
            ("idx_scheduled_next_run", "scheduled_executions", "next_run_time"),
            ("idx_history_schedule", "schedule_execution_history", "schedule_id"),
            ("idx_history_execution", "schedule_execution_history", "execution_id"),
        ]
        
        for idx_name, table, column in indexes:
            try:
                session.execute(text(f"""
                    CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column})
                """))
                session.commit()
                logger.info(f"  ✅ Index '{idx_name}' created/verified")
            except Exception as e:
                logger.warning(f"  ⚠️  Could not create index {idx_name}: {e}")
        
        # Summary
        logger.info("\n" + "="*60)
        logger.info("📊 MIGRATION SUMMARY")
        logger.info("="*60)
        logger.info("  Tables created/verified:")
        logger.info("    ✓ scheduled_executions")
        logger.info("    ✓ schedule_execution_history")
        logger.info("  Indexes created: 6")
        logger.info("="*60)
        
        logger.info("\n✅ Migration completed successfully!")
        
        # Show usage examples
        show_usage_examples()
        
    except Exception as e:
        logger.error(f"\n❌ Migration failed: {e}")
        logger.exception(e)
        session.rollback()
        raise
        
    finally:
        session.close()


def show_usage_examples():
    """Show example usage"""
    
    logger.info("\n" + "="*60)
    logger.info("📚 USAGE EXAMPLES")
    logger.info("="*60)
    
    example = """

Example 1: Create a Daily Schedule (Cron)
──────────────────────────────────────────

from models.scheduled_execution import ScheduledExecution

schedule = ScheduledExecution(
    schedule_id='SCHED-001',
    name='Nightly Load Test',
    description='Run load test every night at 2 AM',
    schedule_type='cron',
    schedule_config={
        'hour': 2,
        'minute': 0
    },
    testbed_id='test-123',
    target_config={'cpu_threshold': 80, 'memory_threshold': 75},
    entities_config={'vm': ['CREATE', 'DELETE']},
    ai_settings={'enable_ai': True, 'enable_ml': True}
)

session.add(schedule)
session.commit()


Example 2: Create an Interval Schedule
───────────────────────────────────────

schedule = ScheduledExecution(
    schedule_id='SCHED-002',
    name='Every 6 Hours Test',
    schedule_type='interval',
    schedule_config={
        'interval_type': 'hours',
        'interval_value': 6
    },
    testbed_id='test-123',
    target_config={'cpu_threshold': 70, 'memory_threshold': 65},
    entities_config={'blueprint_multi_vm': ['EXECUTE']}
)


Example 3: Query Schedules
───────────────────────────

# Get all active schedules
active = session.query(ScheduledExecution).filter_by(is_active=True).all()

# Get schedules for specific testbed
testbed_schedules = session.query(ScheduledExecution).filter_by(
    testbed_id='test-123'
).all()

# Get execution history for a schedule
from models.scheduled_execution import ScheduleExecutionHistory

history = session.query(ScheduleExecutionHistory).filter_by(
    schedule_id='SCHED-001'
).order_by(ScheduleExecutionHistory.scheduled_time.desc()).all()


Example 4: Start the Scheduler Service
───────────────────────────────────────

# Terminal 1: Run scheduler
cd backend
python3 services/scheduler_service.py

# Terminal 2: Backend API
python3 app.py

# Access UI at: http://localhost:5173/scheduled-executions

    """
    
    print(example)


if __name__ == '__main__':
    print("\n" + "╔" + "="*58 + "╗")
    print("║" + " "*58 + "║")
    print("║" + "  SCHEDULED EXECUTIONS TABLES MIGRATION".center(58) + "║")
    print("║" + " "*58 + "║")
    print("╚" + "="*58 + "╝\n")
    
    try:
        create_scheduled_executions_tables()
        
        print("\n" + "="*60)
        print("✅ MIGRATION COMPLETE!")
        print("="*60)
        print("\nNext steps:")
        print("1. Start scheduler service:")
        print("   python3 services/scheduler_service.py")
        print("\n2. Access UI:")
        print("   http://localhost:5173/scheduled-executions")
        print("\n3. Create your first schedule!")
        print("="*60 + "\n")
        
    except Exception as e:
        print("\n" + "="*60)
        print("❌ MIGRATION FAILED!")
        print("="*60)
        print(f"\nError: {e}\n")
        sys.exit(1)
