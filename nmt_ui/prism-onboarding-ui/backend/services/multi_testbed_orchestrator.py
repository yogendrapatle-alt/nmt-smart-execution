"""
Multi-Testbed Execution Orchestrator

Coordinates parallel execution of Smart Executions across multiple testbeds.
Handles progress tracking, result aggregation, and error handling.
"""

import threading
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)


class MultiTestbedOrchestrator:
    """
    Orchestrates Smart Executions across multiple testbeds in parallel
    
    Features:
    - Parallel execution with thread pool
    - Real-time progress tracking
    - Aggregate result collection
    - Graceful error handling
    - Status monitoring
    """
    
    def __init__(self, max_workers: int = 5):
        """
        Initialize orchestrator
        
        Args:
            max_workers: Maximum number of parallel executions
        """
        self.max_workers = max_workers
        self.active_executions: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        logger.info(f"✅ Multi-testbed orchestrator initialized (max_workers={max_workers})")
    
    def start_multi_execution(self, multi_execution_id: str, testbed_configs: List[Dict],
                             target_config: Dict, entities_config: Dict,
                             ai_settings: Optional[Dict] = None) -> Dict:
        """
        Start parallel executions across multiple testbeds
        
        Args:
            multi_execution_id: Unique ID for this multi-testbed execution
            testbed_configs: List of testbed configurations
            target_config: Target thresholds configuration
            entities_config: Entities and operations configuration
            ai_settings: AI/ML settings
        
        Returns:
            Dict with execution info and child execution IDs
        """
        logger.info(f"🚀 Starting multi-testbed execution: {multi_execution_id}")
        logger.info(f"   Testbeds: {len(testbed_configs)}")
        
        # Initialize execution tracking
        with self.lock:
            self.active_executions[multi_execution_id] = {
                'status': 'running',
                'started_at': datetime.utcnow().isoformat(),
                'total_testbeds': len(testbed_configs),
                'completed_testbeds': 0,
                'failed_testbeds': 0,
                'child_executions': {},
                'progress': {}
            }
        
        # Store in database
        self._save_to_database(multi_execution_id, testbed_configs, target_config, 
                              entities_config, ai_settings)
        
        # Start executions in background thread
        thread = threading.Thread(
            target=self._execute_parallel,
            args=(multi_execution_id, testbed_configs, target_config, entities_config, ai_settings),
            daemon=True
        )
        thread.start()
        
        return {
            'multi_execution_id': multi_execution_id,
            'status': 'started',
            'total_testbeds': len(testbed_configs),
            'message': f'Started execution on {len(testbed_configs)} testbeds'
        }
    
    def _execute_parallel(self, multi_execution_id: str, testbed_configs: List[Dict],
                         target_config: Dict, entities_config: Dict,
                         ai_settings: Optional[Dict]):
        """
        Execute Smart Executions in parallel using thread pool
        
        Args:
            multi_execution_id: Multi-execution ID
            testbed_configs: List of testbed configs
            target_config: Target configuration
            entities_config: Entities configuration
            ai_settings: AI settings
        """
        logger.info(f"📊 Executing on {len(testbed_configs)} testbeds in parallel...")
        
        child_executions = {}
        results = {}
        
        try:
            # Use ThreadPoolExecutor for parallel execution
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                # Submit all executions
                future_to_testbed = {}
                
                for testbed_config in testbed_configs:
                    testbed_id = testbed_config['unique_testbed_id']
                    
                    future = executor.submit(
                        self._execute_single_testbed,
                        multi_execution_id,
                        testbed_config,
                        target_config,
                        entities_config,
                        ai_settings
                    )
                    
                    future_to_testbed[future] = testbed_id
                
                # Collect results as they complete
                for future in as_completed(future_to_testbed):
                    testbed_id = future_to_testbed[future]
                    
                    try:
                        result = future.result()
                        child_executions[testbed_id] = result['execution_id']
                        results[testbed_id] = result
                        
                        # Update progress
                        with self.lock:
                            if multi_execution_id in self.active_executions:
                                self.active_executions[multi_execution_id]['completed_testbeds'] += 1
                                self.active_executions[multi_execution_id]['child_executions'][testbed_id] = result['execution_id']
                                self.active_executions[multi_execution_id]['progress'][testbed_id] = {
                                    'status': result.get('status', 'completed'),
                                    'execution_id': result['execution_id']
                                }
                        
                        logger.info(f"  ✅ Testbed {testbed_id}: {result['execution_id']}")
                        
                    except Exception as e:
                        logger.error(f"  ❌ Testbed {testbed_id} failed: {e}")
                        
                        with self.lock:
                            if multi_execution_id in self.active_executions:
                                self.active_executions[multi_execution_id]['failed_testbeds'] += 1
                                self.active_executions[multi_execution_id]['progress'][testbed_id] = {
                                    'status': 'failed',
                                    'error': str(e)
                                }
            
            # Calculate aggregate metrics
            aggregate_metrics = self._calculate_aggregate_metrics(results)
            
            # Determine overall status
            total = len(testbed_configs)
            completed = len(results)
            failed = total - completed
            
            if failed == 0:
                status = 'completed'
            elif completed == 0:
                status = 'failed'
            else:
                status = 'partial'
            
            # Update final status
            with self.lock:
                if multi_execution_id in self.active_executions:
                    self.active_executions[multi_execution_id]['status'] = status
                    self.active_executions[multi_execution_id]['completed_at'] = datetime.utcnow().isoformat()
                    self.active_executions[multi_execution_id]['aggregate_metrics'] = aggregate_metrics
            
            # Save final results to database
            self._update_database(multi_execution_id, status, child_executions, aggregate_metrics)
            
            logger.info(f"✅ Multi-testbed execution complete: {multi_execution_id}")
            logger.info(f"   Status: {status}")
            logger.info(f"   Completed: {completed}/{total}")
            logger.info(f"   Failed: {failed}/{total}")
            
        except Exception as e:
            logger.error(f"❌ Multi-testbed execution failed: {e}")
            logger.exception(e)
            
            with self.lock:
                if multi_execution_id in self.active_executions:
                    self.active_executions[multi_execution_id]['status'] = 'failed'
                    self.active_executions[multi_execution_id]['error'] = str(e)
    
    def _execute_single_testbed(self, multi_execution_id: str, testbed_config: Dict,
                               target_config: Dict, entities_config: Dict,
                               ai_settings: Optional[Dict]) -> Dict:
        """
        Execute Smart Execution on a single testbed
        
        Args:
            multi_execution_id: Parent multi-execution ID
            testbed_config: Testbed configuration
            target_config: Target configuration
            entities_config: Entities configuration
            ai_settings: AI settings
        
        Returns:
            Dict with execution result
        """
        testbed_id = testbed_config['unique_testbed_id']
        testbed_label = testbed_config.get('testbed_label', testbed_id)
        
        logger.info(f"  🔄 Starting execution on testbed: {testbed_label}")
        
        try:
            from services.smart_execution_engine_ai import SmartExecutionEngineAI
            
            # Create execution ID
            execution_id = f"MT-{multi_execution_id[-12:]}-{testbed_id[-8:]}"
            
            # Initialize AI engine
            ai_engine = SmartExecutionEngineAI(
                execution_id=execution_id,
                testbed_config=testbed_config,
                target_config=target_config,
                entities_config=entities_config,
                ai_settings=ai_settings or {}
            )
            
            # Run execution
            logger.info(f"    ▶️  Running AI execution: {execution_id}")
            result = ai_engine.run()
            
            return {
                'execution_id': execution_id,
                'testbed_id': testbed_id,
                'testbed_label': testbed_label,
                'status': 'completed',
                'result': result
            }
            
        except Exception as e:
            logger.error(f"    ❌ Execution failed on {testbed_label}: {e}")
            raise
    
    def _calculate_aggregate_metrics(self, results: Dict) -> Dict:
        """
        Calculate aggregate metrics across all testbed executions
        
        Args:
            results: Dictionary of execution results per testbed
        
        Returns:
            Dict with aggregate metrics
        """
        if not results:
            return {}
        
        total_operations = 0
        successful_operations = 0
        failed_operations = 0
        avg_cpu = 0
        avg_memory = 0
        avg_duration = 0
        
        for testbed_id, result in results.items():
            result_data = result.get('result', {})
            
            total_operations += result_data.get('total_operations', 0)
            successful_operations += result_data.get('successful_operations', 0)
            failed_operations += result_data.get('failed_operations', 0)
            avg_cpu += result_data.get('final_cpu', 0)
            avg_memory += result_data.get('final_memory', 0)
            avg_duration += result_data.get('duration_minutes', 0)
        
        count = len(results)
        
        return {
            'total_testbeds': count,
            'total_operations': total_operations,
            'successful_operations': successful_operations,
            'failed_operations': failed_operations,
            'avg_cpu_achieved': avg_cpu / count if count > 0 else 0,
            'avg_memory_achieved': avg_memory / count if count > 0 else 0,
            'avg_duration_minutes': avg_duration / count if count > 0 else 0,
            'success_rate': (successful_operations / total_operations * 100) if total_operations > 0 else 0
        }
    
    def get_execution_status(self, multi_execution_id: str) -> Optional[Dict]:
        """
        Get current status of a multi-testbed execution
        
        Args:
            multi_execution_id: Multi-execution ID
        
        Returns:
            Dict with status info or None
        """
        with self.lock:
            if multi_execution_id in self.active_executions:
                return self.active_executions[multi_execution_id].copy()
        
        # Check database if not in memory
        return self._get_from_database(multi_execution_id)
    
    def _save_to_database(self, multi_execution_id: str, testbed_configs: List[Dict],
                         target_config: Dict, entities_config: Dict,
                         ai_settings: Optional[Dict]):
        """Save multi-execution to database"""
        try:
            from database import SessionLocal
            from models.multi_testbed_execution import MultiTestbedExecution
            
            testbed_ids = [tb['unique_testbed_id'] for tb in testbed_configs]
            
            execution = MultiTestbedExecution(
                multi_execution_id=multi_execution_id,
                testbed_ids=testbed_ids,
                target_config=target_config,
                entities_config=entities_config,
                ai_settings=ai_settings,
                status='running',
                started_at=datetime.utcnow(),
                total_testbeds=len(testbed_ids)
            )
            
            session = SessionLocal()
            try:
                session.add(execution)
                session.commit()
                logger.info(f"  💾 Saved to database: {multi_execution_id}")
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to save to database: {e}")
    
    def _update_database(self, multi_execution_id: str, status: str,
                        child_executions: Dict, aggregate_metrics: Dict):
        """Update multi-execution in database"""
        try:
            from database import SessionLocal
            from models.multi_testbed_execution import MultiTestbedExecution
            
            session = SessionLocal()
            try:
                execution = session.query(MultiTestbedExecution).filter_by(
                    multi_execution_id=multi_execution_id
                ).first()
                
                if execution:
                    execution.status = status
                    execution.completed_at = datetime.utcnow()
                    execution.child_executions = child_executions
                    execution.aggregate_metrics = aggregate_metrics
                    execution.completed_testbeds = len(child_executions)
                    execution.failed_testbeds = execution.total_testbeds - len(child_executions)
                    
                    session.commit()
                    logger.info(f"  💾 Updated database: {multi_execution_id}")
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to update database: {e}")
    
    def _get_from_database(self, multi_execution_id: str) -> Optional[Dict]:
        """Get multi-execution from database"""
        try:
            from database import SessionLocal
            from models.multi_testbed_execution import MultiTestbedExecution
            
            session = SessionLocal()
            try:
                execution = session.query(MultiTestbedExecution).filter_by(
                    multi_execution_id=multi_execution_id
                ).first()
                
                if execution:
                    return execution.to_dict()
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to get from database: {e}")
        
        return None


# Global orchestrator instance
_orchestrator = None


def get_orchestrator() -> MultiTestbedOrchestrator:
    """Get global orchestrator instance"""
    global _orchestrator
    
    if _orchestrator is None:
        _orchestrator = MultiTestbedOrchestrator(max_workers=5)
    
    return _orchestrator


if __name__ == '__main__':
    print("\n" + "="*70)
    print("🧪 MULTI-TESTBED ORCHESTRATOR MODULE")
    print("="*70 + "\n")
    print("✅ Orchestrator module created successfully!")
    print("\nFeatures:")
    print("  ✅ Parallel execution with ThreadPoolExecutor")
    print("  ✅ Real-time progress tracking")
    print("  ✅ Aggregate metrics calculation")
    print("  ✅ Graceful error handling")
    print("  ✅ Database persistence")
    print("\n" + "="*70 + "\n")
