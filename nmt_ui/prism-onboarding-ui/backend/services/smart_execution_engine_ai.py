"""
AI-Powered Smart Execution Engine

Integrates PID Controller + ML Predictor with the existing Smart Execution system.
This is a replacement/enhancement of the basic rule-based control in SmartExecutionController.

Features:
- PID-based adaptive load control
- ML-powered operation selection
- Automatic learning from execution history
- Phase-aware execution (Ramp Up -> Maintain -> Ramp Down)
- Safety features (circuit breaker, emergency stop, limits)
"""

import logging
import asyncio
import time
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)

# Import PID Controller and ML Predictor
BACKEND_PATH = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_PATH / 'controllers'))
sys.path.insert(0, str(BACKEND_PATH / 'ml'))

try:
    from pid_controller import AdaptiveLoadController
    from operation_impact_predictor import OperationImpactPredictor, generate_synthetic_training_data
    AI_AVAILABLE = True
    logger.info("✅ AI/ML components loaded successfully")
except ImportError as e:
    AI_AVAILABLE = False
    logger.warning(f"⚠️  AI/ML components not available: {e}")
    AdaptiveLoadController = None
    OperationImpactPredictor = None


class SmartExecutionEngineAI:
    """
    AI-Powered Smart Execution Engine
    
    Replaces rule-based control with PID + ML for intelligent threshold management.
    """
    
    def __init__(
        self,
        execution_id: str,
        testbed_info: Dict,
        target_config: Dict,
        entities_config: Dict,
        rule_config: Dict = None,
        enable_ml: bool = True,
        data_collection_mode: bool = True
    ):
        """
        Initialize AI-powered execution engine
        
        Args:
            execution_id: Unique execution identifier
            testbed_info: Testbed connection details
            target_config: Target thresholds (cpu, memory)
            entities_config: Available entities and operations
            rule_config: Prometheus monitoring rules
            enable_ml: Enable ML predictions (falls back to PID-only if False)
            data_collection_mode: Collect data for ML training
        """
        self.execution_id = execution_id
        self.testbed_info = testbed_info
        self.target_config = target_config
        self.entities_config = entities_config
        self.rule_config = rule_config or {}
        
        self.enable_ml = enable_ml and AI_AVAILABLE
        self.data_collection_mode = data_collection_mode
        
        # Target thresholds
        self.target_cpu = target_config.get('cpu_threshold', 80.0)
        self.target_memory = target_config.get('memory_threshold', 75.0)
        
        # Initialize ML Predictor
        self.ml_predictor = None
        if self.enable_ml and OperationImpactPredictor:
            self.ml_predictor = OperationImpactPredictor()
            self._try_load_existing_model()
        
        # Initialize PID Controller
        self.adaptive_controller = None
        if AI_AVAILABLE and AdaptiveLoadController:
            self.adaptive_controller = AdaptiveLoadController(
                target_cpu=self.target_cpu,
                target_memory=self.target_memory,
                initial_ops_per_min=10.0,
                ml_predictor=self.ml_predictor
            )
        
        # Execution state
        self.phase = "initializing"  # initializing, ramp_up, maintain, ramp_down, completed, failed
        self.iteration = 0
        self.total_operations_executed = 0
        self.start_time = None
        self.end_time = None
        
        # Metrics & History
        self.metrics_history = []
        self.operation_history = []
        self.training_data = []  # Collect data for ML training
        
        # Safety features
        self.emergency_stop = False
        self.circuit_breaker_trips = 0
        self.max_circuit_breaker_trips = 3
        self.consecutive_failures = 0
        self.max_consecutive_failures = 5
        
        # Performance tracking
        self.phase_durations = {}
        self.recommendations_used = []
        
        logger.info(f"🤖 AI Smart Execution Engine initialized for {execution_id}")
        logger.info(f"   Target: {self.target_cpu}% CPU, {self.target_memory}% Memory")
        logger.info(f"   ML Enabled: {self.enable_ml}, PID Enabled: {self.adaptive_controller is not None}")
    
    def _try_load_existing_model(self):
        """Try to load a pre-trained ML model (per-testbed first, then global)"""
        try:
            from services.ml_training_service import get_model_for_testbed
            testbed_id = self.testbed_info.get('unique_testbed_id')
            loaded = get_model_for_testbed(testbed_id)
            if loaded.is_trained:
                self.ml_predictor = loaded
                logger.info(f"Loaded pre-trained ML model for testbed {testbed_id or 'global'}")
                return
        except Exception:
            pass

        # Fallback to original approach
        try:
            self.ml_predictor.load('production')
            logger.info("Loaded production ML model")
        except FileNotFoundError:
            logger.info("No pre-trained model found, will use defaults until trained")
        except Exception as e:
            logger.warning(f"Failed to load ML model: {e}")
    
    def calculate_next_action(self, current_metrics: Dict) -> Dict:
        """
        Main AI control loop: Calculate next action based on current metrics
        
        Args:
            current_metrics: Current system state {cpu, memory, cluster_size, ...}
            
        Returns:
            Dictionary with:
                - operations_per_minute: How many operations to execute per minute
                - recommended_operations: List of recommended entity-operation pairs
                - phase: Current execution phase
                - reasoning: Human-readable explanation
                - should_stop: Whether execution should stop
                - debug: Debug information
        """
        self.iteration += 1
        current_cpu = current_metrics.get('cpu', 0)
        current_memory = current_metrics.get('memory', 0)
        
        # Safety checks
        if self.emergency_stop:
            return self._emergency_stop_action()
        
        if self._check_circuit_breaker():
            return self._circuit_breaker_action()
        
        # Check if target reached
        threshold_reached = self._check_thresholds_reached(current_cpu, current_memory)
        
        # Use PID + ML if available, otherwise fallback to simple control
        if self.adaptive_controller:
            action = self.adaptive_controller.adjust_load(current_metrics)
            
            # Update phase from PID
            self.phase = action['phase']
            
            # Enhance with ML recommendations
            if action.get('recommended_operations'):
                action['recommended_operations'] = self._format_recommendations(
                    action['recommended_operations']
                )
            
            # Add stop condition
            action['should_stop'] = threshold_reached and self.phase == 'maintain'
            
            # Track metrics
            self.metrics_history.append({
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'cpu': current_cpu,
                'memory': current_memory,
                'phase': self.phase,
                'iteration': self.iteration,
                'operations_per_minute': action['operations_per_minute']
            })
            
            logger.info(f"🎯 Iteration {self.iteration}: {action['reasoning']}")
            
            return action
        
        else:
            # Fallback to simple control
            return self._fallback_control(current_cpu, current_memory, threshold_reached)
    
    def _check_thresholds_reached(self, cpu: float, memory: float) -> bool:
        """Check if target thresholds are reached"""
        stop_condition = self.target_config.get('stop_condition', 'any')
        
        cpu_reached = cpu >= self.target_cpu
        memory_reached = memory >= self.target_memory
        
        if stop_condition == 'any':
            return cpu_reached or memory_reached
        elif stop_condition == 'cpu':
            return cpu_reached
        elif stop_condition == 'memory':
            return memory_reached
        else:  # 'all'
            return cpu_reached and memory_reached
    
    def _check_circuit_breaker(self) -> bool:
        """Circuit breaker: Stop if too many failures"""
        if self.circuit_breaker_trips >= self.max_circuit_breaker_trips:
            logger.error(f"🚨 Circuit breaker tripped! {self.circuit_breaker_trips} failures")
            return True
        return False
    
    def _format_recommendations(self, recommendations: List[Dict]) -> List[Dict]:
        """Format ML recommendations into entity-operation format"""
        formatted = []
        for rec in recommendations:
            formatted.append({
                'entity_type': rec['entity'],
                'operation': rec['operation'],
                'predicted_cpu_impact': rec['cpu_impact'],
                'predicted_memory_impact': rec['memory_impact'],
                'confidence': rec.get('confidence', 0.5),
                'score': rec['score']
            })
        return formatted
    
    def record_operation_result(
        self,
        entity_type: str,
        operation: str,
        metrics_before: Dict,
        metrics_after: Dict,
        success: bool,
        duration: float
    ):
        """
        Record operation result for ML training
        
        Args:
            entity_type: Entity type executed
            operation: Operation executed
            metrics_before: Metrics before operation
            metrics_after: Metrics after operation
            success: Whether operation succeeded
            duration: Operation duration in seconds
        """
        self.total_operations_executed += 1
        
        if not success:
            self.consecutive_failures += 1
            if self.consecutive_failures >= self.max_consecutive_failures:
                self.circuit_breaker_trips += 1
                logger.error(f"⚠️  {self.consecutive_failures} consecutive failures!")
        else:
            self.consecutive_failures = 0  # Reset on success
        
        # Calculate impact
        cpu_impact = metrics_after.get('cpu', 0) - metrics_before.get('cpu', 0)
        memory_impact = metrics_after.get('memory', 0) - metrics_before.get('memory', 0)
        
        # Record operation
        operation_record = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'entity_type': entity_type,
            'operation': operation,
            'success': success,
            'duration': duration,
            'metrics_before': metrics_before,
            'metrics_after': metrics_after,
            'cpu_impact': cpu_impact,
            'memory_impact': memory_impact,
            'phase': self.phase
        }
        
        self.operation_history.append(operation_record)
        
        # Collect training data
        if self.data_collection_mode:
            training_sample = {
                'entity_type': entity_type,
                'operation': operation,
                'current_cpu': metrics_before.get('cpu', 0),
                'current_memory': metrics_before.get('memory', 0),
                'cluster_size': metrics_before.get('cluster_size', 1),
                'current_load': self.adaptive_controller.operations_per_minute if self.adaptive_controller else 10,
                'cpu_impact': max(0, cpu_impact),  # Only positive impacts
                'memory_impact': max(0, memory_impact)
            }
            self.training_data.append(training_sample)
        
        logger.debug(f"📊 {entity_type}.{operation}: CPU {cpu_impact:+.2f}%, Memory {memory_impact:+.2f}%")
    
    def train_ml_model(self) -> Optional[Dict]:
        """
        Train ML model on collected data
        
        Returns:
            Training metrics or None if insufficient data
        """
        if not self.enable_ml or not self.ml_predictor:
            logger.warning("⚠️  ML not enabled, skipping training")
            return None
        
        if len(self.training_data) < 20:
            logger.warning(f"⚠️  Insufficient training data: {len(self.training_data)} samples (need 20+)")
            
            # Use synthetic data to bootstrap
            logger.info("📚 Generating synthetic training data for bootstrapping...")
            synthetic_data = generate_synthetic_training_data(num_samples=100)
            self.training_data.extend(synthetic_data)
        
        try:
            logger.info(f"🎓 Training ML model on {len(self.training_data)} samples...")
            metrics = self.ml_predictor.train(self.training_data)
            
            # Save model
            self.ml_predictor.save('production')
            
            logger.info(f"✅ ML model trained successfully!")
            logger.info(f"   CPU Model: MAE={metrics['cpu_mae']}, R²={metrics['cpu_r2']}")
            logger.info(f"   Memory Model: MAE={metrics['memory_mae']}, R²={metrics['memory_r2']}")
            
            return metrics
        
        except Exception as e:
            logger.error(f"❌ ML training failed: {e}")
            return None
    
    def get_execution_summary(self) -> Dict:
        """
        Get comprehensive execution summary
        
        Returns:
            Dictionary with all execution details
        """
        duration = None
        if self.start_time:
            end = self.end_time or datetime.now(timezone.utc)
            duration = (end - self.start_time).total_seconds()
        
        # Calculate success rate
        successful_ops = sum(1 for op in self.operation_history if op['success'])
        success_rate = (successful_ops / len(self.operation_history) * 100) if self.operation_history else 0
        
        # Get final metrics
        final_metrics = self.metrics_history[-1] if self.metrics_history else {}
        
        # Calculate phase durations
        phase_times = {}
        last_phase = None
        last_time = None
        for metric in self.metrics_history:
            phase = metric['phase']
            timestamp = datetime.fromisoformat(metric['timestamp'])
            
            if last_phase and last_phase != phase:
                if last_phase not in phase_times:
                    phase_times[last_phase] = 0
                phase_times[last_phase] += (timestamp - last_time).total_seconds()
            
            last_phase = phase
            last_time = timestamp
        
        # PID statistics
        pid_stats = None
        if self.adaptive_controller:
            pid_stats = self.adaptive_controller.get_stats()
        
        # ML statistics
        ml_stats = None
        if self.ml_predictor and self.ml_predictor.is_trained:
            ml_stats = {
                'is_trained': True,
                'feature_importance': self.ml_predictor.get_feature_importance(),
                'recommendations_used': len(self.recommendations_used)
            }
        
        summary = {
            'execution_id': self.execution_id,
            'status': self.phase,
            'total_operations': self.total_operations_executed,
            'successful_operations': successful_ops,
            'success_rate': round(success_rate, 2),
            'duration_seconds': duration,
            'iterations': self.iteration,
            'target': {
                'cpu': self.target_cpu,
                'memory': self.target_memory
            },
            'final_metrics': {
                'cpu': final_metrics.get('cpu', 0),
                'memory': final_metrics.get('memory', 0)
            },
            'phase_durations': phase_times,
            'circuit_breaker_trips': self.circuit_breaker_trips,
            'training_data_collected': len(self.training_data),
            'pid_stats': pid_stats,
            'ml_stats': ml_stats,
            'ai_enabled': self.enable_ml,
            'emergency_stop': self.emergency_stop
        }
        
        return summary
    
    def _emergency_stop_action(self) -> Dict:
        """Return emergency stop action"""
        return {
            'operations_per_minute': 0,
            'recommended_operations': [],
            'phase': 'emergency_stop',
            'reasoning': '🚨 EMERGENCY STOP activated',
            'should_stop': True,
            'debug': {'emergency_stop': True}
        }
    
    def _circuit_breaker_action(self) -> Dict:
        """Return circuit breaker action"""
        return {
            'operations_per_minute': 0,
            'recommended_operations': [],
            'phase': 'failed',
            'reasoning': f'🚨 Circuit breaker tripped after {self.circuit_breaker_trips} failures',
            'should_stop': True,
            'debug': {'circuit_breaker': True, 'trips': self.circuit_breaker_trips}
        }
    
    def _fallback_control(self, cpu: float, memory: float, threshold_reached: bool) -> Dict:
        """Simple fallback control when AI/ML not available"""
        cpu_delta = self.target_cpu - cpu
        memory_delta = self.target_memory - memory
        min_delta = min(cpu_delta, memory_delta)
        
        if threshold_reached:
            ops_per_min = 0
            phase = 'maintain'
            reasoning = '✅ Target reached'
        elif min_delta > 20:
            ops_per_min = 30
            phase = 'ramp_up'
            reasoning = f'⬆️  Far from target ({min_delta:.1f}%), ramping up'
        elif min_delta > 10:
            ops_per_min = 15
            phase = 'ramp_up'
            reasoning = f'⬆️  Approaching target ({min_delta:.1f}%), moderate pace'
        elif min_delta > 5:
            ops_per_min = 5
            phase = 'fine_tune'
            reasoning = f'🎯 Close to target ({min_delta:.1f}%), fine tuning'
        else:
            ops_per_min = 2
            phase = 'fine_tune'
            reasoning = f'🎯 Very close to target ({min_delta:.1f}%), careful approach'
        
        self.phase = phase
        
        return {
            'operations_per_minute': ops_per_min,
            'recommended_operations': [],
            'phase': phase,
            'reasoning': reasoning,
            'should_stop': threshold_reached,
            'debug': {'fallback_mode': True, 'min_delta': min_delta}
        }
    
    def trigger_emergency_stop(self, reason: str = "Manual"):
        """Trigger emergency stop"""
        self.emergency_stop = True
        logger.error(f"🚨 EMERGENCY STOP triggered: {reason}")
    
    def start_execution(self):
        """Mark execution start"""
        self.start_time = datetime.now(timezone.utc)
        self.phase = 'ramp_up'
        logger.info(f"🚀 Execution started at {self.start_time.isoformat()}")
    
    def end_execution(self, reason: str = "Completed"):
        """Mark execution end"""
        self.end_time = datetime.now(timezone.utc)
        duration = (self.end_time - self.start_time).total_seconds() if self.start_time else 0
        logger.info(f"Execution ended: {reason} (Duration: {duration:.1f}s)")
        
        # Train ML model if we collected enough data (in-session training)
        if self.data_collection_mode and len(self.training_data) > 0:
            self.train_ml_model()

        # Trigger background DB-to-ML pipeline training
        try:
            from services.ml_training_service import check_auto_retrain
            testbed_id = self.testbed_info.get('unique_testbed_id')
            if testbed_id:
                check_auto_retrain(testbed_id)
        except Exception as e:
            logger.debug(f"DB-to-ML auto-retrain check skipped: {e}")
