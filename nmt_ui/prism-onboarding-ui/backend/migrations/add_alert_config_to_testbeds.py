"""
Database Migration: Add alert_config to testbeds table

Adds alert_config JSON field to testbeds table for storing
Slack, Email, and Webhook notification configurations.

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


def add_alert_config_to_testbeds():
    """Add alert_config column to testbeds table"""
    
    logger.info("\n🚀 Starting alert_config migration...")
    
    session = SessionLocal()
    engine = create_engine(DATABASE_URL)
    
    try:
        # Check if column exists
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('testbeds')]
        
        if 'alert_config' in columns:
            logger.info("  ✓ Column 'alert_config' already exists - skipping")
            return True
        
        logger.info("  + Adding column 'alert_config' to 'testbeds' table...")
        
        # Add column
        session.execute(text("""
            ALTER TABLE testbeds 
            ADD COLUMN alert_config JSON
        """))
        session.commit()
        
        logger.info("  ✅ Column 'alert_config' added successfully")
        
        logger.info("\n" + "="*60)
        logger.info("✅ Migration completed successfully!")
        logger.info("="*60)
        logger.info("\nThe testbeds table now supports alert notifications for:")
        logger.info("  📱 Slack (via webhooks)")
        logger.info("  📧 Email (via SMTP)")
        logger.info("  🔗 Webhooks (custom endpoints)")
        logger.info("="*60 + "\n")
        
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
    print("║" + "  ALERT CONFIG MIGRATION".center(58) + "║")
    print("║" + " "*58 + "║")
    print("╚" + "="*58 + "╝\n")
    
    try:
        success = add_alert_config_to_testbeds()
        
        if success:
            print("\n" + "="*60)
            print("✅ MIGRATION COMPLETE!")
            print("="*60)
            print("\nNext steps:")
            print("1. Configure alerts for a testbed:")
            print("   PUT /api/alerts/config/{testbed_id}")
            print("\n2. Test alerts:")
            print("   POST /api/alerts/test")
            print("\n3. Alerts will be sent automatically when:")
            print("   - Smart Execution completes")
            print("   - Smart Execution fails")
            print("   - Scheduled Execution triggers")
            print("="*60 + "\n")
        else:
            print("\n" + "="*60)
            print("❌ MIGRATION FAILED!")
            print("="*60 + "\n")
            sys.exit(1)
        
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)
