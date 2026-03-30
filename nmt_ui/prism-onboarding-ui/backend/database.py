
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import os
import logging
import json
from datetime import datetime

# Import the Alert model

# Import the Config model
from models.config import Config, Base

# Import the EmailSchedule model
from models.email_schedule import EmailSchedule

# Import the Workload model
from models.workload import Workload

# Import the Testbed model
from models.testbed import Testbed

# Import the SmartExecution model
from models.smart_execution import SmartExecution

# Use 127.0.0.1 (not localhost) so libpq uses TCP + md5/pg_hba "host" rules; "localhost" can use ::1 or socket.
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://alertuser:alertpass@127.0.0.1:5432/alerts',
)

# Connection Pool Configuration
# These settings prevent connection exhaustion and improve performance under load
POOL_SIZE = int(os.environ.get('DB_POOL_SIZE', 10))  # Number of connections to maintain in pool
POOL_MAX_OVERFLOW = int(os.environ.get('DB_POOL_MAX_OVERFLOW', 20))  # Max connections above pool_size
POOL_TIMEOUT = int(os.environ.get('DB_POOL_TIMEOUT', 30))  # Seconds to wait for available connection
POOL_RECYCLE = int(os.environ.get('DB_POOL_RECYCLE', 3600))  # Recycle connections after 1 hour
POOL_PRE_PING = os.environ.get('DB_POOL_PRE_PING', 'True').lower() == 'true'  # Test connections before use

# Create engine with connection pooling
# Benefits:
# - Reuses connections instead of creating new ones for each request
# - Prevents connection exhaustion under load
# - Auto-recovery from stale connections (pool_pre_ping)
# - Connection recycling prevents long-lived connection issues
engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=POOL_SIZE,
    max_overflow=POOL_MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    pool_recycle=POOL_RECYCLE,
    pool_pre_ping=POOL_PRE_PING,
    # Additional optimizations
    pool_use_lifo=True,  # Use LIFO to prefer warm connections
    connect_args={
        'connect_timeout': 10,  # TCP connection timeout
        'options': '-c statement_timeout=30000'  # Query timeout (30 seconds)
    }
)

logging.info(f"📊 Database connection pool initialized: size={POOL_SIZE}, max_overflow={POOL_MAX_OVERFLOW}, recycle={POOL_RECYCLE}s")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    """Create all tables in the database."""
    Base.metadata.create_all(bind=engine)




# --- Config DB functions ---
def save_config_to_db(db_session,unique_rule_id,unique_testbed_id, pc_ip, config_json):
    """
    Save a config JSON to the database for a given PC-IP.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    config_json: dict (the config JSON)
    """
    from datetime import datetime
    config = Config(
        unique_rule_id=unique_rule_id,
        unique_testbed_id = unique_testbed_id,
        pc_ip=pc_ip or "0.0.0.0",
        timestamp=datetime.utcnow(),
        config_json=config_json
    )
    db_session.add(config)
    db_session.commit()

def fetch_latest_config_for_pc_ip(db_session, pc_ip):
    """
    Fetch the latest config for a given PC-IP from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    Returns: Config instance or None
    """
    return (
        db_session.query(Config)
        .filter_by(pc_ip=pc_ip)
        .order_by(Config.timestamp.desc())
        .first()
    )

def fetch_latest_config_for_testbed(db_session, unique_testbed_id):
    """
    Fetch the latest config for a given unique_testbed_id from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    unique_testbed_id: string
    Returns: Config instance or None
    """
    return (
        db_session.query(Config)
        .filter_by(unique_testbed_id=unique_testbed_id)
        .order_by(Config.timestamp.desc())
        .first()
    )

# --- Workload DB functions ---
def save_workload_to_db(db_session,unique_workload_id, unique_rule_id,unique_testbed_id, pc_ip, uuid, workload_label, workload_json, testbed_label=None):
    """
    Save a workload JSON to the database.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    uuid: string
    workload_label: string
    workload_json: dict (the workload JSON)
    testbed_label: string (optional, to associate workload with a testbed)
    """
    from datetime import datetime
    workload = Workload(
        unique_workload_id= unique_workload_id,
        unique_rule_id = unique_rule_id,
        pc_ip=pc_ip,
        uuid=uuid or "no-uuid",
        workload_label=workload_label,
        testbed_label=testbed_label,
        unique_testbed_id = unique_testbed_id,
        timestamp=datetime.utcnow(),
        workload_json=workload_json
    )
    db_session.add(workload)
    db_session.commit()
    return workload

def fetch_workloads_by_pc_ip(db_session, pc_ip):
    """
    Fetch all workloads for a given PC-IP from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    Returns: List of Workload instances
    """
    return (
        db_session.query(Workload)
        .filter_by(pc_ip=pc_ip)
        .order_by(Workload.timestamp.desc())
        .all()
    )

def fetch_workload_by_uuid(db_session, uuid):
    """
    Fetch a specific workload by UUID from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    uuid: string
    Returns: Workload instance or None
    """
    return (
        db_session.query(Workload)
        .filter_by(uuid=uuid)
        .first()
    )

def fetch_workloads_by_label(db_session, workload_label):
    """
    Fetch all workloads with a specific label from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    workload_label: string
    Returns: List of Workload instances
    """
    return (
        db_session.query(Workload)
        .filter_by(workload_label=workload_label)
        .order_by(Workload.timestamp.desc())
        .all()
    )

def fetch_all_workload_labels(db_session):
    """
    Fetch all unique workload labels from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    Returns: List of unique workload labels
    """
    result = db_session.query(Workload.workload_label).distinct().all()
    return [label[0] for label in result]

#def fetch_latest_workload_by_label(db_session, workload_label):
#    """
#    Fetch the latest workload for a given label from the database.
#    db_session: SQLAlchemy session (e.g., g.db)
#    workload_label: string
#    Returns: Workload instance or None
#    """
#    return (
#        db_session.query(Workload)
#        .filter_by(workload_label=workload_label)
#        .order_by(Workload.timestamp.desc())
#        .first()
#    )
def fetch_latest_workload_by_label(db, workload_label):
    return (
        db.query(Workload)
        .filter_by(workload_label=workload_label)
        .order_by(Workload.timestamp.desc())
        .first()
    )

def fetch_workloads_by_testbed_label(db_session, testbed_label):
    """
    Fetch all workloads associated with a specific testbed label.
    db_session: SQLAlchemy session (e.g., g.db)
    testbed_label: string
    Returns: List of Workload instances
    """
    return (
        db_session.query(Workload)
        .filter_by(testbed_label=testbed_label)
        .order_by(Workload.timestamp.desc())
        .all()
    )

def fetch_latest_workload_by_testbed_label(db_session, testbed_label):
    """
    Fetch the latest workload for a given testbed label from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    testbed_label: string
    Returns: Workload instance or None
    """
    return (
        db_session.query(Workload)
        .filter_by(testbed_label=testbed_label)
        .order_by(Workload.timestamp.desc())
        .first()
    )

# --- Testbed DB functions ---
def save_testbed_to_db(db_session,unique_testbed_id, pc_ip, uuid, testbed_label, testbed_json, testbed_filepath, 
                      status_filepath=None, ncm_ip=None, username=None, password=None, 
                      pc_deployment=None, ncm_deployment=None, remote_pc_deployment=None):
    """
    Save a testbed JSON to the database.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    uuid: string
    testbed_label: string
    testbed_json: dict (the testbed JSON)
    testbed_filepath: string (path to the stored JSON file)
    status_filepath: string (path to status file, None before deployment)
    ncm_ip: string (NCM IP address, None before deployment)
    username: string (username for deployment, None before deployment)
    password: string (password for deployment, None before deployment)
    pc_deployment: string (PC deployment status/info, None before deployment)
    ncm_deployment: string (NCM deployment status/info, None before deployment)
    remote_pc_deployment: string (Remote PC deployment status/info, None before deployment)
    
    Note: New fields are marked as None before deployment and will be updated by jita_main.py after deployment
    """
    from datetime import datetime
    testbed = Testbed(
        unique_testbed_id=unique_testbed_id,
        pc_ip=pc_ip,
        uuid=uuid,
        testbed_label=testbed_label,
        timestamp=datetime.utcnow(),
        testbed_json=testbed_json,
        testbed_filepath=testbed_filepath,
        status_filepath=status_filepath,
        ncm_ip=ncm_ip,
        username=username,
        password=password,
        pc_deployment=pc_deployment,
        ncm_deployment=ncm_deployment,
        remote_pc_deployment=remote_pc_deployment
    )
    db_session.add(testbed)
    db_session.commit()
    return testbed

def fetch_testbeds_by_pc_ip(db_session, pc_ip):
    """
    Fetch all testbeds for a given PC-IP from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    pc_ip: string
    Returns: List of Testbed instances
    """
    return (
        db_session.query(Testbed)
        .filter_by(pc_ip=pc_ip)
        .order_by(Testbed.timestamp.desc())
        .all()
    )

def fetch_testbed_by_uuid(db_session, uuid):
    """
    Fetch a specific testbed by UUID from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    uuid: string
    Returns: Testbed instance or None
    """
    return (
        db_session.query(Testbed)
        .filter_by(uuid=uuid)
        .first()
    )

def fetch_latest_workload_by_unique_testbed_id(db, unique_testbed_id):
    """
    Fetch the latest workload entry for a given unique_testbed_id
    """
    # Assuming `Workload` is your ORM model for workloads table
    try:
        workload = (
            db.query(Workload)
            .filter(Workload.unique_testbed_id == str(unique_testbed_id))  # <-- cast UUID to str
            .order_by(Workload.timestamp.desc())  # get the latest
            .first()
        )
        return workload
    except Exception as e:
        import logging
        logging.error(f"Error fetching workload for unique_testbed_id {unique_testbed_id}: {e}")
        return None

def fetch_testbeds_by_label(db_session, testbed_label):
    """
    Fetch all testbeds with a specific label from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    testbed_label: string
    Returns: List of Testbed instances
    """
    return (
        db_session.query(Testbed)
        .filter_by(testbed_label=testbed_label)
        .order_by(Testbed.timestamp.desc())
        .all()
    )

def fetch_all_testbed_labels(db_session):
    """
    Fetch all unique testbed labels from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    Returns: List of unique testbed labels
    """
    result = db_session.query(Testbed.testbed_label).distinct().all()
    return [label[0] for label in result]

def fetch_latest_testbed_by_label(db_session, testbed_label):
    """
    Fetch the latest testbed for a given label from the database.
    db_session: SQLAlchemy session (e.g., g.db)
    testbed_label: string
    Returns: Testbed instance or None
    """
    return (
        db_session.query(Testbed)
        .filter_by(testbed_label=testbed_label)
        .order_by(Testbed.timestamp.desc())
        .first()
    )

def update_testbed_deployment_info(db_session, unique_testbed_id, status_filepath=None, ncm_ip=None, 
                                 username=None, password=None, pc_deployment=None, 
                                 ncm_deployment=None, remote_pc_deployment=None):
    """
    Update testbed deployment information after deployment.
    This function is intended to be called by jita_main.py after deployment.
    
    db_session: SQLAlchemy session
    unique_testbed_id: string - unique identifier for the testbed
    status_filepath: string - path to status file
    ncm_ip: string - NCM IP address
    username: string - username for deployment
    password: string - password for deployment
    pc_deployment: string - PC deployment status/info
    ncm_deployment: string - NCM deployment status/info
    remote_pc_deployment: string - Remote PC deployment status/info
    
    Returns: Updated Testbed instance or None if not found
    """
    try:
        # Find the testbed by unique_testbed_id
        testbed = (
            db_session.query(Testbed)
            .filter_by(unique_testbed_id=unique_testbed_id)
            .first()
        )
        
        if not testbed:
            return None
            
        # Update only the fields that are provided (not None)
        if status_filepath is not None:
            testbed.status_filepath = status_filepath
        if ncm_ip is not None:
            testbed.ncm_ip = ncm_ip
        if username is not None:
            testbed.username = username
        if password is not None:
            testbed.password = password
        if pc_deployment is not None:
            testbed.pc_deployment = pc_deployment
        if ncm_deployment is not None:
            testbed.ncm_deployment = ncm_deployment
        if remote_pc_deployment is not None:
            testbed.remote_pc_deployment = remote_pc_deployment
            
        db_session.commit()
        return testbed
        
    except Exception as e:
        db_session.rollback()
        raise e

def fetch_testbed_by_unique_id(db_session, unique_testbed_id):
    """
    Fetch a testbed by its unique_testbed_id.
    db_session: SQLAlchemy session
    unique_testbed_id: string
    Returns: Testbed instance or None
    """
    return (
        db_session.query(Testbed)
        .filter_by(unique_testbed_id=unique_testbed_id)
        .first()
    )
def save_env_run_to_db():
    pass
def fetch_env_run_by_uuid():
    pass
def save_dynamic_workload_to_db():
    pass
def fetch_dynamic_workloads_by_uuid():
    pass


# --- Execution DB functions ---
def create_execution_record(execution_id, testbed_id, status='PENDING', config=None):
    """
    Create a new execution record in the database.
    
    Args:
        execution_id (str): Unique execution identifier
        testbed_id (str): Associated testbed UUID
        status (str): Initial status (default: PENDING)
        config (dict): Execution configuration
    
    Returns:
        dict: Created execution record
    """
    session = SessionLocal()
    try:
        query = text("""
            INSERT INTO executions (
                execution_id, testbed_id, status, progress,
                completed_operations, total_operations,
                successful_operations, failed_operations,
                start_time, config, created_at, updated_at
            ) VALUES (
                :execution_id, :testbed_id, :status, 0,
                0, 0, 0, 0,
                CURRENT_TIMESTAMP, :config, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        """)
        
        result = session.execute(query, {
            'execution_id': execution_id,
            'testbed_id': testbed_id,
            'status': status,
            'config': json.dumps(config) if config else None
        })
        session.commit()
        
        row = result.fetchone()
        if row:
            return dict(row._mapping)
        return None
    except Exception as e:
        session.rollback()
        logging.error(f"Error creating execution record: {e}")
        raise
    finally:
        session.close()


def update_execution_status(execution_id, status=None, progress=None, 
                           completed_ops=None, total_ops=None,
                           successful_ops=None, failed_ops=None,
                           last_error=None, end_time=None):
    """
    Update execution status and statistics.
    
    Args:
        execution_id (str): Execution identifier
        status (str): New status
        progress (int): Progress percentage (0-100)
        completed_ops (int): Completed operations count
        total_ops (int): Total operations count
        successful_ops (int): Successful operations count
        failed_ops (int): Failed operations count
        last_error (str): Last error message
        end_time (datetime): Execution end time
    
    Returns:
        dict: Updated execution record
    """
    session = SessionLocal()
    try:
        # Build dynamic update query
        updates = []
        params = {'execution_id': execution_id}
        
        if status is not None:
            updates.append("status = :status")
            params['status'] = status
        
        if progress is not None:
            updates.append("progress = :progress")
            params['progress'] = progress
        
        if completed_ops is not None:
            updates.append("completed_operations = :completed_ops")
            params['completed_ops'] = completed_ops
        
        if total_ops is not None:
            updates.append("total_operations = :total_ops")
            params['total_ops'] = total_ops
        
        if successful_ops is not None:
            updates.append("successful_operations = :successful_ops")
            params['successful_ops'] = successful_ops
        
        if failed_ops is not None:
            updates.append("failed_operations = :failed_ops")
            params['failed_ops'] = failed_ops
        
        if last_error is not None:
            updates.append("last_error = :last_error")
            params['last_error'] = last_error
        
        if end_time is not None:
            updates.append("end_time = :end_time")
            params['end_time'] = end_time
        
        if not updates:
            return get_execution_by_id(execution_id)
        
        query = text(f"""
            UPDATE executions
            SET {', '.join(updates)}
            WHERE execution_id = :execution_id
            RETURNING *
        """)
        
        result = session.execute(query, params)
        session.commit()
        
        row = result.fetchone()
        if row:
            return dict(row._mapping)
        return None
    except Exception as e:
        session.rollback()
        logging.error(f"Error updating execution status: {e}")
        raise
    finally:
        session.close()


def get_execution_by_id(execution_id):
    """
    Get execution record by ID.
    
    Args:
        execution_id (str): Execution identifier
    
    Returns:
        dict: Execution record or None
    """
    session = SessionLocal()
    try:
        query = text("""
            SELECT * FROM executions
            WHERE execution_id = :execution_id
        """)
        
        result = session.execute(query, {'execution_id': execution_id})
        row = result.fetchone()
        
        if row:
            return dict(row._mapping)
        return None
    except Exception as e:
        logging.error(f"Error getting execution by ID: {e}")
        return None
    finally:
        session.close()


def get_executions_by_testbed(testbed_id, limit=50, offset=0):
    """
    Get all executions for a testbed.
    
    Args:
        testbed_id (str): Testbed UUID
        limit (int): Maximum number of records
        offset (int): Offset for pagination
    
    Returns:
        list: List of execution records
    """
    session = SessionLocal()
    try:
        query = text("""
            SELECT * FROM executions
            WHERE testbed_id = :testbed_id
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        
        result = session.execute(query, {
            'testbed_id': testbed_id,
            'limit': limit,
            'offset': offset
        })
        
        return [dict(row._mapping) for row in result.fetchall()]
    except Exception as e:
        logging.error(f"Error getting executions by testbed: {e}")
        return []
    finally:
        session.close()


def get_all_executions(limit=100, offset=0, status_filter=None):
    """
    Get all executions with optional status filter.
    
    Args:
        limit (int): Maximum number of records
        offset (int): Offset for pagination
        status_filter (str): Filter by status (optional)
    
    Returns:
        list: List of execution records
    """
    session = SessionLocal()
    try:
        if status_filter:
            query = text("""
                SELECT * FROM executions
                WHERE status = :status
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """)
            result = session.execute(query, {
                'status': status_filter,
                'limit': limit,
                'offset': offset
            })
        else:
            query = text("""
                SELECT * FROM executions
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """)
            result = session.execute(query, {
                'limit': limit,
                'offset': offset
            })
        
        return [dict(row._mapping) for row in result.fetchall()]
    except Exception as e:
        logging.error(f"Error getting all executions: {e}")
        return []
    finally:
        session.close()


def get_active_executions():
    """
    Get all active (non-terminal) executions.
    
    Returns:
        list: List of active execution records
    """
    session = SessionLocal()
    try:
        query = text("""
            SELECT * FROM executions
            WHERE status IN ('PENDING', 'STARTING', 'RUNNING', 'PAUSED', 'STOPPING')
            ORDER BY created_at DESC
        """)
        
        result = session.execute(query)
        return [dict(row._mapping) for row in result.fetchall()]
    except Exception as e:
        logging.error(f"Error getting active executions: {e}")
        return []
    finally:
        session.close()


def delete_execution_record(execution_id):
    """
    Delete an execution record.
    
    Args:
        execution_id (str): Execution identifier
    
    Returns:
        bool: True if deleted, False otherwise
    """
    session = SessionLocal()
    try:
        query = text("""
            DELETE FROM executions
            WHERE execution_id = :execution_id
        """)
        
        result = session.execute(query, {'execution_id': execution_id})
        session.commit()
        
        return result.rowcount > 0
    except Exception as e:
        session.rollback()
        logging.error(f"Error deleting execution record: {e}")
        return False
    finally:
        session.close()


# ============================================================================
# METRICS AND TIMELINE FUNCTIONS
# ============================================================================

def save_operation_metric(execution_id, testbed_id, entity_type, operation_type,
                         entity_name=None, entity_uuid=None, started_at=None,
                         completed_at=None, status='RUNNING', error_message=None,
                         metrics_snapshot=None, pod_cpu_percent=None,
                         pod_memory_mb=None, pod_network_rx_mbps=None,
                         pod_network_tx_mbps=None, pod_metrics_before=None,
                         pod_metrics_after=None):
    """
    Save an individual operation metric to track entity-level activities
    
    Args:
        execution_id: Execution identifier
        testbed_id: Testbed identifier
        entity_type: Type of entity (vm, project, endpoint, etc.)
        operation_type: Type of operation (create, update, delete, etc.)
        entity_name: Name of the entity
        entity_uuid: UUID of the created/modified entity
        started_at: Operation start time
        completed_at: Operation completion time (optional)
        status: Operation status (RUNNING, COMPLETED, FAILED)
        error_message: Error message if failed
        metrics_snapshot: Full metrics snapshot as JSON
        pod_cpu_percent: CPU usage of pod
        pod_memory_mb: Memory usage of pod in MB
        pod_network_rx_mbps: Network RX rate in Mbps
        pod_network_tx_mbps: Network TX rate in Mbps
        pod_metrics_before: Pod metrics snapshot before operation (JSONB)
        pod_metrics_after: Pod metrics snapshot after operation (JSONB)
        
    Returns:
        int: Operation metric ID if successful, None otherwise
    """
    session = SessionLocal()
    try:
        import json
        
        # Try to insert with pod_metrics_before and pod_metrics_after if columns exist
        try:
            query = text("""
                INSERT INTO operation_metrics (
                    execution_id, testbed_id, entity_type, operation_type,
                    entity_name, entity_uuid, started_at, completed_at,
                    status, error_message, metrics_snapshot,
                    pod_cpu_percent, pod_memory_mb, pod_network_rx_mbps, pod_network_tx_mbps,
                    pod_metrics_before, pod_metrics_after
                ) VALUES (
                    :execution_id, :testbed_id, :entity_type, :operation_type,
                    :entity_name, :entity_uuid, :started_at, :completed_at,
                    :status, :error_message, :metrics_snapshot,
                    :pod_cpu_percent, :pod_memory_mb, :pod_network_rx_mbps, :pod_network_tx_mbps,
                    :pod_metrics_before, :pod_metrics_after
                ) RETURNING id
            """)
            
            result = session.execute(query, {
                'execution_id': execution_id,
                'testbed_id': testbed_id,
                'entity_type': entity_type,
                'operation_type': operation_type,
                'entity_name': entity_name,
                'entity_uuid': entity_uuid,
                'started_at': started_at or datetime.utcnow(),
                'completed_at': completed_at,
                'status': status,
                'error_message': error_message,
                'metrics_snapshot': json.dumps(metrics_snapshot) if metrics_snapshot else None,
                'pod_cpu_percent': pod_cpu_percent,
                'pod_memory_mb': pod_memory_mb,
                'pod_network_rx_mbps': pod_network_rx_mbps,
                'pod_network_tx_mbps': pod_network_tx_mbps,
                'pod_metrics_before': json.dumps(pod_metrics_before) if pod_metrics_before else None,
                'pod_metrics_after': json.dumps(pod_metrics_after) if pod_metrics_after else None
            })
        except Exception as col_error:
            # Fallback if columns don't exist yet
            session.rollback()
            query = text("""
                INSERT INTO operation_metrics (
                    execution_id, testbed_id, entity_type, operation_type,
                    entity_name, entity_uuid, started_at, completed_at,
                    status, error_message, metrics_snapshot,
                    pod_cpu_percent, pod_memory_mb, pod_network_rx_mbps, pod_network_tx_mbps
                ) VALUES (
                    :execution_id, :testbed_id, :entity_type, :operation_type,
                    :entity_name, :entity_uuid, :started_at, :completed_at,
                    :status, :error_message, :metrics_snapshot,
                    :pod_cpu_percent, :pod_memory_mb, :pod_network_rx_mbps, :pod_network_tx_mbps
                ) RETURNING id
            """)
            
            result = session.execute(query, {
                'execution_id': execution_id,
                'testbed_id': testbed_id,
                'entity_type': entity_type,
                'operation_type': operation_type,
                'entity_name': entity_name,
                'entity_uuid': entity_uuid,
                'started_at': started_at or datetime.utcnow(),
                'completed_at': completed_at,
                'status': status,
                'error_message': error_message,
                'metrics_snapshot': json.dumps(metrics_snapshot) if metrics_snapshot else None,
                'pod_cpu_percent': pod_cpu_percent,
                'pod_memory_mb': pod_memory_mb,
                'pod_network_rx_mbps': pod_network_rx_mbps,
                'pod_network_tx_mbps': pod_network_tx_mbps
            })
        
        session.commit()
        row = result.fetchone()
        metric_id = row[0] if row else None
        logging.info(f"Saved operation metric: {entity_type}.{operation_type} (ID: {metric_id})")
        return metric_id
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error saving operation metric: {e}")
        return None
    finally:
        session.close()


def save_pod_operation_correlation(execution_id, smart_execution_id, pod_name, namespace,
                                  node_name=None, entity_type=None, operation_type=None,
                                  entity_name=None, cpu_percent_before=None, memory_mb_before=None,
                                  network_rx_mbps_before=None, network_tx_mbps_before=None,
                                  cpu_percent_after=None, memory_mb_after=None,
                                  network_rx_mbps_after=None, network_tx_mbps_after=None,
                                  correlation_type='affected'):
    """
    Save pod-operation correlation to database
    
    Returns:
        int: Correlation ID if successful, None otherwise
    """
    session = SessionLocal()
    try:
        from sqlalchemy import text
        
        # Calculate deltas
        cpu_delta = (cpu_percent_after or 0) - (cpu_percent_before or 0) if cpu_percent_after is not None and cpu_percent_before is not None else None
        memory_delta = (memory_mb_after or 0) - (memory_mb_before or 0) if memory_mb_after is not None and memory_mb_before is not None else None
        network_rx_delta = (network_rx_mbps_after or 0) - (network_rx_mbps_before or 0) if network_rx_mbps_after is not None and network_rx_mbps_before is not None else None
        network_tx_delta = (network_tx_mbps_after or 0) - (network_tx_mbps_before or 0) if network_tx_mbps_after is not None and network_tx_mbps_before is not None else None
        
        query = text("""
            INSERT INTO pod_operation_correlation (
                execution_id, smart_execution_id, pod_name, namespace, node_name,
                entity_type, operation_type, correlation_type,
                cpu_percent_before, memory_mb_before, network_rx_mbps_before, network_tx_mbps_before,
                cpu_percent_after, memory_mb_after, network_rx_mbps_after, network_tx_mbps_after,
                cpu_delta, memory_delta, network_rx_delta, network_tx_delta
            ) VALUES (
                :execution_id, :smart_execution_id, :pod_name, :namespace, :node_name,
                :entity_type, :operation_type, :correlation_type,
                :cpu_percent_before, :memory_mb_before, :network_rx_mbps_before, :network_tx_mbps_before,
                :cpu_percent_after, :memory_mb_after, :network_rx_mbps_after, :network_tx_mbps_after,
                :cpu_delta, :memory_delta, :network_rx_delta, :network_tx_delta
            ) RETURNING id
        """)
        
        result = session.execute(query, {
            'execution_id': execution_id,
            'smart_execution_id': smart_execution_id,
            'pod_name': pod_name,
            'namespace': namespace,
            'node_name': node_name,
            'entity_type': entity_type,
            'operation_type': operation_type,
            'correlation_type': correlation_type,
            'cpu_percent_before': cpu_percent_before,
            'memory_mb_before': memory_mb_before,
            'network_rx_mbps_before': network_rx_mbps_before,
            'network_tx_mbps_before': network_tx_mbps_before,
            'cpu_percent_after': cpu_percent_after,
            'memory_mb_after': memory_mb_after,
            'network_rx_mbps_after': network_rx_mbps_after,
            'network_tx_mbps_after': network_tx_mbps_after,
            'cpu_delta': cpu_delta,
            'memory_delta': memory_delta,
            'network_rx_delta': network_rx_delta,
            'network_tx_delta': network_tx_delta
        })
        
        session.commit()
        row = result.fetchone()
        correlation_id = row[0] if row else None
        logging.debug(f"Saved pod-operation correlation: {pod_name} ({correlation_id})")
        return correlation_id
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error saving pod-operation correlation: {e}")
        return None
    finally:
        session.close()


def save_rule_execution_mapping(execution_id, smart_execution_id, rule_config, rule_id=None,
                                rule_name=None, rule_book_id=None):
    """
    Save rule execution mapping to database
    
    Returns:
        int: Mapping ID if successful, None otherwise
    """
    session = SessionLocal()
    try:
        from sqlalchemy import text
        import json
        
        query = text("""
            INSERT INTO rule_execution_mapping (
                execution_id, smart_execution_id, rule_id, rule_name, rule_book_id, rule_config
            ) VALUES (
                :execution_id, :smart_execution_id, :rule_id, :rule_name, :rule_book_id, :rule_config
            ) RETURNING id
        """)
        
        result = session.execute(query, {
            'execution_id': execution_id,
            'smart_execution_id': smart_execution_id,
            'rule_id': rule_id,
            'rule_name': rule_name,
            'rule_book_id': rule_book_id,
            'rule_config': json.dumps(rule_config) if rule_config else None
        })
        
        session.commit()
        row = result.fetchone()
        mapping_id = row[0] if row else None
        logging.debug(f"Saved rule execution mapping: {mapping_id}")
        return mapping_id
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error saving rule execution mapping: {e}")
        return None
    finally:
        session.close()


def update_operation_metric(metric_id, completed_at=None, status=None,
                           error_message=None, entity_uuid=None,
                           metrics_snapshot=None):
    """
    Update an operation metric (typically when operation completes)
    
    Args:
        metric_id: Operation metric ID
        completed_at: Completion timestamp
        status: New status
        error_message: Error message if failed
        entity_uuid: Entity UUID (if not set during creation)
        metrics_snapshot: Updated metrics snapshot
        
    Returns:
        bool: True if successful
    """
    session = SessionLocal()
    try:
        import json
        updates = []
        params = {'metric_id': metric_id}
        
        if completed_at is not None:
            updates.append("completed_at = :completed_at")
            params['completed_at'] = completed_at
        
        if status is not None:
            updates.append("status = :status")
            params['status'] = status
        
        if error_message is not None:
            updates.append("error_message = :error_message")
            params['error_message'] = error_message
        
        if entity_uuid is not None:
            updates.append("entity_uuid = :entity_uuid")
            params['entity_uuid'] = entity_uuid
        
        if metrics_snapshot is not None:
            updates.append("metrics_snapshot = :metrics_snapshot")
            params['metrics_snapshot'] = json.dumps(metrics_snapshot)
        
        if not updates:
            return True
        
        query = text(f"""
            UPDATE operation_metrics
            SET {', '.join(updates)}
            WHERE id = :metric_id
        """)
        
        session.execute(query, params)
        session.commit()
        logging.info(f"Updated operation metric ID: {metric_id}")
        return True
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error updating operation metric: {e}")
        return False
    finally:
        session.close()


def get_testbed_timeline(testbed_id, limit=100, offset=0):
    """
    Get timeline of all activities for a testbed
    
    Args:
        testbed_id: Testbed identifier
        limit: Maximum number of records to return
        offset: Offset for pagination
        
    Returns:
        list: List of timeline events
    """
    session = SessionLocal()
    try:
        query = text("""
            SELECT * FROM testbed_timeline
            WHERE testbed_id = :testbed_id
            ORDER BY timestamp DESC
            LIMIT :limit OFFSET :offset
        """)
        
        result = session.execute(query, {
            'testbed_id': testbed_id,
            'limit': limit,
            'offset': offset
        })
        
        timeline = [dict(row._mapping) for row in result.fetchall()]
        logging.info(f"Retrieved {len(timeline)} timeline events for testbed {testbed_id}")
        return timeline
        
    except Exception as e:
        logging.error(f"Error getting testbed timeline: {e}")
        return []
    finally:
        session.close()


def get_execution_operations(execution_id):
    """
    Get all operations for a specific execution
    
    Args:
        execution_id: Execution identifier
        
    Returns:
        list: List of operation metrics
    """
    session = SessionLocal()
    try:
        query = text("""
            SELECT * FROM operation_metrics
            WHERE execution_id = :execution_id
            ORDER BY started_at ASC
        """)
        
        result = session.execute(query, {'execution_id': execution_id})
        operations = [dict(row._mapping) for row in result.fetchall()]
        
        # Parse JSON fields
        import json
        for op in operations:
            if op.get('metrics_snapshot'):
                try:
                    op['metrics_snapshot'] = json.loads(op['metrics_snapshot'])
                except:
                    pass
        
        logging.info(f"Retrieved {len(operations)} operations for execution {execution_id}")
        return operations
        
    except Exception as e:
        logging.error(f"Error getting execution operations: {e}")
        return []
    finally:
        session.close()


def save_metrics_history(testbed_id, cpu_percent=None, memory_percent=None,
                        disk_percent=None, network_rx_mbps=None,
                        network_tx_mbps=None, pod_metrics=None,
                        active_alerts=0, alert_details=None, full_metrics=None):
    """
    Save a metrics history snapshot for continuous monitoring
    
    Args:
        testbed_id: Testbed identifier
        cpu_percent: CPU usage percentage
        memory_percent: Memory usage percentage
        disk_percent: Disk usage percentage
        network_rx_mbps: Network receive rate
        network_tx_mbps: Network transmit rate
        pod_metrics: Pod-level metrics as JSON
        active_alerts: Number of active alerts
        alert_details: Alert details as JSON
        full_metrics: Full metrics snapshot as JSON
        
    Returns:
        int: Metrics history ID if successful
    """
    session = SessionLocal()
    try:
        import json
        query = text("""
            INSERT INTO metrics_history (
                testbed_id, cpu_percent, memory_percent, disk_percent,
                network_rx_mbps, network_tx_mbps, pod_metrics,
                active_alerts, alert_details, full_metrics
            ) VALUES (
                :testbed_id, :cpu_percent, :memory_percent, :disk_percent,
                :network_rx_mbps, :network_tx_mbps, :pod_metrics,
                :active_alerts, :alert_details, :full_metrics
            ) RETURNING id
        """)
        
        result = session.execute(query, {
            'testbed_id': testbed_id,
            'cpu_percent': cpu_percent,
            'memory_percent': memory_percent,
            'disk_percent': disk_percent,
            'network_rx_mbps': network_rx_mbps,
            'network_tx_mbps': network_tx_mbps,
            'pod_metrics': json.dumps(pod_metrics) if pod_metrics else None,
            'active_alerts': active_alerts,
            'alert_details': json.dumps(alert_details) if alert_details else None,
            'full_metrics': json.dumps(full_metrics) if full_metrics else None
        })
        
        session.commit()
        row = result.fetchone()
        return row[0] if row else None
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error saving metrics history: {e}")
        return None
    finally:
        session.close()


def get_metrics_history(testbed_id, start_time=None, end_time=None, limit=1000):
    """
    Get metrics history for a testbed
    
    Args:
        testbed_id: Testbed identifier
        start_time: Start time for filtering (optional)
        end_time: End time for filtering (optional)
        limit: Maximum number of records
        
    Returns:
        list: List of metrics history records
    """
    session = SessionLocal()
    try:
        conditions = ["testbed_id = :testbed_id"]
        params = {'testbed_id': testbed_id, 'limit': limit}
        
        if start_time:
            conditions.append("collected_at >= :start_time")
            params['start_time'] = start_time
        
        if end_time:
            conditions.append("collected_at <= :end_time")
            params['end_time'] = end_time
        
        query = text(f"""
            SELECT * FROM metrics_history
            WHERE {' AND '.join(conditions)}
            ORDER BY collected_at DESC
            LIMIT :limit
        """)
        
        result = session.execute(query, params)
        history = [dict(row._mapping) for row in result.fetchall()]
        
        # Parse JSON fields
        import json
        for record in history:
            for field in ['pod_metrics', 'alert_details', 'full_metrics']:
                if record.get(field):
                    try:
                        record[field] = json.loads(record[field])
                    except:
                        pass
        
        return history
        
    except Exception as e:
        logging.error(f"Error getting metrics history: {e}")
        return []
    finally:
        session.close()


def update_execution_metrics(execution_id, metrics, prometheus_url=None):
    """
    Update execution with collected metrics
    
    Args:
        execution_id: Execution identifier
        metrics: Metrics dictionary
        prometheus_url: Prometheus URL used for collection
        
    Returns:
        bool: True if successful
    """
    session = SessionLocal()
    try:
        import json
        updates = ["metrics = :metrics"]
        params = {
            'execution_id': execution_id,
            'metrics': json.dumps(metrics)
        }
        
        if prometheus_url:
            updates.append("prometheus_url = :prometheus_url")
            params['prometheus_url'] = prometheus_url
        
        query = text(f"""
            UPDATE executions
            SET {', '.join(updates)}
            WHERE execution_id = :execution_id
        """)
        
        session.execute(query, params)
        session.commit()
        logging.info(f"Updated execution {execution_id} with metrics")
        return True
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error updating execution metrics: {e}")
        return False
    finally:
        session.close()


def get_pool_status():
    """
    Get current status of database connection pool.
    
    Useful for monitoring and debugging connection pool performance.
    
    Returns:
        dict: Pool statistics including size, connections in use, overflow, etc.
    """
    try:
        pool = engine.pool
        return {
            'pool_size': pool.size(),
            'checked_in_connections': pool.checkedin(),
            'checked_out_connections': pool.checkedout(),
            'overflow_connections': pool.overflow(),
            'total_connections': pool.size() + pool.overflow(),
            'connections_in_use': pool.checkedout(),
            'connections_available': pool.checkedin(),
            'status': 'healthy' if pool.checkedout() < pool.size() else 'near_capacity'
        }
    except Exception as e:
        logging.error(f"Error getting pool status: {e}")
        return {
            'error': str(e),
            'status': 'unknown'
        }


def log_pool_status():
    """Log current connection pool status for monitoring"""
    status = get_pool_status()
    if 'error' not in status:
        logging.info(
            f"📊 Connection Pool: "
            f"{status['connections_in_use']}/{status['total_connections']} in use, "
            f"{status['connections_available']} available, "
            f"status={status['status']}"
        )
    else:
        logging.warning(f"⚠️  Unable to get pool status: {status['error']}")


def recover_orphaned_executions():
    """
    Recover orphaned executions from backend restart.
    
    Finds all executions in active states (PENDING, STARTING, RUNNING, PAUSED)
    and marks them as FAILED with appropriate error message.
    
    Called during backend startup to handle executions that were interrupted
    when the backend crashed or was restarted.
    
    Returns:
        int: Number of executions recovered
    """
    session = SessionLocal()
    recovered_count = 0
    
    try:
        # Find all active executions (non-terminal states)
        active_states = ['PENDING', 'STARTING', 'RUNNING', 'PAUSED', 'pending', 'starting', 'running', 'paused']
        
        query = text("""
            SELECT execution_id, testbed_id, status, start_time, created_at
            FROM executions
            WHERE status IN :active_states
            ORDER BY created_at DESC
        """)
        
        result = session.execute(query, {'active_states': tuple(active_states)})
        orphaned_executions = result.fetchall()
        
        if not orphaned_executions:
            logging.info("✅ No orphaned executions found during startup")
            return 0
        
        logging.warning(f"⚠️  Found {len(orphaned_executions)} orphaned execution(s) - marking as FAILED")
        
        # Mark each orphaned execution as FAILED
        for exec_row in orphaned_executions:
            exec_id = exec_row.execution_id
            
            update_query = text("""
                UPDATE executions
                SET status = :status,
                    end_time = :end_time,
                    last_error = :error_message
                WHERE execution_id = :execution_id
            """)
            
            session.execute(update_query, {
                'execution_id': exec_id,
                'status': 'FAILED',
                'end_time': datetime.utcnow(),
                'error_message': 'Execution interrupted due to backend restart or crash'
            })
            
            logging.info(f"  ↳ Marked execution {exec_id[:20]}... as FAILED")
            recovered_count += 1
        
        session.commit()
        logging.info(f"✅ Successfully recovered {recovered_count} orphaned execution(s)")
        
    except Exception as e:
        session.rollback()
        logging.error(f"❌ Error recovering orphaned executions: {e}", exc_info=True)
    finally:
        session.close()
    
    return recovered_count


if __name__ == "__main__":
    init_db()
    print("Database tables created.")
