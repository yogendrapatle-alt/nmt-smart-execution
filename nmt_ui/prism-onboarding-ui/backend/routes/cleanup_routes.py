"""
Cleanup Routes - API endpoints for removing fake/demo data and running migrations
"""

from flask import Blueprint, jsonify
from sqlalchemy import text
from database import SessionLocal, engine
import logging

logger = logging.getLogger(__name__)

cleanup_bp = Blueprint('cleanup', __name__)


@cleanup_bp.route('/api/cleanup/fake-data', methods=['POST'])
def cleanup_fake_data():
    """Remove all fake/demo data from database"""
    try:
        session = SessionLocal()
        results = {}
        
        # 1. Clean Smart Executions
        fake_exec_ids = [
            'SE-20260127-093901%',
            'SE-20260127-215201%',
            'SMART-20260203%'
        ]
        
        deleted_execs = 0
        for pattern in fake_exec_ids:
            result = session.execute(text("""
                DELETE FROM smart_executions 
                WHERE execution_id LIKE :pattern
            """), {'pattern': pattern})
            deleted_execs += result.rowcount
        
        results['smart_executions_deleted'] = deleted_execs
        
        # 2. Clean fake testbeds
        result = session.execute(text("""
            DELETE FROM testbeds 
            WHERE testbed_label LIKE '%fake%' 
            OR testbed_label LIKE '%demo%'
            OR testbed_label LIKE '%test%'
        """))
        results['testbeds_deleted'] = result.rowcount
        
        # 3. Clean cost data
        result = session.execute(text("""
            DELETE FROM cost_tracker 
            WHERE cost_id LIKE '%fake%' 
            OR cost_id LIKE '%demo%'
        """))
        results['costs_deleted'] = result.rowcount
        
        # 4. Clean scheduled executions
        result = session.execute(text("""
            DELETE FROM scheduled_executions 
            WHERE name LIKE '%fake%' 
            OR name LIKE '%demo%'
            OR name LIKE '%test%'
        """))
        results['schedules_deleted'] = result.rowcount
        
        # 5. Clean multi-testbed executions
        result = session.execute(text("""
            DELETE FROM multi_testbed_executions 
            WHERE execution_name LIKE '%fake%' 
            OR execution_name LIKE '%demo%'
        """))
        results['multi_testbed_deleted'] = result.rowcount
        
        # Get remaining counts
        results['remaining'] = {
            'smart_executions': session.execute(text("SELECT COUNT(*) FROM smart_executions")).scalar(),
            'testbeds': session.execute(text("SELECT COUNT(*) FROM testbeds")).scalar(),
            'templates': session.execute(text("SELECT COUNT(*) FROM execution_templates")).scalar(),
            'costs': session.execute(text("SELECT COUNT(*) FROM cost_tracker")).scalar(),
            'schedules': session.execute(text("SELECT COUNT(*) FROM scheduled_executions")).scalar()
        }
        
        session.commit()
        session.close()
        
        logger.info(f"✅ Fake data cleanup complete: {results}")
        
        return jsonify({
            'success': True,
            'message': 'Fake data cleanup complete',
            'deleted': {
                'smart_executions': results['smart_executions_deleted'],
                'testbeds': results['testbeds_deleted'],
                'costs': results['costs_deleted'],
                'schedules': results['schedules_deleted'],
                'multi_testbed': results['multi_testbed_deleted']
            },
            'remaining': results['remaining']
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Cleanup failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@cleanup_bp.route('/api/cleanup/status', methods=['GET'])
def get_cleanup_status():
    """Get current data counts"""
    try:
        session = SessionLocal()
        
        status = {
            'smart_executions': session.execute(text("SELECT COUNT(*) FROM smart_executions")).scalar(),
            'testbeds': session.execute(text("SELECT COUNT(*) FROM testbeds")).scalar(),
            'templates': session.execute(text("SELECT COUNT(*) FROM execution_templates")).scalar(),
            'costs': session.execute(text("SELECT COUNT(*) FROM cost_tracker")).scalar(),
            'schedules': session.execute(text("SELECT COUNT(*) FROM scheduled_executions")).scalar(),
            'multi_testbed': session.execute(text("SELECT COUNT(*) FROM multi_testbed_executions")).scalar()
        }
        
        session.close()
        
        return jsonify({
            'success': True,
            'counts': status
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Failed to get status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
