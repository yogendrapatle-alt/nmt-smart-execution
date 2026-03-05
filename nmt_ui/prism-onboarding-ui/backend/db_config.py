"""
Database connection utility with auto-configuration support
"""
import os
import psycopg2
from typing import Optional

def get_database_config():
    """
    Get database configuration with auto-detection fallback
    """
    # Try to load from auto-config first
    try:
        from auto_config import load_config_file
        config = load_config_file()
        if config and 'database' in config:
            db_config = config['database']
            return {
                'host': db_config['host'],
                'port': db_config['port'],
                'dbname': db_config['dbname'],
                'user': db_config['user'],
                'password': db_config['password']
            }
    except ImportError:
        pass
    
    # Fallback to environment variables
    db_config = {
        'host': os.environ.get('DATABASE_HOST', 'localhost'),
        'port': os.environ.get('DATABASE_PORT', '5432'),
        'dbname': os.environ.get('DATABASE_NAME', 'alerts'),
        'user': os.environ.get('DATABASE_USER', 'alertuser'),
        'password': os.environ.get('DATABASE_PASSWORD', 'alertpass')
    }
    
    return db_config

def get_database_connection():
    """
    Get database connection using auto-detected configuration
    """
    config = get_database_config()
    
    try:
        conn = psycopg2.connect(**config)
        return conn
    except psycopg2.Error as e:
        print(f"Database connection error: {e}")
        print(f"Attempted connection to: {config['host']}:{config['port']}")
        raise

def test_database_connection() -> bool:
    """
    Test database connection
    """
    try:
        conn = get_database_connection()
        conn.close()
        return True
    except Exception:
        return False
