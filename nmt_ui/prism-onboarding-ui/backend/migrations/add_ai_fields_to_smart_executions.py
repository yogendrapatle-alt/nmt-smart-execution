"""
Database Migration: Add AI/ML Fields to Smart Executions Table

This migration ensures all AI-related fields exist in the smart_executions table.
Safe to run multiple times (uses IF NOT EXISTS).

Fields added:
- ai_enabled: Boolean flag for AI control
- ai_settings: JSON for PID tuning, ML config
- ml_stats: JSON for ML model performance
- pid_stats: JSON for PID controller data
- training_data_collected: Count of training samples
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


def check_column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table"""
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def add_ai_fields():
    """Add AI/ML fields to smart_executions table"""
    
    logger.info("🚀 Starting AI fields migration for smart_executions table...")
    
    session = SessionLocal()
    
    try:
        # Check if table exists
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        if 'smart_executions' not in tables:
            logger.warning("⚠️  smart_executions table does not exist. Skipping migration.")
            return
        
        logger.info("✓ smart_executions table found")
        
        # Define fields to add
        fields_to_add = [
            {
                'name': 'ai_enabled',
                'definition': 'BOOLEAN DEFAULT FALSE',
                'description': 'Whether AI control is enabled'
            },
            {
                'name': 'ai_settings',
                'definition': 'JSON',
                'description': 'AI configuration (PID tuning, ML settings)'
            },
            {
                'name': 'ml_stats',
                'definition': 'JSON',
                'description': 'ML model statistics (R², MAE, feature importance)'
            },
            {
                'name': 'pid_stats',
                'definition': 'JSON',
                'description': 'PID controller performance data'
            },
            {
                'name': 'training_data_collected',
                'definition': 'INTEGER DEFAULT 0',
                'description': 'Number of training samples collected'
            }
        ]
        
        # Check and add each field
        added_count = 0
        skipped_count = 0
        
        for field in fields_to_add:
            column_name = field['name']
            
            if check_column_exists('smart_executions', column_name):
                logger.info(f"  ✓ Column '{column_name}' already exists - skipping")
                skipped_count += 1
            else:
                logger.info(f"  + Adding column '{column_name}' ({field['description']})")
                
                # Use raw SQL for ALTER TABLE
                sql = text(f"""
                    ALTER TABLE smart_executions
                    ADD COLUMN {column_name} {field['definition']}
                """)
                
                session.execute(sql)
                session.commit()
                
                logger.info(f"  ✅ Column '{column_name}' added successfully")
                added_count += 1
        
        # Create indexes for better query performance
        logger.info("\n📊 Creating indexes...")
        
        # Check if indexes exist
        indexes = inspector.get_indexes('smart_executions')
        index_names = [idx['name'] for idx in indexes]
        
        if 'idx_ai_enabled' not in index_names:
            try:
                session.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_ai_enabled 
                    ON smart_executions(ai_enabled)
                """))
                session.commit()
                logger.info("  ✅ Index 'idx_ai_enabled' created")
            except Exception as e:
                logger.warning(f"  ⚠️  Could not create index idx_ai_enabled: {e}")
        else:
            logger.info("  ✓ Index 'idx_ai_enabled' already exists")
        
        # Summary
        logger.info("\n" + "="*60)
        logger.info("📊 MIGRATION SUMMARY")
        logger.info("="*60)
        logger.info(f"  Fields already present: {skipped_count}")
        logger.info(f"  Fields added:          {added_count}")
        logger.info(f"  Total AI fields:       {len(fields_to_add)}")
        logger.info("="*60)
        
        if added_count > 0:
            logger.info("✅ Migration completed successfully!")
        else:
            logger.info("✅ No changes needed - database already up to date!")
        
        # Verify all fields exist
        logger.info("\n🔍 Verifying all AI fields...")
        all_exist = True
        for field in fields_to_add:
            exists = check_column_exists('smart_executions', field['name'])
            status = "✓" if exists else "✗"
            logger.info(f"  {status} {field['name']}")
            if not exists:
                all_exist = False
        
        if all_exist:
            logger.info("\n✅ All AI fields verified successfully!")
        else:
            logger.error("\n❌ Some fields are missing. Please check the logs.")
            
    except Exception as e:
        logger.error(f"\n❌ Migration failed: {e}")
        logger.exception(e)
        session.rollback()
        raise
        
    finally:
        session.close()


def show_ai_field_usage():
    """Show example of how to use the AI fields"""
    
    logger.info("\n" + "="*60)
    logger.info("📚 HOW TO USE AI FIELDS")
    logger.info("="*60)
    
    example = """
    
Example 1: Creating an AI-enabled execution
───────────────────────────────────────────

from models.smart_execution import SmartExecution

execution = SmartExecution(
    execution_id='AI-EXEC-001',
    testbed_id='test-123',
    target_config={'cpu_threshold': 80, 'memory_threshold': 75},
    entities_config={'vm': ['CREATE', 'DELETE']},
    
    # AI fields
    ai_enabled=True,
    ai_settings={
        'enable_ai': True,
        'enable_ml': True,
        'data_collection': True,
        'pid_tuning': {
            'cpu_kp': 2.5,
            'cpu_ki': 0.12,
            'cpu_kd': 0.6
        }
    }
)

session.add(execution)
session.commit()


Example 2: Updating with AI stats after execution
──────────────────────────────────────────────────

execution.pid_stats = {
    'final_operations_per_minute': 45.2,
    'final_phase': 'maintain',
    'total_iterations': 15,
    'cpu_pid': {
        'Kp': 2.5,
        'Ki': 0.12,
        'Kd': 0.6,
        'avg_error': 2.3
    }
}

execution.ml_stats = {
    'model_trained': True,
    'training_samples': 120,
    'cpu_model_r2': 0.724,
    'memory_model_r2': 0.527,
    'feature_importance': {...}
}

execution.training_data_collected = 120

session.commit()


Example 3: Querying AI executions
──────────────────────────────────

# Get all AI-enabled executions
ai_executions = session.query(SmartExecution)\\
    .filter(SmartExecution.ai_enabled == True)\\
    .all()

# Get executions with trained ML models
ml_trained = session.query(SmartExecution)\\
    .filter(SmartExecution.ml_stats['model_trained'].astext == 'true')\\
    .all()

# Get high-performance executions
good_executions = session.query(SmartExecution)\\
    .filter(SmartExecution.ml_stats['cpu_model_r2'].astext.cast(Float) > 0.7)\\
    .all()

    """
    
    print(example)


if __name__ == '__main__':
    print("\n" + "╔" + "="*58 + "╗")
    print("║" + " "*58 + "║")
    print("║" + "  AI/ML FIELDS MIGRATION FOR SMART EXECUTIONS".center(58) + "║")
    print("║" + " "*58 + "║")
    print("╚" + "="*58 + "╝\n")
    
    try:
        add_ai_fields()
        show_ai_field_usage()
        
        print("\n" + "="*60)
        print("✅ MIGRATION COMPLETE!")
        print("="*60)
        print("\nYou can now use AI fields in your Smart Execution system.")
        print("The database is ready for AI-powered executions! 🚀\n")
        
    except Exception as e:
        print("\n" + "="*60)
        print("❌ MIGRATION FAILED!")
        print("="*60)
        print(f"\nError: {e}\n")
        sys.exit(1)
