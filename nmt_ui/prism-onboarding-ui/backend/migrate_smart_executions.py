"""
Migration script to create smart_executions table
"""
import psycopg2
from psycopg2 import sql
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_smart_executions():
    """Create smart_executions table if it doesn't exist"""
    try:
        # Database connection parameters
        conn = psycopg2.connect(
            dbname="alerts",
            user="alertuser",
            password="alertpass",
            host="localhost",
            port=5432
        )
        cursor = conn.cursor()
        
        # Check if table already exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name='smart_executions'
            );
        """)
        
        table_exists = cursor.fetchone()[0]
        
        if not table_exists:
            logger.info("Creating smart_executions table...")
            
            cursor.execute("""
                CREATE TABLE smart_executions (
                    id SERIAL PRIMARY KEY,
                    execution_id VARCHAR(128) UNIQUE NOT NULL,
                    testbed_id VARCHAR(128) NOT NULL,
                    testbed_label VARCHAR(255),
                    
                    status VARCHAR(50) NOT NULL DEFAULT 'RUNNING',
                    is_running BOOLEAN DEFAULT TRUE,
                    
                    start_time TIMESTAMP NOT NULL DEFAULT NOW(),
                    end_time TIMESTAMP,
                    duration_minutes FLOAT,
                    
                    target_config JSONB NOT NULL,
                    entities_config JSONB NOT NULL,
                    
                    baseline_metrics JSONB,
                    final_metrics JSONB,
                    metrics_history JSONB,
                    
                    total_operations INTEGER DEFAULT 0,
                    successful_operations INTEGER DEFAULT 0,
                    failed_operations INTEGER DEFAULT 0,
                    success_rate FLOAT DEFAULT 0.0,
                    operations_per_minute FLOAT DEFAULT 0.0,
                    operations_history JSONB,
                    
                    threshold_reached BOOLEAN DEFAULT FALSE,
                    created_entities JSONB,
                    entity_breakdown JSONB,
                    resource_summary JSONB,
                    
                    execution_mode VARCHAR(50),
                    cluster_name VARCHAR(255),
                    cluster_uuid VARCHAR(128),
                    
                    report_generated BOOLEAN DEFAULT FALSE,
                    report_html_path VARCHAR(512),
                    
                    alert_generated BOOLEAN DEFAULT FALSE,
                    alert_sent_slack BOOLEAN DEFAULT FALSE,
                    alert_timestamp TIMESTAMP,
                    
                    full_execution_data JSONB
                );
                
                CREATE INDEX idx_smart_executions_execution_id ON smart_executions(execution_id);
                CREATE INDEX idx_smart_executions_testbed_id ON smart_executions(testbed_id);
                CREATE INDEX idx_smart_executions_status ON smart_executions(status);
                CREATE INDEX idx_smart_executions_start_time ON smart_executions(start_time DESC);
            """)
            
            conn.commit()
            logger.info("✅ Successfully created smart_executions table with indexes")
        else:
            logger.info("✅ smart_executions table already exists")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        logger.error(f"❌ Error during migration: {e}")
        raise

if __name__ == "__main__":
    logger.info("🔄 Running migration: Create smart_executions table")
    try:
        migrate_smart_executions()
        logger.info("✅ Migration completed successfully")
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        exit(1)
