#!/usr/bin/env python3
"""
Migration script to add testbed_label column to workloads table
"""

import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

def run_migration():
    """Add testbed_label column to workloads table"""
    
    # Get database URL from environment
    DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://alertuser:alertpass@localhost/alerts')
    
    try:
        # Create engine
        engine = create_engine(DATABASE_URL)
        
        # Add the new column
        with engine.connect() as conn:
            # Check if column already exists
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='workloads' AND column_name='testbed_label'
            """))
            
            if result.fetchone() is None:
                print("Adding testbed_label column to workloads table...")
                conn.execute(text("""
                    ALTER TABLE workloads 
                    ADD COLUMN testbed_label VARCHAR(255)
                """))
                
                # Add index for better performance
                conn.execute(text("""
                    CREATE INDEX idx_workloads_testbed_label 
                    ON workloads(testbed_label)
                """))
                
                conn.commit()
                print("✅ Successfully added testbed_label column and index to workloads table")
            else:
                print("✅ testbed_label column already exists in workloads table")
                
    except SQLAlchemyError as e:
        print(f"❌ Database migration failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    print("🔄 Running migration: Add testbed_label to workloads table")
    run_migration()
    print("✅ Migration completed successfully")
