"""
Scheduled Execution Routes

API endpoints for managing scheduled AI executions.

Endpoints:
- GET    /api/scheduled-executions - List all schedules
- POST   /api/scheduled-executions - Create new schedule
- GET    /api/scheduled-executions/:id - Get schedule details
- PUT    /api/scheduled-executions/:id - Update schedule
- DELETE /api/scheduled-executions/:id - Delete schedule
- POST   /api/scheduled-executions/:id/pause - Pause schedule
- POST   /api/scheduled-executions/:id/resume - Resume schedule
- POST   /api/scheduled-executions/:id/trigger - Manually trigger execution
- GET    /api/scheduled-executions/:id/history - Get execution history
"""

import logging
import json
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

# Create blueprint
scheduled_execution_bp = Blueprint('scheduled_execution', __name__)


@scheduled_execution_bp.route('/api/scheduled-executions', methods=['GET'])
def list_scheduled_executions():
    """
    List all scheduled executions
    
    Query params:
    - active: Filter by active status (true/false)
    - testbed_id: Filter by testbed
    - limit: Max results (default: 50)
    - offset: Pagination offset
    
    Returns:
    {
        "success": true,
        "schedules": [...],
        "total": 42
    }
    """
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        
        # Get query params
        active_only = request.args.get('active', 'true').lower() == 'true'
        testbed_id = request.args.get('testbed_id')
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        session = SessionLocal()
        try:
            # Build query
            query = session.query(ScheduledExecution)
            
            if active_only:
                query = query.filter_by(is_active=True)
            
            if testbed_id:
                query = query.filter_by(testbed_id=testbed_id)
            
            # Get total count
            total = query.count()
            
            # Apply pagination
            schedules = query.order_by(
                ScheduledExecution.created_at.desc()
            ).limit(limit).offset(offset).all()
            
            return jsonify({
                'success': True,
                'schedules': [s.to_dict() for s in schedules],
                'total': total,
                'limit': limit,
                'offset': offset
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error listing scheduled executions")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions', methods=['POST'])
def create_scheduled_execution():
    """
    Create new scheduled execution
    
    Request Body:
    {
        "name": "Nightly Load Test",
        "description": "Run load test every night at 2 AM",
        "schedule_type": "cron",
        "schedule_config": {
            "hour": 2,
            "minute": 0
        },
        "testbed_id": "test-123",
        "target_config": {...},
        "entities_config": {...},
        "ai_settings": {...},
        "notify_on_completion": true
    }
    
    Returns:
    {
        "success": true,
        "schedule_id": "SCHED-...",
        "message": "Schedule created successfully"
    }
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['name', 'schedule_type', 'schedule_config', 
                          'testbed_id', 'target_config', 'entities_config']
        
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        from services.scheduler_service import get_scheduler
        
        # Generate schedule ID
        schedule_id = f"SCHED-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        
        # Calculate next run time
        next_run_time = _calculate_next_run_time(
            data['schedule_type'],
            data['schedule_config']
        )
        
        session = SessionLocal()
        try:
            # Create schedule record
            schedule = ScheduledExecution(
                schedule_id=schedule_id,
                name=data['name'],
                description=data.get('description'),
                created_by=data.get('created_by', 'system'),
                schedule_type=data['schedule_type'],
                schedule_config=data['schedule_config'],
                next_run_time=next_run_time,
                testbed_id=data['testbed_id'],
                target_config=data['target_config'],
                entities_config=data['entities_config'],
                rule_config=data.get('rule_config'),
                ai_settings=data.get('ai_settings'),
                is_active=data.get('is_active', True),
                execution_window_start=data.get('execution_window_start'),
                execution_window_end=data.get('execution_window_end'),
                max_executions=data.get('max_executions'),
                max_concurrent=data.get('max_concurrent', 1),
                notify_on_completion=data.get('notify_on_completion', False),
                notify_on_failure=data.get('notify_on_failure', True),
                notification_channels=data.get('notification_channels'),
                tags=data.get('tags'),
                priority=data.get('priority', 5)
            )
            
            session.add(schedule)
            session.commit()
            
            # Register with scheduler
            scheduler = get_scheduler()
            if scheduler:
                scheduler.add_schedule({
                    'schedule_id': schedule_id,
                    'name': data['name'],
                    'schedule_type': data['schedule_type'],
                    'schedule_config': data['schedule_config'],
                    'args': [schedule_id]
                })
                logger.info(f"✅ Registered schedule with scheduler: {schedule_id}")
            
            return jsonify({
                'success': True,
                'schedule_id': schedule_id,
                'next_run_time': next_run_time.isoformat() if next_run_time else None,
                'message': 'Schedule created successfully'
            }), 201
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error creating scheduled execution")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>', methods=['GET'])
def get_scheduled_execution(schedule_id):
    """Get schedule details"""
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        
        session = SessionLocal()
        try:
            schedule = session.query(ScheduledExecution).filter_by(
                schedule_id=schedule_id
            ).first()
            
            if not schedule:
                return jsonify({'success': False, 'error': 'Schedule not found'}), 404
            
            return jsonify({
                'success': True,
                'schedule': schedule.to_dict()
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>', methods=['PUT'])
def update_scheduled_execution(schedule_id):
    """Update schedule"""
    try:
        data = request.get_json()
        
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        from services.scheduler_service import get_scheduler
        
        session = SessionLocal()
        try:
            schedule = session.query(ScheduledExecution).filter_by(
                schedule_id=schedule_id
            ).first()
            
            if not schedule:
                return jsonify({'success': False, 'error': 'Schedule not found'}), 404
            
            # Update fields
            if 'name' in data:
                schedule.name = data['name']
            if 'description' in data:
                schedule.description = data['description']
            if 'schedule_config' in data:
                schedule.schedule_config = data['schedule_config']
                schedule.next_run_time = _calculate_next_run_time(
                    schedule.schedule_type,
                    data['schedule_config']
                )
            if 'target_config' in data:
                schedule.target_config = data['target_config']
            if 'entities_config' in data:
                schedule.entities_config = data['entities_config']
            if 'ai_settings' in data:
                schedule.ai_settings = data['ai_settings']
            if 'notify_on_completion' in data:
                schedule.notify_on_completion = data['notify_on_completion']
            if 'notify_on_failure' in data:
                schedule.notify_on_failure = data['notify_on_failure']
            
            schedule.updated_at = datetime.utcnow()
            schedule.last_modified_by = data.get('modified_by', 'system')
            
            session.commit()
            
            # Update scheduler
            scheduler = get_scheduler()
            if scheduler and schedule.is_active and not schedule.is_paused:
                scheduler.remove_schedule(schedule_id)
                scheduler.add_schedule({
                    'schedule_id': schedule_id,
                    'name': schedule.name,
                    'schedule_type': schedule.schedule_type,
                    'schedule_config': schedule.schedule_config,
                    'args': [schedule_id]
                })
            
            return jsonify({
                'success': True,
                'message': 'Schedule updated successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error updating schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>', methods=['DELETE'])
def delete_scheduled_execution(schedule_id):
    """Delete schedule"""
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        from services.scheduler_service import get_scheduler
        
        session = SessionLocal()
        try:
            schedule = session.query(ScheduledExecution).filter_by(
                schedule_id=schedule_id
            ).first()
            
            if not schedule:
                return jsonify({'success': False, 'error': 'Schedule not found'}), 404
            
            # Remove from scheduler
            scheduler = get_scheduler()
            if scheduler:
                scheduler.remove_schedule(schedule_id)
            
            # Delete from database
            session.delete(schedule)
            session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Schedule deleted successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error deleting schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>/pause', methods=['POST'])
def pause_scheduled_execution(schedule_id):
    """Pause schedule"""
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        from services.scheduler_service import get_scheduler
        
        session = SessionLocal()
        try:
            schedule = session.query(ScheduledExecution).filter_by(
                schedule_id=schedule_id
            ).first()
            
            if not schedule:
                return jsonify({'success': False, 'error': 'Schedule not found'}), 404
            
            schedule.is_paused = True
            session.commit()
            
            # Pause in scheduler
            scheduler = get_scheduler()
            if scheduler:
                scheduler.pause_schedule(schedule_id)
            
            return jsonify({
                'success': True,
                'message': 'Schedule paused successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error pausing schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>/resume', methods=['POST'])
def resume_scheduled_execution(schedule_id):
    """Resume paused schedule"""
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        from services.scheduler_service import get_scheduler
        
        session = SessionLocal()
        try:
            schedule = session.query(ScheduledExecution).filter_by(
                schedule_id=schedule_id
            ).first()
            
            if not schedule:
                return jsonify({'success': False, 'error': 'Schedule not found'}), 404
            
            schedule.is_paused = False
            session.commit()
            
            # Resume in scheduler
            scheduler = get_scheduler()
            if scheduler:
                scheduler.resume_schedule(schedule_id)
            
            return jsonify({
                'success': True,
                'message': 'Schedule resumed successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error resuming schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@scheduled_execution_bp.route('/api/scheduled-executions/<schedule_id>/history', methods=['GET'])
def get_schedule_history(schedule_id):
    """Get execution history for schedule"""
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduleExecutionHistory
        
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        session = SessionLocal()
        try:
            # Get history
            history_items = session.query(ScheduleExecutionHistory).filter_by(
                schedule_id=schedule_id
            ).order_by(
                ScheduleExecutionHistory.scheduled_time.desc()
            ).limit(limit).offset(offset).all()
            
            # Get total count
            total = session.query(ScheduleExecutionHistory).filter_by(
                schedule_id=schedule_id
            ).count()
            
            return jsonify({
                'success': True,
                'history': [h.to_dict() for h in history_items],
                'total': total,
                'limit': limit,
                'offset': offset
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting history for schedule {schedule_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _calculate_next_run_time(schedule_type: str, config: dict):
    """Calculate next run time based on schedule configuration"""
    try:
        if schedule_type == 'once':
            return datetime.fromisoformat(config['run_date'])
        
        elif schedule_type == 'interval':
            interval_type = config.get('interval_type', 'minutes')
            interval_value = config.get('interval_value', 60)
            
            if interval_type == 'minutes':
                return datetime.utcnow() + timedelta(minutes=interval_value)
            elif interval_type == 'hours':
                return datetime.utcnow() + timedelta(hours=interval_value)
            elif interval_type == 'days':
                return datetime.utcnow() + timedelta(days=interval_value)
        
        elif schedule_type == 'cron':
            # For cron, let APScheduler calculate it
            # Return a placeholder for now
            return datetime.utcnow() + timedelta(minutes=1)
        
        return None
        
    except Exception as e:
        logger.error(f"Error calculating next run time: {e}")
        return None


logger.info("✅ Scheduled execution routes loaded")
