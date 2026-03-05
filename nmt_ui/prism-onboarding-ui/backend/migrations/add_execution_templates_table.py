"""
Phase 3: Migration script to create execution_templates table
"""
import sys
import os

# Add backend to path
backend_path = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, backend_path)

from database import SessionLocal, engine
from models.execution_template import ExecutionTemplate

def migrate_execution_templates():
    """Create execution_templates table"""
    try:
        # Create table
        ExecutionTemplate.__table__.create(engine, checkfirst=True)
        print("✅ Execution templates table created successfully")
        return True
    except Exception as e:
        print(f"❌ Error creating execution templates table: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    migrate_execution_templates()
