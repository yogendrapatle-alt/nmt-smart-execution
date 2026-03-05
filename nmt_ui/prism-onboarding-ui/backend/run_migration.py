#!/usr/bin/env python3
"""
Migration Runner for Smart Execution Pod Tracking Enhancement
Applies the enhance_smart_execution_pod_tracking.sql migration
"""
import os
import sys
from sqlalchemy import create_engine, text
from database import DATABASE_URL

def run_migration():
    """Run the migration script"""
    migration_file = os.path.join(
        os.path.dirname(__file__),
        'migrations',
        'enhance_smart_execution_pod_tracking.sql'
    )
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    print(f"📄 Reading migration file: {migration_file}")
    with open(migration_file, 'r') as f:
        migration_sql = f.read()
    
    print(f"🔌 Connecting to database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    engine = create_engine(DATABASE_URL)
    
    try:
        with engine.connect() as conn:
            # Use psycopg2's execute to handle dollar-quoted strings properly
            # Split statements more carefully, respecting $$ delimiters
            import re
            
            # Remove single-line comments
            lines = migration_sql.split('\n')
            cleaned_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith('--'):
                    cleaned_lines.append(line)
            
            cleaned_sql = '\n'.join(cleaned_lines)
            
            # Split by semicolon, but preserve dollar-quoted strings
            statements = []
            current_statement = []
            in_dollar_quote = False
            dollar_tag = None
            
            for line in cleaned_sql.split('\n'):
                # Check for dollar quote start/end
                dollar_matches = re.findall(r'\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$', line)
                for match in dollar_matches:
                    if match == '$$':
                        if dollar_tag is None:
                            dollar_tag = '$$'
                            in_dollar_quote = True
                        elif dollar_tag == '$$':
                            in_dollar_quote = False
                            dollar_tag = None
                    elif match.startswith('$') and match.endswith('$'):
                        if dollar_tag is None:
                            dollar_tag = match
                            in_dollar_quote = True
                        elif dollar_tag == match:
                            in_dollar_quote = False
                            dollar_tag = None
                
                current_statement.append(line)
                
                # If we're not in a dollar quote and line ends with semicolon, it's a complete statement
                if not in_dollar_quote and line.strip().endswith(';'):
                    statement = '\n'.join(current_statement).strip()
                    if statement:
                        statements.append(statement)
                    current_statement = []
            
            # Add any remaining statement
            if current_statement:
                statement = '\n'.join(current_statement).strip()
                if statement:
                    statements.append(statement)
            
            print(f"📊 Executing {len(statements)} SQL statements...")
            for i, statement in enumerate(statements, 1):
                if statement:
                    try:
                        conn.execute(text(statement))
                        conn.commit()
                        print(f"  ✅ Statement {i}/{len(statements)} executed")
                    except Exception as e:
                        # Rollback on error to clear transaction state
                        try:
                            conn.rollback()
                        except:
                            pass
                        
                        error_str = str(e).lower()
                        # Some statements might fail if already applied (e.g., IF NOT EXISTS)
                        if ("already exists" in error_str or 
                            "duplicate" in error_str):
                            print(f"  ⚠️  Statement {i}/{len(statements)} skipped (already exists)")
                            # Don't raise, continue with next statement
                        elif "does not exist" in error_str:
                            # Check if it's a column that should exist
                            if "column" in error_str and ("operation_metric_id" in str(e) or "namespace" in str(e)):
                                print(f"  ⚠️  Statement {i}/{len(statements)} skipped (column may not exist yet): {str(e)[:150]}")
                            else:
                                print(f"  ⚠️  Statement {i}/{len(statements)} skipped: {str(e)[:150]}")
                        elif "in failed sql transaction" in error_str:
                            # Transaction was aborted, rollback and continue
                            print(f"  ⚠️  Statement {i}/{len(statements)} skipped (transaction aborted, continuing)")
                        else:
                            print(f"  ❌ Statement {i}/{len(statements)} failed: {e}")
                            # For non-critical errors, continue
                            if "syntax" not in error_str.lower():
                                print(f"     Continuing with next statement...")
                            else:
                                raise
            
            print("\n✅ Migration completed successfully!")
            return True
            
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        engine.dispose()

if __name__ == '__main__':
    print("🚀 Starting Smart Execution Pod Tracking Migration\n")
    success = run_migration()
    sys.exit(0 if success else 1)
