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
        self.rule_config = rule_config or {}

        # Validate entities_config has real entity-operation pairs
        real_entities = {k: v for k, v in (entities_config or {}).items()
                        if k not in ('ai_enabled', 'ml_enabled') and isinstance(v, list) and v}
        if not real_entities:
            logger.warning(f"⚠️ [{execution_id}] entities_config is empty — "
                           "the control loop will apply defaults at runtime")
        self.entities_config = entities_config or {}
        
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
        
        # Initialize PID Controller with gap-based initial rate
        self.adaptive_controller = None
        if AI_AVAILABLE and AdaptiveLoadController:
            cpu_gap = max(self.target_cpu - 5.0, 0)   # assume ~5% idle baseline
            mem_gap = max(self.target_memory - 10.0, 0)
            min_gap = min(cpu_gap, mem_gap)
            if min_gap > 40:
                initial_rate = 50.0
            elif min_gap > 20:
                initial_rate = 30.0
            elif min_gap > 10:
                initial_rate = 20.0
            else:
                initial_rate = 10.0
            self.adaptive_controller = AdaptiveLoadController(
                target_cpu=self.target_cpu,
                target_memory=self.target_memory,
                initial_ops_per_min=initial_rate,
                ml_predictor=self.ml_predictor
            )
            logger.info(f"🚀 AI engine initial rate: {initial_rate} ops/min "
                        f"(cpu_gap={cpu_gap:.0f}%, mem_gap={mem_gap:.0f}%)")
        
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
        
        # Safety features — generous limits since API failures are expected under heavy load
        self.emergency_stop = False
        self.circuit_breaker_trips = 0
        self.max_circuit_breaker_trips = 10
        self.consecutive_failures = 0
        self.max_consecutive_failures = 15
        
        # Performance tracking
        self.phase_durations = {}
        self.recommendations_used = []

        # Sustain mode: hold load at threshold for N minutes before stopping
        self._sustain_minutes = target_config.get('sustain_minutes',
                                                   target_config.get('advanced', {}).get('sustain_minutes', 5))
        self._sustain_start_time: Optional[datetime] = None
        self._sustain_hysteresis_pct = 5.0
        self._sustain_stats: Dict[str, Any] = {
            'entered_at': None, 'duration_seconds': 0,
            'reescalations': 0, 'min_cpu': 999, 'max_cpu': 0,
            'min_memory': 999, 'max_memory': 0, 'ops_during_sustain': 0,
            'sustain_ops_per_minute': 0, 'stress_pod_restarts': 0,
        }
        
        logger.info(f"🤖 AI Smart Execution Engine initialized for {execution_id}")
        logger.info(f"   Target: {self.target_cpu}% CPU, {self.target_memory}% Memory")
        logger.info(f"   Sustain: {self._sustain_minutes} minutes after threshold")
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
            
            # Enforce minimum ops/min floor during ramp_up when far from target
            cpu_gap = self.target_cpu - current_cpu
            mem_gap = self.target_memory - current_memory
            min_gap = min(cpu_gap, mem_gap)
            if action['phase'] == 'ramp_up' and min_gap > 10:
                if min_gap > 40:
                    floor = 40.0
                elif min_gap > 20:
                    floor = 25.0
                else:
                    floor = 15.0
                if self.adaptive_controller.operations_per_minute < floor:
                    self.adaptive_controller.operations_per_minute = floor
                    action['operations_per_minute'] = floor

            # Update phase from PID — but don't overwrite sustaining
            if self.phase != 'sustaining':
                self.phase = action['phase']
            
            # Enhance with ML recommendations
            if action.get('recommended_operations'):
                action['recommended_operations'] = self._format_recommendations(
                    action['recommended_operations']
                )
            
            # Sustain logic: hold at threshold instead of immediate stop
            # Enter sustain when threshold is reached in maintain OR ramp_down
            # (ramp_down means we overshot — still counts as reaching the target)
            should_stop = False
            is_in_sustain = self.phase == 'sustaining'
            if threshold_reached and self.phase in ('maintain', 'ramp_down', 'fine_tune'):
                now = datetime.now(timezone.utc)
                if self._sustain_start_time is None:
                    self._sustain_start_time = now
                    self._sustain_stats['entered_at'] = now.isoformat()
                    self.phase = 'sustaining'
                    is_in_sustain = True
                    logger.info(f"🎯 Threshold reached! Sustaining for {self._sustain_minutes}m. CPU={current_cpu:.1f}%, Mem={current_memory:.1f}%")

            if is_in_sustain or (threshold_reached and self.phase == 'sustaining'):
                now = datetime.now(timezone.utc)
                elapsed_min = (now - self._sustain_start_time).total_seconds() / 60 if self._sustain_start_time else 0
                self._sustain_stats['duration_seconds'] = elapsed_min * 60
                self._sustain_stats['min_cpu'] = min(self._sustain_stats['min_cpu'], current_cpu)
                self._sustain_stats['max_cpu'] = max(self._sustain_stats['max_cpu'], current_cpu)
                self._sustain_stats['min_memory'] = min(self._sustain_stats['min_memory'], current_memory)
                self._sustain_stats['max_memory'] = max(self._sustain_stats['max_memory'], current_memory)
                sustain_ops = self._sustain_stats.get('ops_during_sustain', 0)
                self._sustain_stats['sustain_ops_per_minute'] = round(sustain_ops / max(elapsed_min, 0.1), 1)

                cpu_floor = self.target_cpu - self._sustain_hysteresis_pct
                mem_floor = self.target_memory - self._sustain_hysteresis_pct
                if current_cpu < cpu_floor or current_memory < mem_floor:
                    self._sustain_stats['reescalations'] = self._sustain_stats.get('reescalations', 0) + 1
                    action['operations_per_minute'] = max(action['operations_per_minute'], 30.0)
                    logger.info(f"📉 Load dropped during sustain, increasing ops. CPU={current_cpu:.1f}%, Mem={current_memory:.1f}%")
                else:
                    action['operations_per_minute'] = max(action['operations_per_minute'], 15.0)

                if elapsed_min >= self._sustain_minutes:
                    logger.info(f"✅ Sustain complete ({self._sustain_minutes}m). CPU={current_cpu:.1f}%, Mem={current_memory:.1f}%. "
                               f"Ops during sustain: {sustain_ops} ({self._sustain_stats['sustain_ops_per_minute']}/min)")
                    should_stop = True

            action['should_stop'] = should_stop
            
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
        duration: float,
        entity_name: str = '',
        iteration: Optional[int] = None,
        result: Optional[Dict] = None,
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
            entity_name: Name of the entity that was operated on
            iteration: The control-loop iteration index this op belonged to.
                Required for ``failure_timeline`` and ``iteration_timeline``
                grouping in the enhanced report — without it every failure
                renders as "Iter #None" and ``_op_iteration_matches`` can't
                bucket ops by iteration.
            result: The raw dict returned by ``_execute_single_operation``.
                We harvest ``http_status_code``, ``error``, ``error_type``,
                ``error_code``, ``api_url``, ``http_method``, ``request_payload``
                and ``response_body`` so the report's
                ``error_code_breakdown`` and "Failure Root Cause Analysis"
                cards can show actual HTTP codes / error categories instead
                of falling back to the "Unknown" bucket.
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

        result = result if isinstance(result, dict) else {}

        # Record operation
        operation_record = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'entity_type': entity_type,
            'operation': operation,
            'entity_name': entity_name or f"smart-{entity_type.lower()}-{self.total_operations_executed}",
            'success': success,
            'status': 'SUCCESS' if success else 'FAILED',
            'duration': duration,
            'duration_seconds': duration,
            'metrics_before': metrics_before,
            'metrics_after': metrics_after,
            'cpu_impact': cpu_impact,
            'memory_impact': memory_impact,
            'phase': self.phase,
            'iteration': iteration if iteration is not None else self.iteration,
            'mode': result.get('mode'),
            'http_status_code': result.get('http_status_code') or result.get('error_code'),
            'error_code': result.get('error_code'),
            'error': result.get('error'),
            'error_type': result.get('error_type'),
            'api_url': result.get('api_url'),
            'http_method': result.get('http_method'),
            'request_payload': result.get('request_payload'),
            'response_body': result.get('response_body'),
            'entity_uuid': result.get('entity_uuid') or result.get('uuid'),
            'operation_id': result.get('operation_id'),
            'sequence_number': result.get('sequence_number'),
            'start_time': result.get('start_time'),
            'end_time': result.get('end_time'),
        }
        
        self.operation_history.append(operation_record)
        
        # Collect training data — record actual impact (including zero for failures)
        # so the model learns which operations actually generate load
        if self.data_collection_mode:
            effective_cpu = cpu_impact if success else 0.0
            effective_mem = memory_impact if success else 0.0
            training_sample = {
                'entity_type': entity_type,
                'operation': operation,
                'current_cpu': metrics_before.get('cpu', 0),
                'current_memory': metrics_before.get('memory', 0),
                'cluster_size': metrics_before.get('cluster_size', 1),
                'current_load': self.adaptive_controller.operations_per_minute if self.adaptive_controller else 10,
                'cpu_impact': max(0, effective_cpu),
                'memory_impact': max(0, effective_mem)
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
            'failed_operations': self.total_operations_executed - successful_ops,
            'success_rate': round(success_rate, 2),
            'duration_seconds': duration,
            'duration_minutes': round(duration / 60, 2) if duration else None,
            'iterations': self.iteration,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'testbed_label': self.testbed_info.get('testbed_label', 'Unknown'),
            # Surface testbed_id at the top level so EnhancedReportService's
            # historical comparison query has something to filter on.
            # ``target_config`` doesn't carry testbed_id, so without this
            # ``historical_comparison.reason`` is permanently "No testbed ID".
            'testbed_id': (
                self.testbed_info.get('unique_testbed_id')
                or self.testbed_info.get('testbed_id')
            ),
            'target_config': self.target_config,
            'target': {
                'cpu': self.target_cpu,
                'memory': self.target_memory
            },
            'current_metrics': {
                'cpu_percent': final_metrics.get('cpu', 0),
                'memory_percent': final_metrics.get('memory', 0),
                'cpu': final_metrics.get('cpu', 0),
                'memory': final_metrics.get('memory', 0),
            },
            'final_metrics': {
                'cpu': final_metrics.get('cpu', 0),
                'memory': final_metrics.get('memory', 0),
                'cpu_percent': final_metrics.get('cpu', 0),
                'memory_percent': final_metrics.get('memory', 0),
            },
            'baseline_metrics': {
                'cpu': self.metrics_history[0].get('cpu', 0) if self.metrics_history else 0,
                'memory': self.metrics_history[0].get('memory', 0) if self.metrics_history else 0,
                'cpu_percent': self.metrics_history[0].get('cpu', 0) if self.metrics_history else 0,
                'memory_percent': self.metrics_history[0].get('memory', 0) if self.metrics_history else 0,
            },
            'phase_durations': phase_times,
            'circuit_breaker_trips': self.circuit_breaker_trips,
            'training_data_collected': len(self.training_data),
            'pid_stats': pid_stats,
            'ml_stats': ml_stats,
            'ai_enabled': self.enable_ml,
            'emergency_stop': self.emergency_stop,
            'operations_history': self.operation_history[-200:],
            'metrics_history': self.metrics_history[-200:],
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
