"""
Database helper functions for smart execution persistence
"""
import logging
from datetime import datetime, timezone
from typing import Dict, Optional
from sqlalchemy.orm import Session
from database import SessionLocal
from models.smart_execution import SmartExecution

logger = logging.getLogger(__name__)

def save_smart_execution(execution_data: Dict) -> bool:
    """
    Save or update smart execution in database
    """
    try:
        session = SessionLocal()
        
        execution_id = execution_data.get('execution_id')
        
        # Check if execution already exists
        existing = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
        
        if existing:
            # Update existing
            for key, value in execution_data.items():
                if hasattr(existing, key):
                    setattr(existing, key, value)
            logger.debug(f"Updated smart execution: {execution_id}")
        else:
            # Create new
            execution = SmartExecution(**execution_data)
            session.add(execution)
            logger.info(f"Created new smart execution: {execution_id}")
        
        session.commit()
        session.close()
        return True
        
    except Exception as e:
        logger.error(f"Failed to save smart execution {execution_id}: {e}")
        try:
            session.rollback()
            session.close()
        except:
            pass
        return False

def load_smart_execution(execution_id: str) -> Optional[Dict]:
    """
    Load smart execution from database
    """
    try:
        session = SessionLocal()
        execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
        session.close()
        
        if execution:
            return execution.to_dict()
        return None
        
    except Exception as e:
        logger.error(f"Failed to load smart execution {execution_id}: {e}")
        return None

def list_smart_executions(
    testbed_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
) -> list:
    """
    List smart executions with optional filters
    """
    try:
        session = SessionLocal()
        query = session.query(SmartExecution)
        
        if testbed_id:
            query = query.filter_by(testbed_id=testbed_id)
        
        if status:
            query = query.filter_by(status=status)
        
        executions = query.order_by(SmartExecution.start_time.desc()).limit(limit).all()
        session.close()
        
        return [e.to_dict() for e in executions]
        
    except Exception as e:
        logger.error(f"Failed to list smart executions: {e}")
        return []

def update_execution_status(execution_id: str, status: str, end_time: Optional[datetime] = None) -> bool:
    """
    Update execution status
    """
    try:
        session = SessionLocal()
        execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
        
        if execution:
            execution.status = status
            execution.is_running = (status == 'RUNNING')
            if end_time:
                execution.end_time = end_time
                if execution.start_time:
                    duration = (end_time - execution.start_time).total_seconds() / 60
                    execution.duration_minutes = duration
            
            session.commit()
            session.close()
            return True
        
        session.close()
        return False
        
    except Exception as e:
        logger.error(f"Failed to update execution status {execution_id}: {e}")
        return False

def mark_execution_alert_sent(execution_id: str, slack_sent: bool = True) -> bool:
    """
    Mark that alert was generated and sent
    """
    try:
        session = SessionLocal()
        execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
        
        if execution:
            execution.alert_generated = True
            execution.alert_sent_slack = slack_sent
            execution.alert_timestamp = datetime.now(timezone.utc)
            
            session.commit()
            session.close()
            return True
        
        session.close()
        return False
        
    except Exception as e:
        logger.error(f"Failed to mark alert sent {execution_id}: {e}")
        return False

def get_pod_operation_correlation(smart_execution_id: str) -> list:
    """
    Retrieve pod-operation correlation data for a smart execution
    Returns list of correlation records
    """
    try:
        from sqlalchemy import text
        
        session = SessionLocal()
        try:
            query = text("""
                SELECT 
                    entity_type, operation_type, entity_name,
                    pod_name, namespace, node_name,
                    cpu_percent_before, cpu_percent_after, cpu_delta,
                    memory_mb_before, memory_mb_after, memory_delta,
                    network_rx_mbps_before, network_rx_mbps_after, network_rx_delta,
                    network_tx_mbps_before, network_tx_mbps_after, network_tx_delta,
                    correlation_type, impact_score, measured_at
                FROM pod_operation_correlation
                WHERE smart_execution_id = :execution_id
                ORDER BY measured_at ASC, entity_type, operation_type
            """)
            
            result = session.execute(query, {'execution_id': smart_execution_id})
            rows = result.fetchall()
            
            # Convert to list of dicts
            correlations = []
            for row in rows:
                correlations.append({
                    'entity_type': row[0],
                    'operation_type': row[1],
                    'entity_name': row[2],
                    'pod_name': row[3],
                    'namespace': row[4],
                    'node_name': row[5],
                    'cpu_before': row[6],
                    'cpu_after': row[7],
                    'cpu_delta': row[8],
                    'memory_before': row[9],
                    'memory_after': row[10],
                    'memory_delta': row[11],
                    'network_rx_before': row[12],
                    'network_rx_after': row[13],
                    'network_rx_delta': row[14],
                    'network_tx_before': row[15],
                    'network_tx_after': row[16],
                    'network_tx_delta': row[17],
                    'correlation_type': row[18],
                    'impact_score': row[19],
                    'measured_at': row[20].isoformat() if row[20] else None
                })
            
            return correlations
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Failed to get pod correlation for {smart_execution_id}: {e}")
        return []
