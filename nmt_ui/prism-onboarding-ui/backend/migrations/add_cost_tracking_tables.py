"""
Database Migration: Add Cost Tracking Tables

Creates tables for cost tracking and budget management.

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


def add_cost_tracking_tables():
    """Create cost tracking tables"""
    
    logger.info("\n🚀 Starting cost tracking tables migration...")
    
    session = SessionLocal()
    engine = create_engine(DATABASE_URL)
    
    try:
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()
        
        tables_created = []
        
        # Create cost_tracker table
        if 'cost_tracker' not in existing_tables:
            logger.info("  + Creating 'cost_tracker' table...")
            
            session.execute(text("""
                CREATE TABLE cost_tracker (
                    id SERIAL PRIMARY KEY,
                    cost_id VARCHAR(128) UNIQUE NOT NULL,
                    execution_id VARCHAR(128) NOT NULL,
                    execution_type VARCHAR(50) NOT NULL,
                    testbed_id VARCHAR(128) NOT NULL,
                    cpu_hours FLOAT DEFAULT 0.0,
                    memory_gb_hours FLOAT DEFAULT 0.0,
                    storage_gb_hours FLOAT DEFAULT 0.0,
                    network_gb FLOAT DEFAULT 0.0,
                    operation_count INTEGER DEFAULT 0,
                    duration_minutes FLOAT DEFAULT 0.0,
                    cpu_rate FLOAT DEFAULT 0.10,
                    memory_rate FLOAT DEFAULT 0.01,
                    storage_rate FLOAT DEFAULT 0.001,
                    network_rate FLOAT DEFAULT 0.05,
                    operation_rate FLOAT DEFAULT 0.0001,
                    cpu_cost FLOAT DEFAULT 0.0,
                    memory_cost FLOAT DEFAULT 0.0,
                    storage_cost FLOAT DEFAULT 0.0,
                    network_cost FLOAT DEFAULT 0.0,
                    operation_cost FLOAT DEFAULT 0.0,
                    total_cost FLOAT DEFAULT 0.0,
                    cost_breakdown JSON,
                    optimization_potential FLOAT DEFAULT 0.0,
                    cost_efficiency_score FLOAT DEFAULT 0.0,
                    execution_date TIMESTAMP NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))
            
            # Add indexes
            session.execute(text("""
                CREATE INDEX idx_cost_tracker_id ON cost_tracker(cost_id)
            """))
            session.execute(text("""
                CREATE INDEX idx_cost_tracker_execution ON cost_tracker(execution_id)
            """))
            session.execute(text("""
                CREATE INDEX idx_cost_tracker_testbed ON cost_tracker(testbed_id)
            """))
            session.execute(text("""
                CREATE INDEX idx_cost_tracker_date ON cost_tracker(execution_date)
            """))
            
            session.commit()
            tables_created.append('cost_tracker')
            logger.info("  ✅ Table 'cost_tracker' created")
        else:
            logger.info("  ✓ Table 'cost_tracker' already exists")
        
        # Create budget_limits table
        if 'budget_limits' not in existing_tables:
            logger.info("  + Creating 'budget_limits' table...")
            
            session.execute(text("""
                CREATE TABLE budget_limits (
                    id SERIAL PRIMARY KEY,
                    budget_id VARCHAR(128) UNIQUE NOT NULL,
                    scope_type VARCHAR(50) NOT NULL,
                    scope_id VARCHAR(128),
                    scope_name VARCHAR(255) NOT NULL,
                    daily_limit FLOAT,
                    weekly_limit FLOAT,
                    monthly_limit FLOAT,
                    daily_spent FLOAT DEFAULT 0.0,
                    weekly_spent FLOAT DEFAULT 0.0,
                    monthly_spent FLOAT DEFAULT 0.0,
                    alert_threshold FLOAT DEFAULT 80.0,
                    block_threshold FLOAT DEFAULT 100.0,
                    is_active BOOLEAN DEFAULT TRUE,
                    is_blocking BOOLEAN DEFAULT FALSE,
                    created_by VARCHAR(255),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_reset_at TIMESTAMP
                )
            """))
            
            # Add indexes
            session.execute(text("""
                CREATE INDEX idx_budget_limits_id ON budget_limits(budget_id)
            """))
            session.execute(text("""
                CREATE INDEX idx_budget_limits_scope ON budget_limits(scope_id)
            """))
            
            session.commit()
            tables_created.append('budget_limits')
            logger.info("  ✅ Table 'budget_limits' created")
        else:
            logger.info("  ✓ Table 'budget_limits' already exists")
        
        if tables_created:
            logger.info("\n" + "="*60)
            logger.info("✅ Migration completed successfully!")
            logger.info("="*60)
            logger.info("\nCreated tables:")
            for table in tables_created:
                logger.info(f"  ✅ {table}")
            logger.info("\nNew features enabled:")
            logger.info("  💰 Cost tracking per execution")
            logger.info("  📊 Budget limits and alerts")
            logger.info("  🎯 Cost optimization recommendations")
            logger.info("  📈 Cost reports and analytics")
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
    print("║" + "  COST TRACKING MIGRATION".center(58) + "║")
    print("║" + " "*58 + "║")
    print("╚" + "="*58 + "╝\n")
    
    try:
        success = add_cost_tracking_tables()
        
        if success:
            print("\n" + "="*60)
            print("✅ MIGRATION COMPLETE!")
            print("="*60)
            print("\nYou can now:")
            print("1. Track costs for every execution")
            print("2. Set budget limits per testbed")
            print("3. Get cost optimization recommendations")
            print("4. View cost reports and analytics")
            print("="*60 + "\n")
        else:
            print("\n" + "="*60)
            print("❌ MIGRATION FAILED!")
            print("="*60 + "\n")
            sys.exit(1)
        
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)
