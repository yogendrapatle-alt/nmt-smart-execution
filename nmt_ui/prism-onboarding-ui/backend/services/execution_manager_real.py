"""
Execution Manager with Real Loadgen Operations
Manages execution lifecycles with actual NCM API calls
"""

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, Any, Optional, List
import sys
from pathlib import Path

# Add loadgen to Python path
LOADGEN_PATH = Path(__file__).parent.parent.parent.parent.parent.parent / 'loadgen' / 'ncm-lg'
if str(LOADGEN_PATH) not in sys.path:
    sys.path.insert(0, str(LOADGEN_PATH))

# Import loadgen modules
try:
    from http_client_auth.base_client import NCMClient
    from load_engine.app.entities.v3.vms import create_vm, delete_vm, power_on_vm
    from load_engine.app.entities.v3.projects import create_project, delete_project
    from load_engine.app.entities.v3.endpoints import create_endpoint, delete_endpoint
    from load_engine.app.entities.v3.blueprints import create_blueprint, launch_blueprint, delete_blueprint
    from load_engine.app.entities.v3.playbooks import create_playbook, trigger_playbook
    from load_engine.app.entities.v3.report_configs import create_report_config, delete_report_config
    LOADGEN_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Loadgen modules not available: {e}. Using simulation mode.")
    LOADGEN_AVAILABLE = False

from .metrics_collector import MetricsCollector
from ..database import (
    create_execution_record,
    update_execution_status,
    get_execution_by_id
)

logger = logging.getLogger(__name__)


class ExecutionStatus(Enum):
    """Execution status enumeration"""
    PENDING = "pending"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


@dataclass
class OperationStats:
    """Statistics for tracking execution progress"""
    total_operations: int = 0
    completed_operations: int = 0
    successful_operations: int = 0
    failed_operations: int = 0
    pending_operations: int = 0
    
    @property
    def progress_percentage(self) -> float:
        """Calculate progress percentage"""
        if self.total_operations == 0:
            return 0.0
        return (self.completed_operations / self.total_operations) * 100.0
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate"""
        if self.completed_operations == 0:
            return 0.0
        return (self.successful_operations / self.completed_operations) * 100.0


@dataclass
class ExecutionContext:
    """Context for a single execution"""
    execution_id: str
    testbed_id: str
    config: Dict[str, Any]
    status: str = ExecutionStatus.PENDING.value
    stats: OperationStats = field(default_factory=OperationStats)
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    last_error: Optional[str] = None
    error_count: int = 0
    _pause_requested: bool = False
    _stop_requested: bool = False
    _execution_thread: Optional[threading.Thread] = None
    collected_metrics: Dict[str, Any] = field(default_factory=dict)
    created_resources: List[Dict[str, str]] = field(default_factory=list)


class ExecutionManager:
    """
    Manages execution lifecycles with real NCM API calls
    """
    
    def __init__(self):
        """Initialize execution manager"""
        self.active_executions: Dict[str, ExecutionContext] = {}
        self._lock = threading.Lock()
        logger.info("ExecutionManager initialized with real loadgen operations")
    
    def start_execution(
        self,
        execution_id: str,
        testbed_id: str,
        config: Dict[str, Any]
    ) -> bool:
        """
        Start a new execution
        
        Args:
            execution_id: Unique execution identifier
            testbed_id: Testbed identifier
            config: Execution configuration including workload and testbed details
            
        Returns:
            bool: True if execution started successfully
        """
        with self._lock:
            if execution_id in self.active_executions:
                logger.error(f"Execution {execution_id} already exists")
                return False
            
            # Create execution context
            context = ExecutionContext(
                execution_id=execution_id,
                testbed_id=testbed_id,
                config=config
            )
            
            # Create database record
            create_execution_record(
                execution_id=execution_id,
                testbed_id=testbed_id,
                config=config,
                status=ExecutionStatus.PENDING.value
            )
            
            # Store context
            self.active_executions[execution_id] = context
            
            # Start execution thread
            context._execution_thread = threading.Thread(
                target=self._execute_workload,
                args=(context,),
                daemon=True
            )
            context._execution_thread.start()
            
            logger.info(f"✅ Execution {execution_id} started")
            return True
    
    def _execute_workload(self, context: ExecutionContext):
        """
        Execute workload with REAL NCM API calls using loadgen
        
        Args:
            context: Execution context
        """
        ncm_client = None
        
        try:
            # Update status to STARTING
            context.status = ExecutionStatus.STARTING.value
            update_execution_status(
                context.execution_id,
                status=ExecutionStatus.STARTING.value
            )
            
            logger.info(f"🚀 Starting REAL execution for {context.execution_id}")
            
            # Extract credentials from config
            testbed_config = context.config.get('testbed_config', {})
            pc_ip = testbed_config.get('pc_ip')
            username = testbed_config.get('username')
            password = testbed_config.get('password')
            
            if not all([pc_ip, username, password]):
                raise ValueError("Missing testbed credentials (PC IP, username, or password)")
            
            logger.info(f"📋 Connecting to testbed: {pc_ip} as {username}")
            
            # Initialize NCMClient if loadgen is available
            if LOADGEN_AVAILABLE:
                # Run async client initialization in a new event loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                ncm_client = NCMClient(
                    host=pc_ip,
                    username=username,
                    password=password,
                    port=9440,
                    verify_ssl=False,
                    execution_id=context.execution_id
                )
                
                logger.info(f"✅ NCM Client initialized for {pc_ip}")
                
                # Update status to RUNNING
                context.status = ExecutionStatus.RUNNING.value
                context.started_at = datetime.utcnow()
                update_execution_status(
                    context.execution_id,
                    status=ExecutionStatus.RUNNING.value
                )
                
                # Execute actual workload
                loop.run_until_complete(
                    self._execute_real_workload(loop, ncm_client, context)
                )
                
                loop.close()
            else:
                # Fallback to simulation if loadgen not available
                logger.warning(f"⚠️ Loadgen not available, using simulation mode")
                self._execute_simulated_workload(context)
            
            # Check final status
            if context._stop_requested:
                context.status = ExecutionStatus.STOPPED.value
                context.stopped_at = datetime.utcnow()
                context.completed_at = datetime.utcnow()
            else:
                context.status = ExecutionStatus.COMPLETED.value
                context.completed_at = datetime.utcnow()
            
            # Collect metrics
            try:
                prometheus_url = context.config.get('prometheus_url')
                if prometheus_url and context.started_at and context.completed_at:
                    logger.info(f"📊 Collecting metrics for {context.execution_id}")
                    metrics_collector = MetricsCollector(prometheus_url)
                    context.collected_metrics = metrics_collector.collect_all_metrics(
                        start=context.started_at,
                        end=context.completed_at
                    )
                    logger.info(f"✅ Metrics collected for {context.execution_id}")
            except Exception as metrics_error:
                logger.error(f"❌ Failed to collect metrics: {metrics_error}")
                context.collected_metrics = {'error': str(metrics_error)}
            
            # Final update
            update_execution_status(
                context.execution_id,
                status=context.status,
                progress=int(context.stats.progress_percentage),
                completed_ops=context.stats.completed_operations,
                total_ops=context.stats.total_operations,
                successful_ops=context.stats.successful_operations,
                failed_ops=context.stats.failed_operations,
                end_time=context.completed_at
            )
            
            logger.info(f"✅ Execution {context.execution_id} finished: {context.status}")
            
        except Exception as e:
            logger.error(f"❌ Execution {context.execution_id} failed: {e}", exc_info=True)
            context.status = ExecutionStatus.FAILED.value
            context.last_error = str(e)
            context.error_count += 1
            context.completed_at = datetime.utcnow()
            
            update_execution_status(
                context.execution_id,
                status=ExecutionStatus.FAILED.value,
                last_error=str(e),
                end_time=context.completed_at
            )
        
        finally:
            # Close NCM client
            if ncm_client and LOADGEN_AVAILABLE:
                try:
                    loop = asyncio.new_event_loop()
                    loop.run_until_complete(ncm_client.close())
                    loop.close()
                    logger.info(f"🔒 NCM Client closed for {context.execution_id}")
                except Exception as close_error:
                    logger.warning(f"⚠️ Error closing NCM client: {close_error}")
    
    async def _execute_real_workload(
        self,
        loop: asyncio.AbstractEventLoop,
        client: 'NCMClient',
        context: ExecutionContext
    ):
        """
        Execute real workload operations using loadgen
        
        Args:
            loop: Event loop
            client: NCM client
            context: Execution context
        """
        workload_config = context.config.get('workload_config', {})
        entities = workload_config.get('entities', [])
        
        # Calculate total operations
        total_ops = 0
        for entity in entities:
            ops = entity.get('operations', {})
            total_ops += sum(ops.values())
        
        context.stats.total_operations = total_ops
        context.stats.pending_operations = total_ops
        
        logger.info(f"📋 Total operations to execute: {total_ops}")
        
        # Execute each entity's operations
        for entity in entities:
            if context._stop_requested:
                break
            
            await self._execute_entity_operations(client, entity, context)
    
    async def _execute_entity_operations(
        self,
        client: 'NCMClient',
        entity_config: Dict,
        context: ExecutionContext
    ):
        """
        Execute operations for a single entity type
        
        Args:
            client: NCM client
            entity_config: Entity configuration
            context: Execution context
        """
        entity_type = entity_config.get('type', '').lower()
        operations = entity_config.get('operations', {})
        
        logger.info(f"🔧 Executing {entity_type} operations: {operations}")
        
        # VM Operations
        if entity_type == 'vm':
            await self._execute_vm_operations(client, operations, context)
        
        # Project Operations
        elif entity_type == 'project':
            await self._execute_project_operations(client, operations, context)
        
        # Endpoint Operations
        elif entity_type == 'endpoint':
            await self._execute_endpoint_operations(client, operations, context)
        
        # Add more entity types as needed...
        else:
            logger.warning(f"⚠️ Entity type '{entity_type}' not yet implemented")
    
    async def _execute_vm_operations(
        self,
        client: 'NCMClient',
        operations: Dict[str, int],
        context: ExecutionContext
    ):
        """Execute VM operations (create, update, delete, etc.)"""
        
        # CREATE operations
        create_count = operations.get('create', 0)
        for i in range(create_count):
            if context._stop_requested:
                break
            
            # Check for pause
            while context._pause_requested and not context._stop_requested:
                await asyncio.sleep(1)
            
            try:
                vm_name = f"NMT_LoadGen_VM_{context.execution_id}_{i}"
                logger.info(f"🖥️  Creating VM: {vm_name}")
                
                responses = await create_vm(
                    client,
                    vm_name=vm_name,
                    image_name="TinyCoreLinuxGUI.qcow2",
                    concurrency=1
                )
                
                if responses and responses[0].status in [200, 201, 202]:
                    context.stats.successful_operations += 1
                    # Store created resource for cleanup
                    vm_uuid = responses[0].body.get('metadata', {}).get('uuid')
                    if vm_uuid:
                        context.created_resources.append({
                            'type': 'vm',
                            'uuid': vm_uuid,
                            'name': vm_name
                        })
                    logger.info(f"✅ VM created: {vm_name} ({vm_uuid})")
                else:
                    context.stats.failed_operations += 1
                    logger.error(f"❌ Failed to create VM: {vm_name}")
                
            except Exception as vm_error:
                context.stats.failed_operations += 1
                context.last_error = str(vm_error)
                logger.error(f"❌ Error creating VM: {vm_error}")
            
            finally:
                context.stats.completed_operations += 1
                context.stats.pending_operations -= 1
                
                # Update database every operation
                update_execution_status(
                    context.execution_id,
                    status=context.status,
                    progress=int(context.stats.progress_percentage),
                    completed_ops=context.stats.completed_operations,
                    total_ops=context.stats.total_operations,
                    successful_ops=context.stats.successful_operations,
                    failed_ops=context.stats.failed_operations
                )
        
        # DELETE operations (clean up created VMs)
        delete_count = operations.get('delete', 0)
        vms_to_delete = context.created_resources[-delete_count:] if delete_count > 0 else []
        
        for vm_resource in vms_to_delete:
            if context._stop_requested:
                break
            
            try:
                vm_uuid = vm_resource.get('uuid')
                vm_name = vm_resource.get('name')
                logger.info(f"🗑️  Deleting VM: {vm_name}")
                
                responses = await delete_vm(client, vm_uuid, concurrency=1)
                
                if responses and responses[0].status in [200, 202]:
                    context.stats.successful_operations += 1
                    logger.info(f"✅ VM deleted: {vm_name}")
                else:
                    context.stats.failed_operations += 1
                    logger.error(f"❌ Failed to delete VM: {vm_name}")
                
            except Exception as delete_error:
                context.stats.failed_operations += 1
                logger.error(f"❌ Error deleting VM: {delete_error}")
            
            finally:
                context.stats.completed_operations += 1
                context.stats.pending_operations -= 1
                
                update_execution_status(
                    context.execution_id,
                    progress=int(context.stats.progress_percentage),
                    completed_ops=context.stats.completed_operations,
                    successful_ops=context.stats.successful_operations,
                    failed_ops=context.stats.failed_operations
                )
    
    async def _execute_project_operations(
        self,
        client: 'NCMClient',
        operations: Dict[str, int],
        context: ExecutionContext
    ):
        """Execute Project operations"""
        # Similar to VM operations, but with project-specific calls
        create_count = operations.get('create', 0)
        for i in range(create_count):
            if context._stop_requested:
                break
            
            try:
                project_name = f"NMT_LoadGen_Project_{context.execution_id}_{i}"
                logger.info(f"📁 Creating Project: {project_name}")
                
                responses = await create_project(
                    client,
                    project_name=project_name,
                    concurrency=1
                )
                
                if responses and responses[0].status in [200, 201, 202]:
                    context.stats.successful_operations += 1
                    logger.info(f"✅ Project created: {project_name}")
                else:
                    context.stats.failed_operations += 1
                    logger.error(f"❌ Failed to create project: {project_name}")
                
            except Exception as proj_error:
                context.stats.failed_operations += 1
                logger.error(f"❌ Error creating project: {proj_error}")
            
            finally:
                context.stats.completed_operations += 1
                context.stats.pending_operations -= 1
                
                update_execution_status(
                    context.execution_id,
                    progress=int(context.stats.progress_percentage),
                    completed_ops=context.stats.completed_operations,
                    successful_ops=context.stats.successful_operations,
                    failed_ops=context.stats.failed_operations
                )
    
    async def _execute_endpoint_operations(
        self,
        client: 'NCMClient',
        operations: Dict[str, int],
        context: ExecutionContext
    ):
        """Execute Endpoint operations"""
        create_count = operations.get('create', 0)
        for i in range(create_count):
            if context._stop_requested:
                break
            
            try:
                endpoint_name = f"NMT_LoadGen_Endpoint_{context.execution_id}_{i}"
                logger.info(f"🔗 Creating Endpoint: {endpoint_name}")
                
                responses = await create_endpoint(
                    client,
                    endpoint_name=endpoint_name,
                    concurrency=1
                )
                
                if responses and responses[0].status in [200, 201, 202]:
                    context.stats.successful_operations += 1
                    logger.info(f"✅ Endpoint created: {endpoint_name}")
                else:
                    context.stats.failed_operations += 1
                    logger.error(f"❌ Failed to create endpoint: {endpoint_name}")
                
            except Exception as ep_error:
                context.stats.failed_operations += 1
                logger.error(f"❌ Error creating endpoint: {ep_error}")
            
            finally:
                context.stats.completed_operations += 1
                context.stats.pending_operations -= 1
                
                update_execution_status(
                    context.execution_id,
                    progress=int(context.stats.progress_percentage),
                    completed_ops=context.stats.completed_operations,
                    successful_ops=context.stats.successful_operations,
                    failed_ops=context.stats.failed_operations
                )
    
    def _execute_simulated_workload(self, context: ExecutionContext):
        """Fallback simulation if loadgen is not available"""
        logger.warning(f"⚠️ Running in SIMULATION mode for {context.execution_id}")
        
        context.status = ExecutionStatus.RUNNING.value
        context.started_at = datetime.utcnow()
        update_execution_status(
            context.execution_id,
            status=ExecutionStatus.RUNNING.value
        )
        
        total_ops = context.config.get('total_operations', 100)
        context.stats.total_operations = total_ops
        
        for i in range(total_ops):
            if context._stop_requested:
                break
            
            while context._pause_requested and not context._stop_requested:
                time.sleep(1)
            
            time.sleep(0.1)  # Simulate work
            
            context.stats.completed_operations = i + 1
            context.stats.successful_operations = i + 1
            context.stats.pending_operations = total_ops - (i + 1)
            
            if (i + 1) % 10 == 0:
                update_execution_status(
                    context.execution_id,
                    progress=int(context.stats.progress_percentage),
                    completed_ops=context.stats.completed_operations,
                    total_ops=context.stats.total_operations,
                    successful_ops=context.stats.successful_operations,
                    failed_ops=context.stats.failed_operations
                )
    
    def get_status(self, execution_id: str) -> Optional[Dict[str, Any]]:
        """Get execution status"""
        with self._lock:
            context = self.active_executions.get(execution_id)
            if not context:
                return None
            
            return {
                'execution_id': execution_id,
                'testbed_id': context.testbed_id,
                'status': context.status,
                'progress': context.stats.progress_percentage,
                'stats': {
                    'total_operations': context.stats.total_operations,
                    'completed_operations': context.stats.completed_operations,
                    'successful_operations': context.stats.successful_operations,
                    'failed_operations': context.stats.failed_operations,
                    'pending_operations': context.stats.pending_operations
                },
                'started_at': context.started_at.isoformat() if context.started_at else None,
                'duration_minutes': (
                    (datetime.utcnow() - context.started_at).total_seconds() / 60
                    if context.started_at and context.status == ExecutionStatus.RUNNING.value
                    else None
                ),
                'last_error': context.last_error
            }
    
    def pause_execution(self, execution_id: str) -> bool:
        """Pause execution"""
        with self._lock:
            context = self.active_executions.get(execution_id)
            if not context or context.status != ExecutionStatus.RUNNING.value:
                return False
            
            context._pause_requested = True
            context.status = ExecutionStatus.PAUSED.value
            update_execution_status(execution_id, status=ExecutionStatus.PAUSED.value)
            logger.info(f"⏸️  Execution {execution_id} paused")
            return True
    
    def resume_execution(self, execution_id: str) -> bool:
        """Resume execution"""
        with self._lock:
            context = self.active_executions.get(execution_id)
            if not context or context.status != ExecutionStatus.PAUSED.value:
                return False
            
            context._pause_requested = False
            context.status = ExecutionStatus.RUNNING.value
            update_execution_status(execution_id, status=ExecutionStatus.RUNNING.value)
            logger.info(f"▶️  Execution {execution_id} resumed")
            return True
    
    def stop_execution(self, execution_id: str) -> bool:
        """Stop execution"""
        with self._lock:
            context = self.active_executions.get(execution_id)
            if not context:
                return False
            
            context._stop_requested = True
            context._pause_requested = False  # Unpause if paused
            logger.info(f"🛑 Execution {execution_id} stop requested")
            return True


# Global execution manager instance
_execution_manager = None
_manager_lock = threading.Lock()


def get_execution_manager() -> ExecutionManager:
    """Get global execution manager instance (singleton)"""
    global _execution_manager
    
    if _execution_manager is None:
        with _manager_lock:
            if _execution_manager is None:
                _execution_manager = ExecutionManager()
    
    return _execution_manager
