"""
NMT Execution Adapter

Bridge between NMT API endpoints and ExecutionManager.
Converts NMT-specific requests to execution manager calls.

NO EXTERNAL DEPENDENCIES - Self-contained for NMT.
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime

from utils.execution_id import generate_execution_id
from services.execution_manager import get_execution_manager
from database import get_executions_by_testbed, get_all_executions, fetch_testbed_by_unique_id, SessionLocal

logger = logging.getLogger(__name__)


class NMTExecutionAdapter:
    """
    Adapter for NMT execution operations.
    
    Provides a clean interface between NMT API endpoints and the
    execution manager, handling request/response transformations.
    """
    
    def __init__(self):
        self.execution_manager = get_execution_manager()
        logger.info("NMTExecutionAdapter initialized")
    
    def _get_prometheus_url(self, testbed_config: Dict[str, Any]) -> Optional[str]:
        """
        Extract Prometheus URL from testbed configuration
        
        Args:
            testbed_config: Testbed configuration
            
        Returns:
            Prometheus URL or None
        """
        # Try to get from direct config
        if 'prometheus_url' in testbed_config:
            return testbed_config['prometheus_url']
        
        # Try to construct from NCM IP
        ncm_ip = testbed_config.get('ncm_ip')
        if ncm_ip:
            # Default Prometheus port (can be overridden)
            port = testbed_config.get('prometheus_port', 30546)
            return f"https://{ncm_ip}:{port}"
        
        logger.warning("Could not determine Prometheus URL from testbed config")
        return None
    
    def start_testbed_execution(self, testbed_config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Start execution for a testbed.
        
        Args:
            testbed_config (dict): Testbed configuration containing:
                - testbed_id: Testbed identifier
                - testbed_filepath: Path to testbed config file
                - unique_testbed_id: Unique testbed UUID
                - config: Additional execution configuration
        
        Returns:
            dict: {
                'success': bool,
                'execution_id': str,
                'message': str,
                'status': str
            }
        
        Raises:
            ValueError: If required fields are missing
            Exception: If execution start fails
        """
        try:
            # Extract testbed ID (optional)
            testbed_id = testbed_config.get('unique_testbed_id') or testbed_config.get('testbed_id')
            
            # Generate execution ID
            execution_id = generate_execution_id(prefix="NMT")
            logger.info(f"Generated execution_id: {execution_id} for testbed: {testbed_id}")
            
            # Prepare execution config
            # Extract workload_config from the request (it's at the top level)
            workload_cfg = testbed_config.get('workload_config', testbed_config.get('config', {}))
            
            exec_config = {
                'testbed_filepath': testbed_config.get('testbed_filepath'),
                'testbed_config': testbed_config,
                'total_operations': testbed_config.get('total_operations', 100),
                'workload_type': testbed_config.get('workload_type', 'default'),
                'workload_config': workload_cfg,
                'started_by': testbed_config.get('username', 'system'),
                'started_at': datetime.utcnow().isoformat(),
                # Add Prometheus URL for metrics collection
                'prometheus_url': self._get_prometheus_url(testbed_config)
            }
            
            logger.info(f"🔍 Adapter - workload_config has {len(workload_cfg.get('entities', []))} entities")
            
            # Start execution
            db_record = self.execution_manager.start_execution(
                execution_id=execution_id,
                testbed_id=testbed_id,
                config=exec_config
            )
            
            return {
                'success': True,
                'execution_id': execution_id,
                'message': 'Execution started successfully',
                'status': db_record['status'],
                'testbed_id': testbed_id,
                'created_at': db_record['created_at'].isoformat() if isinstance(db_record['created_at'], datetime) else db_record['created_at']
            }
            
        except ValueError as e:
            logger.error(f"Validation error starting execution: {e}")
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to start execution: validation error'
            }
        except Exception as e:
            logger.error(f"Error starting execution: {e}")
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to start execution'
            }
    
    def get_execution_status(self, execution_id: str) -> Dict[str, Any]:
        """
        Get execution status with progress.
        
        Args:
            execution_id (str): Execution identifier
        
        Returns:
            dict: Execution status with progress and stats
        """
        try:
            status = self.execution_manager.get_status(execution_id)
            
            if status is None:
                return {
                    'success': False,
                    'error': 'Execution not found',
                    'execution_id': execution_id
                }
            
            return status
            
        except Exception as e:
            logger.error(f"Error getting execution status: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_id': execution_id
            }
    
    def stop_execution(self, execution_id: str, reason: str = "User requested") -> Dict[str, Any]:
        """
        Stop a running execution.
        
        Args:
            execution_id (str): Execution identifier
            reason (str): Stop reason
        
        Returns:
            dict: {
                'success': bool,
                'execution_id': str,
                'message': str
            }
        """
        try:
            stopped = self.execution_manager.stop_execution(execution_id)
            
            if stopped:
                return {
                    'success': True,
                    'execution_id': execution_id,
                    'message': f'Execution stopped successfully. {reason}'
                }
            else:
                return {
                    'success': False,
                    'execution_id': execution_id,
                    'message': 'Execution not found or already stopped'
                }
                
        except Exception as e:
            logger.error(f"Error stopping execution: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_id': execution_id
            }
    
    def pause_execution(self, execution_id: str) -> Dict[str, Any]:
        """
        Pause a running execution.
        
        Args:
            execution_id (str): Execution identifier
        
        Returns:
            dict: {
                'success': bool,
                'execution_id': str,
                'message': str
            }
        """
        try:
            paused = self.execution_manager.pause_execution(execution_id)
            
            if paused:
                return {
                    'success': True,
                    'execution_id': execution_id,
                    'message': 'Execution paused successfully'
                }
            else:
                return {
                    'success': False,
                    'execution_id': execution_id,
                    'message': 'Execution not found or cannot be paused'
                }
                
        except Exception as e:
            logger.error(f"Error pausing execution: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_id': execution_id
            }
    
    def resume_execution(self, execution_id: str) -> Dict[str, Any]:
        """
        Resume a paused execution.
        
        Args:
            execution_id (str): Execution identifier
        
        Returns:
            dict: {
                'success': bool,
                'execution_id': str,
                'message': str
            }
        """
        try:
            resumed = self.execution_manager.resume_execution(execution_id)
            
            if resumed:
                return {
                    'success': True,
                    'execution_id': execution_id,
                    'message': 'Execution resumed successfully'
                }
            else:
                return {
                    'success': False,
                    'execution_id': execution_id,
                    'message': 'Execution not found or not paused'
                }
                
        except Exception as e:
            logger.error(f"Error resuming execution: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_id': execution_id
            }
    
    def get_execution_report(self, execution_id: str) -> Dict[str, Any]:
        """
        Get comprehensive execution report with metrics
        
        Args:
            execution_id: Execution identifier
            
        Returns:
            dict: {
                'success': bool,
                'report': dict or None,
                'message': str
            }
        """
        try:
            # Get execution status first
            status = self.execution_manager.get_status(execution_id)
            if not status:
                return {
                    'success': False,
                    'message': 'Execution not found',
                    'execution_id': execution_id
                }
            
            # Get testbed info
            testbed_id = status.get('testbed_id')
            testbed_info = {}
            
            if testbed_id:
                session = SessionLocal()
                try:
                    testbed = fetch_testbed_by_unique_id(session, testbed_id)
                    if testbed:
                        testbed_info = {
                            'unique_testbed_id': testbed.unique_testbed_id,
                            'testbed_label': testbed.testbed_label,
                            'pc_ip': testbed.pc_ip,
                            'ncm_ip': testbed.ncm_ip
                        }
                finally:
                    session.close()
            
            # Get report with metrics
            report = self.execution_manager.get_execution_report(execution_id, testbed_info)
            
            if report:
                return {
                    'success': True,
                    'report': report,
                    'execution_id': execution_id
                }
            else:
                return {
                    'success': False,
                    'message': 'Report not available',
                    'execution_id': execution_id
                }
                
        except Exception as e:
            logger.error(f"Error getting execution report: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_id': execution_id
            }
    
    def list_executions(self, testbed_id: Optional[str] = None, 
                       limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """
        List executions, optionally filtered by testbed.
        
        Args:
            testbed_id (str, optional): Filter by testbed ID
            limit (int): Maximum number of results
            offset (int): Offset for pagination
        
        Returns:
            dict: {
                'success': bool,
                'executions': list,
                'count': int
            }
        """
        try:
            if testbed_id:
                executions = get_executions_by_testbed(testbed_id, limit, offset)
            else:
                executions = get_all_executions(limit, offset)
            
            # Convert datetime objects to ISO format
            for exec in executions:
                for key in ['start_time', 'end_time', 'created_at', 'updated_at']:
                    if exec.get(key) and isinstance(exec[key], datetime):
                        exec[key] = exec[key].isoformat()
            
            return {
                'success': True,
                'executions': executions,
                'count': len(executions)
            }
            
        except Exception as e:
            logger.error(f"Error listing executions: {e}")
            return {
                'success': False,
                'error': str(e),
                'executions': [],
                'count': 0
            }
    
    def list_active_executions(self) -> Dict[str, Any]:
        """
        List all active (non-terminal) executions.
        
        Returns:
            dict: {
                'success': bool,
                'execution_ids': list,
                'count': int
            }
        """
        try:
            execution_ids = self.execution_manager.list_active_executions()
            
            return {
                'success': True,
                'execution_ids': execution_ids,
                'count': len(execution_ids)
            }
            
        except Exception as e:
            logger.error(f"Error listing active executions: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_ids': [],
                'count': 0
            }


# Global adapter instance
_adapter = None


def get_nmt_execution_adapter() -> NMTExecutionAdapter:
    """
    Get global NMT execution adapter instance (singleton).
    
    Returns:
        NMTExecutionAdapter: Global adapter instance
    """
    global _adapter
    
    if _adapter is None:
        _adapter = NMTExecutionAdapter()
    
    return _adapter
