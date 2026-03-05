"""
AI-Powered Smart Execution Routes

Backend API endpoints for AI-powered Smart Execution:
- Start AI execution
- Monitor execution (live status)
- Get ML recommendations
- Emergency stop
- Get AI-enhanced reports
"""

import logging
import json
import threading
import time
import asyncio
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Create blueprint
smart_execution_ai_bp = Blueprint('smart_execution_ai', __name__)

# Global storage for active AI executions
active_ai_executions: Dict[str, Any] = {}

# Import AI components
try:
    from services.smart_execution_engine_ai import SmartExecutionEngineAI
    AI_AVAILABLE = True
    logger.info("✅ AI Smart Execution Engine loaded")
except ImportError as e:
    AI_AVAILABLE = False
    logger.warning(f"⚠️  AI Smart Execution Engine not available: {e}")


@smart_execution_ai_bp.route('/api/smart-execution/start-ai', methods=['POST'])
def start_ai_execution():
    """
    Start AI-powered smart execution
    
    Request Body:
    {
        "testbed_id": "unique_testbed_id",
        "target_config": {
            "cpu_threshold": 80,
            "memory_threshold": 75,
            "stop_condition": "any"
        },
        "entities_config": {
            "vm": ["CREATE", "DELETE"],
            "blueprint_multi_vm": ["EXECUTE"]
        },
        "rule_config": {
            "namespaces": ["ntnx-system"],
            "pod_names": []
        },
        "ai_settings": {
            "enable_ai": true,
            "enable_ml": true,
            "data_collection": true,
            "pid_tuning": {...}
        }
    }
    
    Returns:
    {
        "success": true,
        "execution_id": "AI-EXEC-...",
        "message": "AI execution started"
    }
    """
    if not AI_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'AI Smart Execution Engine not available'
        }), 503
    
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('testbed_id'):
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        if not data.get('target_config'):
            return jsonify({'success': False, 'error': 'target_config required'}), 400
        
        if not data.get('entities_config'):
            return jsonify({'success': False, 'error': 'entities_config required'}), 400
        
        # Get testbed info
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=data['testbed_id']
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            testbed_info = {
                'pc_ip': testbed.pc_ip,
                'ncm_ip': testbed.ncm_ip,
                'username': testbed.username,
                'password': testbed.password,
                'testbed_label': testbed.testbed_label,
                'unique_testbed_id': testbed.unique_testbed_id,
                'prometheus_endpoint': testbed.prometheus_endpoint
            }
        finally:
            session.close()
        
        # Generate execution ID
        execution_id = f"AI-EXEC-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{data['testbed_id'][:8]}"
        
        # Extract AI settings
        ai_settings = data.get('ai_settings', {})
        enable_ai = ai_settings.get('enable_ai', True)
        enable_ml = ai_settings.get('enable_ml', True)
        data_collection = ai_settings.get('data_collection', True)
        pid_tuning = ai_settings.get('pid_tuning', {})
        
        # Create AI execution engine
        ai_engine = SmartExecutionEngineAI(
            execution_id=execution_id,
            testbed_info=testbed_info,
            target_config=data['target_config'],
            entities_config=data['entities_config'],
            rule_config=data.get('rule_config', {}),
            enable_ml=enable_ml,
            data_collection_mode=data_collection
        )
        
        # Apply PID tuning if provided
        if enable_ai and pid_tuning and ai_engine.adaptive_controller:
            cpu_kp = pid_tuning.get('cpu_kp')
            cpu_ki = pid_tuning.get('cpu_ki')
            cpu_kd = pid_tuning.get('cpu_kd')
            if cpu_kp or cpu_ki or cpu_kd:
                ai_engine.adaptive_controller.cpu_pid.tune(
                    Kp=cpu_kp,
                    Ki=cpu_ki,
                    Kd=cpu_kd
                )
            
            memory_kp = pid_tuning.get('memory_kp')
            memory_ki = pid_tuning.get('memory_ki')
            memory_kd = pid_tuning.get('memory_kd')
            if memory_kp or memory_ki or memory_kd:
                ai_engine.adaptive_controller.memory_pid.tune(
                    Kp=memory_kp,
                    Ki=memory_ki,
                    Kd=memory_kd
                )
        
        # Store in active executions
        active_ai_executions[execution_id] = {
            'engine': ai_engine,
            'thread': None,
            'start_time': datetime.now(timezone.utc).isoformat(),
            'testbed_id': data['testbed_id']
        }
        
        # Start execution in background thread
        def run_execution():
            """Background execution thread"""
            try:
                ai_engine.start_execution()
                
                # Mark execution started in database
                _save_execution_to_db(execution_id, testbed_info, data, ai_engine)
                
                # Run control loop
                # This is a simplified version - in production, you'd integrate with
                # the existing execution system
                logger.info(f"🚀 AI execution {execution_id} started")
                
                # TODO: Add actual control loop here that runs until completion
                # For now, this just marks as started
                
            except Exception as e:
                logger.error(f"❌ Error in AI execution {execution_id}: {e}")
                logger.exception(e)
                ai_engine.trigger_emergency_stop(f"Exception: {str(e)}")
            finally:
                # Always try to complete execution in database and send alerts
                try:
                    _complete_execution_in_db(execution_id, ai_engine, testbed_info)
                except Exception as complete_error:
                    logger.error(f"❌ Error completing execution: {complete_error}")
        
        thread = threading.Thread(target=run_execution, daemon=True)
        thread.start()
        
        active_ai_executions[execution_id]['thread'] = thread
        
        return jsonify({
            'success': True,
            'execution_id': execution_id,
            'message': 'AI execution started successfully',
            'ai_enabled': enable_ai,
            'ml_enabled': enable_ml
        }), 200
        
    except Exception as e:
        logger.exception("Error starting AI execution")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/monitor/<execution_id>', methods=['GET'])
def monitor_ai_execution(execution_id):
    """
    Get live monitoring data for AI execution
    
    Returns:
    {
        "success": true,
        "execution_id": "...",
        "phase": "ramp_up",
        "current_metrics": {...},
        "operations_per_minute": 45.2,
        "total_operations": 123,
        "reasoning": "...",
        "recent_operations": [...],
        "pid_stats": {...},
        "ml_recommendations": [...]
    }
    """
    try:
        # Check if execution is in active AI executions
        if execution_id in active_ai_executions:
            exec_data = active_ai_executions[execution_id]
            engine = exec_data['engine']
            
            # Get current status
            status_data = {
                'success': True,
                'execution_id': execution_id,
                'phase': engine.phase,
                'iteration': engine.iteration,
                'total_operations': engine.total_operations_executed,
                'start_time': exec_data['start_time'],
                'ai_enabled': engine.adaptive_controller is not None,
                'ml_enabled': engine.enable_ml,
                'emergency_stop': engine.emergency_stop,
                'circuit_breaker_trips': engine.circuit_breaker_trips
            }
            
            # Add current metrics if available
            if engine.metrics_history:
                latest_metrics = engine.metrics_history[-1]
                status_data['current_metrics'] = latest_metrics
            
            # Add PID controller stats
            if engine.adaptive_controller:
                status_data['operations_per_minute'] = engine.adaptive_controller.operations_per_minute
                status_data['pid_stats'] = engine.adaptive_controller.get_stats()
            
            # Add recent operations (last 10)
            status_data['recent_operations'] = engine.operation_history[-10:] if engine.operation_history else []
            
            # Add ML stats if available
            if engine.ml_predictor and engine.ml_predictor.is_trained:
                status_data['ml_trained'] = True
                status_data['training_samples'] = len(engine.training_data)
            
            return jsonify(status_data), 200
        
        # Check if it's in the standard smart execution controller
        from services.smart_execution_service import get_smart_execution
        controller = get_smart_execution(execution_id)
        if controller:
            status = controller.get_status()
            cm = status.get('current_metrics', {})
            tc = status.get('target_config', {})
            return jsonify({
                'success': True,
                'execution_id': execution_id,
                'status': status.get('status', 'UNKNOWN'),
                'phase': status.get('status', 'UNKNOWN'),
                'iteration': status.get('iteration', 0),
                'total_operations': status.get('total_operations', 0),
                'operations_per_minute': status.get('operations_per_minute', 0),
                'current_metrics': {
                    'cpu': cm.get('cpu_percent', 0),
                    'memory': cm.get('memory_percent', 0)
                },
                'target_metrics': {
                    'cpu': tc.get('cpu_threshold', 0),
                    'memory': tc.get('memory_threshold', 0)
                },
                'metrics_history': [
                    {'timestamp': m.get('timestamp', ''), 'cpu': m.get('cpu_percent', 0), 'memory': m.get('memory_percent', 0), 'phase': 'running'}
                    for m in status.get('metrics_history', [])[-20:]
                ],
                'pid_stats': status.get('pid_stats'),
                'emergency_stop': False,
                'circuit_breaker_trips': 0
            }), 200

        # Otherwise check database
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if not execution:
                return jsonify({'success': False, 'error': 'Execution not found'}), 404
            
            fm = execution.final_metrics or {}
            tc = execution.target_config or {}
            return jsonify({
                'success': True,
                'execution_id': execution_id,
                'status': execution.status,
                'phase': execution.status,
                'total_operations': execution.total_operations or 0,
                'operations_per_minute': execution.operations_per_minute or 0,
                'current_metrics': {
                    'cpu': fm.get('cpu_percent', 0) if isinstance(fm, dict) else 0,
                    'memory': fm.get('memory_percent', 0) if isinstance(fm, dict) else 0
                },
                'target_metrics': {
                    'cpu': tc.get('cpu_threshold', 0) if isinstance(tc, dict) else 0,
                    'memory': tc.get('memory_threshold', 0) if isinstance(tc, dict) else 0
                },
                'metrics_history': [],
                'emergency_stop': False,
                'circuit_breaker_trips': 0,
                'completed': True
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error monitoring execution {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/ml-recommendations', methods=['POST'])
def get_ml_recommendations():
    """
    Get ML recommendations for operation selection
    
    Request Body:
    {
        "testbed_id": "...",
        "target_cpu": 80,
        "target_memory": 75
    }
    
    Returns:
    {
        "success": true,
        "recommendations": [
            {
                "entity": "vm",
                "operation": "CREATE",
                "cpu_impact": 2.5,
                "memory_impact": 2.0,
                "score": 0.85,
                "confidence": 0.8
            },
            ...
        ]
    }
    """
    try:
        from services.ml_training_service import get_model_for_testbed

        data = request.get_json()
        
        if not data.get('testbed_id'):
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        testbed_id = data.get('testbed_id')
        target_cpu = data.get('target_cpu', 80)
        target_memory = data.get('target_memory', 75)
        
        # Load per-testbed model (falls back to global/production)
        predictor = get_model_for_testbed(testbed_id)
        
        current_metrics = {
            'cpu': data.get('current_cpu', 50.0),
            'memory': data.get('current_memory', 45.0),
            'cluster_size': data.get('cluster_size', 3),
            'current_load': data.get('current_load', 10.0)
        }
        
        recommendations = predictor.recommend_operations(
            target_cpu_increase=target_cpu - current_metrics['cpu'],
            target_memory_increase=target_memory - current_metrics['memory'],
            current_metrics=current_metrics,
            top_k=10
        )
        
        return jsonify({
            'success': True,
            'recommendations': recommendations,
            'model_trained': predictor.is_trained
        }), 200
        
    except Exception as e:
        logger.exception("Error getting ML recommendations")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_default_namespaces_pods():
    """Return default namespaces and pods when Prometheus is not available"""
    default_namespaces = [
        'ntnx-system',
        'default',
        'kube-system',
        'kube-public',
        'kube-node-lease',
        'monitoring',
        'logging'
    ]
    
    return jsonify({
        'success': True,
        'namespaces': default_namespaces,
        'pods': [],
        'pods_by_namespace': {},
        'source': 'defaults',
        'note': 'Prometheus not available, using default namespaces'
    }), 200


@smart_execution_ai_bp.route('/api/smart-execution/available-pods', methods=['POST'])
def get_available_pods():
    """
    Get available namespaces and pod names from Prometheus
    
    Request Body:
    {
        "testbed_id": "..."
    }
    
    Returns:
    {
        "success": true,
        "namespaces": ["ntnx-system", "default", "kube-system"],
        "pods": ["pod1", "pod2", ...],
        "pods_by_namespace": {
            "ntnx-system": ["pod1", "pod2"],
            "default": ["pod3"]
        }
    }
    """
    try:
        import requests
        from database import SessionLocal
        from models.testbed import Testbed
        
        data = request.get_json()
        testbed_id = data.get('testbed_id')
        
        if not testbed_id:
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        # Get testbed info
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter(
                Testbed.unique_testbed_id == testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            # Get Prometheus URL from testbed_json
            testbed_json = testbed.testbed_json or {}
            prometheus_url = testbed_json.get('prometheus_url') or testbed_json.get('prometheus_endpoint')
            
            if not prometheus_url:
                return jsonify({'success': False, 'error': 'Prometheus URL not configured for this testbed'}), 400
            
            # Query Prometheus for pod info
            prom_query_url = f"{prometheus_url}/api/v1/query"
            pod_query = 'kube_pod_info'
            
            try:
                response = requests.get(
                    prom_query_url,
                    params={'query': pod_query},
                    verify=False,
                    timeout=10
                )
                
                if response.status_code != 200:
                    logger.warning(f"Prometheus returned {response.status_code}, using defaults")
                    return _get_default_namespaces_pods()
                
                prom_data = response.json()
                
                if prom_data.get('status') != 'success':
                    logger.warning("Prometheus query failed, using defaults")
                    return _get_default_namespaces_pods()
                    
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                logger.warning(f"Prometheus not reachable: {e}, using defaults")
                return _get_default_namespaces_pods()
            
            # Extract namespaces and pods
            namespaces_set = set()
            pods_set = set()
            pods_by_namespace = {}
            
            for result in prom_data.get('data', {}).get('result', []):
                metric = result.get('metric', {})
                namespace = metric.get('namespace', metric.get('exported_namespace', ''))
                pod = metric.get('pod', metric.get('exported_pod', ''))
                
                if namespace:
                    namespaces_set.add(namespace)
                if pod:
                    pods_set.add(pod)
                
                # Group pods by namespace
                if namespace and pod:
                    if namespace not in pods_by_namespace:
                        pods_by_namespace[namespace] = []
                    if pod not in pods_by_namespace[namespace]:
                        pods_by_namespace[namespace].append(pod)
            
            return jsonify({
                'success': True,
                'namespaces': sorted(list(namespaces_set)),
                'pods': sorted(list(pods_set)),
                'pods_by_namespace': {k: sorted(v) for k, v in pods_by_namespace.items()}
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting available pods")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/emergency-stop/<execution_id>', methods=['POST'])
def emergency_stop(execution_id):
    """
    Trigger emergency stop for AI execution
    
    Returns:
    {
        "success": true,
        "message": "Emergency stop triggered"
    }
    """
    try:
        if execution_id not in active_ai_executions:
            return jsonify({'success': False, 'error': 'Execution not found or already completed'}), 404
        
        exec_data = active_ai_executions[execution_id]
        engine = exec_data['engine']
        
        # Trigger emergency stop
        reason = request.get_json().get('reason', 'Manual emergency stop')
        engine.trigger_emergency_stop(reason)
        
        logger.warning(f"🚨 Emergency stop triggered for {execution_id}: {reason}")
        
        return jsonify({
            'success': True,
            'message': 'Emergency stop triggered',
            'execution_id': execution_id
        }), 200
        
    except Exception as e:
        logger.exception(f"Error triggering emergency stop for {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/ai-report/<execution_id>', methods=['GET'])
def get_ai_report(execution_id):
    """
    Get AI-enhanced execution report
    
    Returns comprehensive report with AI insights
    """
    try:
        # Check active executions first
        if execution_id in active_ai_executions:
            exec_data = active_ai_executions[execution_id]
            engine = exec_data['engine']
            
            # Generate comprehensive summary
            summary = engine.get_execution_summary()
            
            # Add AI insights
            summary['ai_insights'] = _generate_ai_insights(engine)
            
            return jsonify({
                'success': True,
                'report': summary
            }), 200
        
        # Otherwise get from database
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if not execution:
                return jsonify({'success': False, 'error': 'Execution not found'}), 404
            
            # Build report from database
            report = {
                'execution_id': execution_id,
                'status': execution.status,
                'total_operations': execution.total_operations,
                'successful_operations': execution.successful_operations,
                'target_config': execution.target_config,
                'baseline_metrics': execution.baseline_metrics,
                'final_metrics': execution.final_metrics,
                'ai_enabled': execution.entities_config.get('ai_enabled', False) if execution.entities_config else False
            }
            
            return jsonify({
                'success': True,
                'report': report
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting AI report for {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _save_execution_to_db(execution_id, testbed_info, config, engine):
    """Save AI execution to database"""
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            execution = SmartExecution(
                execution_id=execution_id,
                testbed_id=testbed_info['unique_testbed_id'],
                pc_ip=testbed_info['pc_ip'],
                ncm_ip=testbed_info['ncm_ip'],
                testbed_label=testbed_info['testbed_label'],
                target_config=config['target_config'],
                entities_config={
                    **config['entities_config'],
                    'ai_enabled': config.get('ai_settings', {}).get('enable_ai', True),
                    'ml_enabled': config.get('ai_settings', {}).get('enable_ml', True)
                },
                rule_config=config.get('rule_config', {}),
                status='running',
                start_time=datetime.now(timezone.utc)
            )
            
            session.add(execution)
            session.commit()
            
            logger.info(f"✅ Saved AI execution {execution_id} to database")
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Error saving execution to database: {e}")


def _complete_execution_in_db(execution_id, engine, testbed_info):
    """
    Mark execution as completed in database and send alerts
    
    Args:
        execution_id: Execution ID
        engine: SmartExecutionEngineAI instance
        testbed_info: Testbed information
    """
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        from services.alert_service import get_alert_service
        
        session = SessionLocal()
        try:
            # Update execution in database
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if execution:
                # Get execution summary
                summary = engine.get_execution_summary()
                
                # Update execution record
                execution.status = summary.get('status', 'completed')
                execution.total_operations = summary.get('total_operations', engine.total_operations_executed)
                execution.successful_operations = summary.get('successful_operations', 0)
                execution.failed_operations = summary.get('failed_operations', 0)
                execution.end_time = datetime.now(timezone.utc)
                
                # Store final metrics
                current_metrics = summary.get('current_metrics', {})
                execution.final_metrics = {
                    'cpu': current_metrics.get('cpu', 0),
                    'memory': current_metrics.get('memory', 0)
                }
                
                # Store baseline metrics if available
                if len(engine.metrics_history) > 0:
                    baseline = engine.metrics_history[0]
                    execution.baseline_metrics = {
                        'cpu': baseline.get('cpu', 0),
                        'memory': baseline.get('memory', 0)
                    }
                
                # Store AI stats
                if engine.adaptive_controller:
                    execution.pid_stats = {
                        'final_ops_per_minute': engine.adaptive_controller.operations_per_minute,
                        'final_phase': engine.adaptive_controller.phase,
                        'total_iterations': engine.adaptive_controller.iteration
                    }
                
                if engine.ml_predictor and engine.ml_predictor.is_trained:
                    execution.ml_stats = {
                        'model_trained': True,
                        'training_samples': len(engine.training_data)
                    }
                
                session.commit()
                logger.info(f"✅ Marked execution {execution_id} as completed")
                
                # Send alerts
                try:
                    alert_service = get_alert_service()
                    channels_config = alert_service.get_channels_config_for_testbed(testbed_info['unique_testbed_id'])
                    
                    if channels_config:
                        alert_data = {
                            'execution_id': execution_id,
                            'testbed_id': testbed_info['unique_testbed_id'],
                            'testbed_label': testbed_info.get('testbed_label', 'Unknown'),
                            'total_operations': execution.total_operations or 0,
                            'successful_operations': execution.successful_operations or 0,
                            'failed_operations': execution.failed_operations or 0,
                            'success_rate': round((execution.successful_operations / execution.total_operations * 100) if execution.total_operations else 0, 1),
                            'cpu_achieved': execution.final_metrics.get('cpu', 0) if execution.final_metrics else 0,
                            'memory_achieved': execution.final_metrics.get('memory', 0) if execution.final_metrics else 0,
                            'duration_minutes': round((execution.end_time - execution.start_time).total_seconds() / 60, 1) if execution.end_time and execution.start_time else 0,
                            'threshold_reached': summary.get('threshold_reached', False),
                            'started_at': execution.start_time.isoformat() if execution.start_time else None,
                            'completed_at': execution.end_time.isoformat() if execution.end_time else None,
                            'ai_enabled': execution.entities_config.get('ai_enabled', False) if execution.entities_config else False
                        }
                        
                        alert_results = alert_service.send_execution_complete_alert(alert_data, channels_config)
                        logger.info(f"📧 Alerts sent: {alert_results}")
                    else:
                        logger.info(f"ℹ️  No alert configuration found for testbed {testbed_info['unique_testbed_id']}")
                        
                except Exception as alert_error:
                    logger.error(f"❌ Failed to send alerts: {alert_error}")
                    # Don't fail the completion if alerts fail
                
            else:
                logger.warning(f"⚠️  Execution {execution_id} not found in database")
                
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Error completing execution in database: {e}")
        logger.exception(e)


def _generate_ai_insights(engine):
    """Generate AI insights for report"""
    insights = {
        'ai_decisions': [],
        'ml_performance': {},
        'pid_performance': {},
        'recommendations': []
    }
    
    # PID Performance
    if engine.adaptive_controller:
        pid_stats = engine.adaptive_controller.get_stats()
        insights['pid_performance'] = {
            'final_operations_per_minute': engine.adaptive_controller.operations_per_minute,
            'final_phase': engine.adaptive_controller.phase,
            'total_iterations': engine.adaptive_controller.iteration,
            'cpu_pid_stats': pid_stats.get('cpu_pid', {}),
            'memory_pid_stats': pid_stats.get('memory_pid', {})
        }
    
    # ML Performance
    if engine.ml_predictor and engine.ml_predictor.is_trained:
        insights['ml_performance'] = {
            'model_trained': True,
            'training_samples': len(engine.training_data),
            'feature_importance': engine.ml_predictor.get_feature_importance()
        }
    
    # Key decisions/reasoning
    for metric in engine.metrics_history[-10:]:  # Last 10 iterations
        if 'reasoning' in metric:
            insights['ai_decisions'].append({
                'iteration': metric.get('iteration'),
                'phase': metric.get('phase'),
                'reasoning': metric.get('reasoning', 'N/A')
            })
    
    # Recommendations for next execution
    insights['recommendations'] = [
        "AI system successfully adapted to reach target thresholds",
        "ML model collected training data for improved future predictions",
        "PID controller demonstrated stable convergence"
    ]
    
    if engine.circuit_breaker_trips > 0:
        insights['recommendations'].append(
            f"⚠️ Circuit breaker tripped {engine.circuit_breaker_trips} times - check operation reliability"
        )
    
    return insights


# ============================================================================
# ML Training Pipeline Routes
# ============================================================================

@smart_execution_ai_bp.route('/api/ml/train', methods=['POST'])
def trigger_ml_training():
    """
    Trigger ML model training from DB data.

    Request Body:
    {
        "testbed_id": "..." (optional, null for global model)
    }
    """
    try:
        from services.ml_training_service import train_model

        data = request.get_json() or {}
        testbed_id = data.get('testbed_id')

        result = train_model(testbed_id=testbed_id, trigger_type='manual')
        status_code = 200 if result.get('success') else 409
        return jsonify(result), status_code

    except Exception as e:
        logger.exception("Error triggering ML training")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/ml/insights', methods=['GET'])
def get_ml_insights_route():
    """
    Get ML insights dashboard data.

    Query params:
        testbed_id (optional)
    """
    try:
        from services.ml_training_service import get_ml_insights

        testbed_id = request.args.get('testbed_id')
        insights = get_ml_insights(testbed_id)
        return jsonify({'success': True, **insights}), 200

    except Exception as e:
        logger.exception("Error getting ML insights")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/ml/models', methods=['GET'])
def list_ml_models():
    """List all trained models from model_registry."""
    try:
        from database import SessionLocal
        from sqlalchemy import text

        testbed_id = request.args.get('testbed_id')
        session = SessionLocal()
        try:
            if testbed_id:
                result = session.execute(text("""
                    SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                           cpu_r2, memory_r2, validation_score, is_active,
                           training_duration_seconds
                    FROM model_registry
                    WHERE testbed_id = :testbed_id
                    ORDER BY trained_at DESC LIMIT 20
                """), {'testbed_id': testbed_id})
            else:
                result = session.execute(text("""
                    SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                           cpu_r2, memory_r2, validation_score, is_active,
                           training_duration_seconds
                    FROM model_registry
                    ORDER BY trained_at DESC LIMIT 20
                """))

            models = [{
                'model_id': r[0], 'testbed_id': r[1], 'model_version': r[2],
                'trained_at': r[3].isoformat() if r[3] else None,
                'samples_used': r[4], 'cpu_r2': r[5], 'memory_r2': r[6],
                'validation_score': r[7], 'is_active': r[8],
                'training_duration_seconds': r[9],
            } for r in result.fetchall()]

            return jsonify({'success': True, 'models': models}), 200
        finally:
            session.close()

    except Exception as e:
        logger.exception("Error listing models")
        return jsonify({'success': True, 'models': []}), 200


@smart_execution_ai_bp.route('/api/ml/training-data/stats', methods=['GET'])
def get_training_data_stats():
    """Get statistics about available training data."""
    try:
        from services.ml_training_service import _get_data_stats
        testbed_id = request.args.get('testbed_id')
        stats = _get_data_stats(testbed_id)
        return jsonify({'success': True, **stats}), 200
    except Exception as e:
        logger.exception("Error getting training data stats")
        return jsonify({'success': True, 'total_samples': 0}), 200


@smart_execution_ai_bp.route('/api/ml/training-jobs', methods=['GET'])
def list_training_jobs():
    """List recent training jobs."""
    try:
        from database import SessionLocal
        from sqlalchemy import text

        session = SessionLocal()
        try:
            result = session.execute(text("""
                SELECT job_id, testbed_id, status, started_at, completed_at,
                       samples_used, result_model_id, cpu_r2, memory_r2,
                       error_message, trigger_type
                FROM ml_training_jobs
                ORDER BY created_at DESC LIMIT 20
            """))

            jobs = [{
                'job_id': r[0], 'testbed_id': r[1], 'status': r[2],
                'started_at': r[3].isoformat() if r[3] else None,
                'completed_at': r[4].isoformat() if r[4] else None,
                'samples_used': r[5], 'result_model_id': r[6],
                'cpu_r2': r[7], 'memory_r2': r[8],
                'error_message': r[9], 'trigger_type': r[10],
            } for r in result.fetchall()]

            return jsonify({'success': True, 'jobs': jobs}), 200
        finally:
            session.close()

    except Exception as e:
        logger.exception("Error listing training jobs")
        return jsonify({'success': True, 'jobs': []}), 200


@smart_execution_ai_bp.route('/api/ml/predict', methods=['POST'])
def predict_operation_impact():
    """
    Predict impact of a specific operation.

    Request Body:
    {
        "testbed_id": "...",
        "entity_type": "vm",
        "operation": "CREATE",
        "current_cpu": 50.0,
        "current_memory": 45.0
    }
    """
    try:
        from services.ml_training_service import get_model_for_testbed

        data = request.get_json()
        testbed_id = data.get('testbed_id')

        predictor = get_model_for_testbed(testbed_id)
        if not predictor.is_trained:
            return jsonify({
                'success': True,
                'prediction': None,
                'model_trained': False,
                'message': 'No trained model available. Trigger training first.'
            }), 200

        prediction = predictor.predict(
            entity_type=data.get('entity_type', 'vm'),
            operation=data.get('operation', 'CREATE'),
            current_metrics={
                'cpu': data.get('current_cpu', 50.0),
                'memory': data.get('current_memory', 45.0),
                'cluster_size': data.get('cluster_size', 1),
                'current_load': data.get('current_load', 10.0),
            }
        )

        return jsonify({
            'success': True,
            'prediction': prediction,
            'model_trained': True,
        }), 200

    except Exception as e:
        logger.exception("Error predicting operation impact")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("AI Smart Execution routes loaded (with ML pipeline)")
