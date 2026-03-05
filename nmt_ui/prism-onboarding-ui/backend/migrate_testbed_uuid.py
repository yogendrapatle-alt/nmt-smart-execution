#!/usr/bin/env python3
"""
Migration script to make the uuid column nullable in the testbeds table.
This is a temporary change until ncm_utils.py is implemented in TestbedConfiguration.tsx
"""

import os
import sys
from sqlalchemy import create_engine, text
from database import DATABASE_URL

def migrate_testbed_uuid_nullable():
    """Make the uuid column nullable in the testbeds table"""
    engine = create_engine(DATABASE_URL, echo=True)
    
    try:
        with engine.connect() as connection:
            # Start a transaction
            trans = connection.begin()
            
            try:
                print("Making uuid column nullable in testbeds table...")
                
                # PostgreSQL syntax to alter column to allow NULL
                alter_sql = "ALTER TABLE testbeds ALTER COLUMN uuid DROP NOT NULL;"
                connection.execute(text(alter_sql))
                
                print("✅ Successfully made uuid column nullable")
                
                # Commit the transaction
                trans.commit()
                print("✅ Migration completed successfully")
                
            except Exception as e:
                # Rollback on error
                trans.rollback()
                print(f"❌ Migration failed: {e}")
                raise
                
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate_testbed_uuid_nullable()
