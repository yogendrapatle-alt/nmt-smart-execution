#!/usr/bin/env python3
"""
Database migration script to ensure workloads and testbeds tables are created
and pc_ip columns are nullable.
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from database import init_db, engine
from sqlalchemy import text

def run_migration():
    """Run database migration to update schema"""
    print("Starting database migration...")
    
    try:
        # Create all tables (including new workloads and testbeds)
        init_db()
        print("✓ All tables created/updated successfully")
        
        # Update existing tables to make pc_ip nullable if they already exist
        with engine.connect() as conn:
            try:
                # Check if workloads table exists and update pc_ip to nullable
                result = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = 'workloads'
                    );
                """))
                if result.scalar():
                    conn.execute(text("ALTER TABLE workloads ALTER COLUMN pc_ip DROP NOT NULL;"))
                    print("✓ Updated workloads.pc_ip to nullable")
            except Exception as e:
                print(f"Note: Could not update workloads.pc_ip: {e}")
            
            try:
                # Check if testbeds table exists and update pc_ip to nullable
                result = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = 'testbeds'
                    );
                """))
                if result.scalar():
                    conn.execute(text("ALTER TABLE testbeds ALTER COLUMN pc_ip DROP NOT NULL;"))
                    print("✓ Updated testbeds.pc_ip to nullable")
            except Exception as e:
                print(f"Note: Could not update testbeds.pc_ip: {e}")
            
            conn.commit()
        
        print("✓ Database migration completed successfully!")
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        return False
    
    return True

if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1)
