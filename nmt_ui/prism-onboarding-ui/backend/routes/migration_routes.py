"""
Migration Routes - API endpoints for running database migrations
"""

from flask import Blueprint, jsonify
from sqlalchemy import text
from database import SessionLocal, engine
import logging

logger = logging.getLogger(__name__)

migration_bp = Blueprint('migration', __name__)


@migration_bp.route('/api/migrations/add-ai-fields', methods=['POST'])
def add_ai_fields():
    """Add AI-related fields to smart_executions table"""
    try:
        session = SessionLocal()
        results = {}
        
        # Check and add ai_enabled column
        try:
            session.execute(text("SELECT ai_enabled FROM smart_executions LIMIT 1"))
            results['ai_enabled'] = 'already exists'
        except:
            session.rollback()
            session.execute(text("ALTER TABLE smart_executions ADD COLUMN ai_enabled BOOLEAN DEFAULT FALSE"))
            results['ai_enabled'] = 'added'
        
        # Check and add ai_settings column
        try:
            session.execute(text("SELECT ai_settings FROM smart_executions LIMIT 1"))
            results['ai_settings'] = 'already exists'
        except:
            session.rollback()
            session.execute(text("ALTER TABLE smart_executions ADD COLUMN ai_settings JSONB"))
            results['ai_settings'] = 'added'
        
        # Check and add ml_stats column
        try:
            session.execute(text("SELECT ml_stats FROM smart_executions LIMIT 1"))
            results['ml_stats'] = 'already exists'
        except:
            session.rollback()
            session.execute(text("ALTER TABLE smart_executions ADD COLUMN ml_stats JSONB"))
            results['ml_stats'] = 'added'
        
        # Check and add pid_stats column
        try:
            session.execute(text("SELECT pid_stats FROM smart_executions LIMIT 1"))
            results['pid_stats'] = 'already exists'
        except:
            session.rollback()
            session.execute(text("ALTER TABLE smart_executions ADD COLUMN pid_stats JSONB"))
            results['pid_stats'] = 'added'
        
        # Check and add training_data_collected column
        try:
            session.execute(text("SELECT training_data_collected FROM smart_executions LIMIT 1"))
            results['training_data_collected'] = 'already exists'
        except:
            session.rollback()
            session.execute(text("ALTER TABLE smart_executions ADD COLUMN training_data_collected INTEGER DEFAULT 0"))
            results['training_data_collected'] = 'added'
        
        session.commit()
        session.close()
        
        logger.info(f"✅ AI fields migration complete: {results}")
        
        return jsonify({
            'success': True,
            'message': 'AI fields migration complete',
            'results': results
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@migration_bp.route('/api/migrations/status', methods=['GET'])
def get_migration_status():
    """Check which migrations have been applied"""
    try:
        session = SessionLocal()
        status = {}
        
        # Check AI fields
        ai_fields = ['ai_enabled', 'ai_settings', 'ml_stats', 'pid_stats', 'training_data_collected']
        for field in ai_fields:
            try:
                session.execute(text(f"SELECT {field} FROM smart_executions LIMIT 1"))
                status[field] = True
            except:
                session.rollback()
                status[field] = False
        
        session.close()
        
        return jsonify({
            'success': True,
            'ai_fields_present': status,
            'all_ai_fields_ready': all(status.values())
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Failed to check migration status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
