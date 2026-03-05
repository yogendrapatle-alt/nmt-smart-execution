"""
Database Migration: Add Multi-Testbed Tables

Creates tables for multi-testbed orchestration:
- multi_testbed_executions: Track executions across multiple testbeds
- testbed_groups: Named collections of testbeds

Safe to run multiple times.
"""

import sys
import os
import logging
from sqlalchemy import create_engine, inspect, text

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import DATABASE_URL, SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def add_multi_testbed_tables():
    """Create multi-testbed orchestration tables"""
    
    logger.info("\n🚀 Starting multi-testbed tables migration...")
    
    session = SessionLocal()
    engine = create_engine(DATABASE_URL)
    
    try:
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()
        
        tables_created = []
        
        # Create multi_testbed_executions table
        if 'multi_testbed_executions' not in existing_tables:
            logger.info("  + Creating 'multi_testbed_executions' table...")
            
            session.execute(text("""
                CREATE TABLE multi_testbed_executions (
                    id SERIAL PRIMARY KEY,
                    multi_execution_id VARCHAR(128) UNIQUE NOT NULL,
                    execution_name VARCHAR(255),
                    testbed_ids JSON NOT NULL,
                    target_config JSON NOT NULL,
                    entities_config JSON NOT NULL,
                    ai_settings JSON,
                    status VARCHAR(50) NOT NULL DEFAULT 'initializing',
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    child_executions JSON,
                    total_testbeds INTEGER DEFAULT 0,
                    completed_testbeds INTEGER DEFAULT 0,
                    failed_testbeds INTEGER DEFAULT 0,
                    aggregate_metrics JSON,
                    progress_data JSON,
                    created_by VARCHAR(255),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    notes TEXT
                )
            """))
            
            # Add index
            session.execute(text("""
                CREATE INDEX idx_multi_testbed_executions_id 
                ON multi_testbed_executions(multi_execution_id)
            """))
            
            session.commit()
            tables_created.append('multi_testbed_executions')
            logger.info("  ✅ Table 'multi_testbed_executions' created")
        else:
            logger.info("  ✓ Table 'multi_testbed_executions' already exists")
        
        # Create testbed_groups table
        if 'testbed_groups' not in existing_tables:
            logger.info("  + Creating 'testbed_groups' table...")
            
            session.execute(text("""
                CREATE TABLE testbed_groups (
                    id SERIAL PRIMARY KEY,
                    group_id VARCHAR(128) UNIQUE NOT NULL,
                    group_name VARCHAR(255) NOT NULL,
                    description TEXT,
                    testbed_ids JSON NOT NULL,
                    created_by VARCHAR(255),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    usage_count INTEGER DEFAULT 0
                )
            """))
            
            # Add index
            session.execute(text("""
                CREATE INDEX idx_testbed_groups_id 
                ON testbed_groups(group_id)
            """))
            
            session.commit()
            tables_created.append('testbed_groups')
            logger.info("  ✅ Table 'testbed_groups' created")
        else:
            logger.info("  ✓ Table 'testbed_groups' already exists")
        
        if tables_created:
            logger.info("\n" + "="*60)
            logger.info("✅ Migration completed successfully!")
            logger.info("="*60)
            logger.info("\nCreated tables:")
            for table in tables_created:
                logger.info(f"  ✅ {table}")
            logger.info("\nNew features enabled:")
            logger.info("  🚀 Multi-testbed parallel execution")
            logger.info("  📊 Aggregate reporting across testbeds")
            logger.info("  👥 Testbed group management")
            logger.info("  📈 Real-time progress tracking")
            logger.info("="*60 + "\n")
        else:
            logger.info("\n  ℹ️  All tables already exist - no changes needed\n")
        
        return True
        
    except Exception as e:
        logger.error(f"\n❌ Migration failed: {e}")
        logger.exception(e)
        session.rollback()
        return False
        
    finally:
        session.close()


if __name__ == '__main__':
    print("\n" + "╔" + "="*58 + "╗")
    print("║" + " "*58 + "║")
    print("║" + "  MULTI-TESTBED ORCHESTRATION MIGRATION".center(58) + "║")
    print("║" + " "*58 + "║")
    print("╚" + "="*58 + "╝\n")
    
    try:
        success = add_multi_testbed_tables()
        
        if success:
            print("\n" + "="*60)
            print("✅ MIGRATION COMPLETE!")
            print("="*60)
            print("\nYou can now:")
            print("1. Run executions on multiple testbeds simultaneously")
            print("2. Create testbed groups for quick selection")
            print("3. View aggregate reports across all testbeds")
            print("4. Monitor real-time progress for each testbed")
            print("="*60 + "\n")
        else:
            print("\n" + "="*60)
            print("❌ MIGRATION FAILED!")
            print("="*60 + "\n")
            sys.exit(1)
        
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)
