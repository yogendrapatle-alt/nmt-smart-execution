"""
Multi-Testbed Orchestration Routes

API endpoints for managing multi-testbed executions and testbed groups.

Endpoints:
- POST   /api/multi-testbed/execute - Start multi-testbed execution
- GET    /api/multi-testbed/status/:id - Get execution status
- GET    /api/multi-testbed/history - Get execution history
- GET    /api/multi-testbed/report/:id - Get aggregate report

- GET    /api/testbed-groups - List testbed groups
- POST   /api/testbed-groups - Create testbed group
- GET    /api/testbed-groups/:id - Get specific group
- DELETE /api/testbed-groups/:id - Delete group
"""

import logging
from datetime import datetime
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

# Create blueprint
multi_testbed_bp = Blueprint('multi_testbed', __name__)


@multi_testbed_bp.route('/api/multi-testbed/execute', methods=['POST'])
def start_multi_testbed_execution():
    """
    Start execution on multiple testbeds in parallel
    
    Request Body:
    {
        "execution_name": "Test Cluster Load",
        "testbed_ids": ["testbed-1", "testbed-2", "testbed-3"],
        "target_config": {
            "cpu_threshold": 75,
            "memory_threshold": 70
        },
        "entities_config": {
            "vm": ["CREATE", "DELETE"]
        },
        "ai_settings": {
            "ai_enabled": true
        }
    }
    
    Returns:
    {
        "success": true,
        "multi_execution_id": "MTE-20260203-120000",
        "total_testbeds": 3,
        "message": "Started execution on 3 testbeds"
    }
    """
    try:
        data = request.get_json()
        
        execution_name = data.get('execution_name', 'Multi-Testbed Execution')
        testbed_ids = data.get('testbed_ids', [])
        target_config = data.get('target_config', {})
        entities_config = data.get('entities_config', {})
        ai_settings = data.get('ai_settings', {})
        
        if not testbed_ids or len(testbed_ids) < 2:
            return jsonify({
                'success': False,
                'error': 'At least 2 testbeds required for multi-testbed execution'
            }), 400
        
        # Get testbed configurations
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed_configs = []
            
            for testbed_id in testbed_ids:
                testbed = session.query(Testbed).filter_by(
                    unique_testbed_id=testbed_id
                ).first()
                
                if not testbed:
                    return jsonify({
                        'success': False,
                        'error': f'Testbed not found: {testbed_id}'
                    }), 404
                
                testbed_configs.append(testbed.to_dict())
            
        finally:
            session.close()
        
        # Generate multi-execution ID
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        multi_execution_id = f'MTE-{timestamp}'
        
        # Start orchestrated execution
        from services.multi_testbed_orchestrator import get_orchestrator
        
        orchestrator = get_orchestrator()
        result = orchestrator.start_multi_execution(
            multi_execution_id=multi_execution_id,
            testbed_configs=testbed_configs,
            target_config=target_config,
            entities_config=entities_config,
            ai_settings=ai_settings
        )
        
        return jsonify({
            'success': True,
            'multi_execution_id': multi_execution_id,
            'total_testbeds': len(testbed_ids),
            'message': f'Started execution on {len(testbed_ids)} testbeds'
        }), 200
        
    except Exception as e:
        logger.exception("Error starting multi-testbed execution")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/multi-testbed/status/<multi_execution_id>', methods=['GET'])
def get_multi_testbed_status(multi_execution_id):
    """
    Get current status of multi-testbed execution
    
    Returns:
    {
        "success": true,
        "status": "running",
        "total_testbeds": 3,
        "completed_testbeds": 1,
        "failed_testbeds": 0,
        "progress": {
            "testbed-1": {"status": "completed", "execution_id": "..."},
            "testbed-2": {"status": "running"},
            "testbed-3": {"status": "pending"}
        }
    }
    """
    try:
        from services.multi_testbed_orchestrator import get_orchestrator
        
        orchestrator = get_orchestrator()
        status = orchestrator.get_execution_status(multi_execution_id)
        
        if not status:
            return jsonify({'success': False, 'error': 'Execution not found'}), 404
        
        return jsonify({
            'success': True,
            **status
        }), 200
        
    except Exception as e:
        logger.exception(f"Error getting status for {multi_execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/multi-testbed/history', methods=['GET'])
def get_multi_testbed_history():
    """
    Get history of all multi-testbed executions
    
    Returns:
    {
        "success": true,
        "executions": [...]
    }
    """
    try:
        from database import SessionLocal
        from models.multi_testbed_execution import MultiTestbedExecution
        
        session = SessionLocal()
        try:
            executions = session.query(MultiTestbedExecution).order_by(
                MultiTestbedExecution.created_at.desc()
            ).limit(100).all()
            
            return jsonify({
                'success': True,
                'executions': [e.to_dict() for e in executions]
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting multi-testbed history")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/multi-testbed/report/<multi_execution_id>', methods=['GET'])
def get_multi_testbed_report(multi_execution_id):
    """
    Get aggregate report for multi-testbed execution
    
    Returns:
    {
        "success": true,
        "multi_execution_id": "MTE-...",
        "aggregate_metrics": {...},
        "testbed_results": {...}
    }
    """
    try:
        from database import SessionLocal
        from models.multi_testbed_execution import MultiTestbedExecution
        
        session = SessionLocal()
        try:
            execution = session.query(MultiTestbedExecution).filter_by(
                multi_execution_id=multi_execution_id
            ).first()
            
            if not execution:
                return jsonify({'success': False, 'error': 'Execution not found'}), 404
            
            # Get individual execution reports
            testbed_results = {}
            
            if execution.child_executions:
                from models.smart_execution import SmartExecution
                
                for testbed_id, exec_id in execution.child_executions.items():
                    child_exec = session.query(SmartExecution).filter_by(
                        execution_id=exec_id
                    ).first()
                    
                    if child_exec:
                        testbed_results[testbed_id] = {
                            'execution_id': exec_id,
                            'status': child_exec.status,
                            'total_operations': child_exec.total_operations,
                            'successful_operations': child_exec.successful_operations,
                            'success_rate': child_exec.success_rate
                        }
            
            return jsonify({
                'success': True,
                'multi_execution_id': multi_execution_id,
                'status': execution.status,
                'aggregate_metrics': execution.aggregate_metrics,
                'testbed_results': testbed_results,
                'total_testbeds': execution.total_testbeds,
                'completed_testbeds': execution.completed_testbeds,
                'failed_testbeds': execution.failed_testbeds
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting report for {multi_execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ========================================================================
# TESTBED GROUPS ENDPOINTS
# ========================================================================

@multi_testbed_bp.route('/api/testbed-groups', methods=['GET'])
def get_testbed_groups():
    """
    List all testbed groups
    
    Returns:
    {
        "success": true,
        "groups": [...]
    }
    """
    try:
        from database import SessionLocal
        from models.multi_testbed_execution import TestbedGroup
        
        session = SessionLocal()
        try:
            groups = session.query(TestbedGroup).order_by(
                TestbedGroup.created_at.desc()
            ).all()
            
            return jsonify({
                'success': True,
                'groups': [g.to_dict() for g in groups]
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting testbed groups")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/testbed-groups', methods=['POST'])
def create_testbed_group():
    """
    Create a new testbed group
    
    Request Body:
    {
        "group_name": "Production Cluster",
        "description": "All production testbeds",
        "testbed_ids": ["testbed-1", "testbed-2"],
        "created_by": "username"
    }
    
    Returns:
    {
        "success": true,
        "group_id": "GRP-20260203-120000",
        "message": "Group created successfully"
    }
    """
    try:
        data = request.get_json()
        
        group_name = data.get('group_name')
        description = data.get('description', '')
        testbed_ids = data.get('testbed_ids', [])
        created_by = data.get('created_by', '')
        
        if not group_name or not testbed_ids:
            return jsonify({
                'success': False,
                'error': 'group_name and testbed_ids required'
            }), 400
        
        # Generate group ID
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        group_id = f'GRP-{timestamp}'
        
        from database import SessionLocal
        from models.multi_testbed_execution import TestbedGroup
        
        group = TestbedGroup(
            group_id=group_id,
            group_name=group_name,
            description=description,
            testbed_ids=testbed_ids,
            created_by=created_by
        )
        
        session = SessionLocal()
        try:
            session.add(group)
            session.commit()
            
            return jsonify({
                'success': True,
                'group_id': group_id,
                'message': 'Group created successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error creating testbed group")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/testbed-groups/<group_id>', methods=['GET'])
def get_testbed_group(group_id):
    """Get specific testbed group"""
    try:
        from database import SessionLocal
        from models.multi_testbed_execution import TestbedGroup
        
        session = SessionLocal()
        try:
            group = session.query(TestbedGroup).filter_by(group_id=group_id).first()
            
            if not group:
                return jsonify({'success': False, 'error': 'Group not found'}), 404
            
            return jsonify({
                'success': True,
                'group': group.to_dict()
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting group {group_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@multi_testbed_bp.route('/api/testbed-groups/<group_id>', methods=['DELETE'])
def delete_testbed_group(group_id):
    """Delete testbed group"""
    try:
        from database import SessionLocal
        from models.multi_testbed_execution import TestbedGroup
        
        session = SessionLocal()
        try:
            group = session.query(TestbedGroup).filter_by(group_id=group_id).first()
            
            if not group:
                return jsonify({'success': False, 'error': 'Group not found'}), 404
            
            session.delete(group)
            session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Group deleted successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error deleting group {group_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("✅ Multi-testbed routes loaded")
