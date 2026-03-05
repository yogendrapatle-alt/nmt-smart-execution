"""
Alert Configuration Routes

API endpoints for managing alert configurations and testing alerts.

Endpoints:
- GET    /api/alerts/config/:testbed_id - Get alert config for testbed
- PUT    /api/alerts/config/:testbed_id - Update alert config
- POST   /api/alerts/test - Test alert configuration
- GET    /api/alerts/history - Get alert history (future)
"""

import logging
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

# Create blueprint
alert_bp = Blueprint('alerts', __name__)


@alert_bp.route('/api/alerts/config/<testbed_id>', methods=['GET'])
def get_alert_config(testbed_id):
    """
    Get alert configuration for a testbed
    
    Returns:
    {
        "success": true,
        "config": {
            "slack": {...},
            "email": {...},
            "webhook": {...}
        }
    }
    """
    try:
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            # Get alert config from testbed (stored in JSONB field)
            alert_config = testbed.alert_config if hasattr(testbed, 'alert_config') else {}
            
            # Return default config if none set
            if not alert_config:
                alert_config = {
                    'slack': {
                        'enabled': False,
                        'webhook_url': ''
                    },
                    'email': {
                        'enabled': False,
                        'smtp_host': '',
                        'smtp_port': 587,
                        'username': '',
                        'password': '',
                        'from_email': '',
                        'recipients': [],
                        'use_tls': True
                    },
                    'webhook': {
                        'enabled': False,
                        'url': '',
                        'headers': {}
                    }
                }
            
            return jsonify({
                'success': True,
                'config': alert_config
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting alert config for testbed {testbed_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@alert_bp.route('/api/alerts/config/<testbed_id>', methods=['PUT'])
def update_alert_config(testbed_id):
    """
    Update alert configuration for a testbed
    
    Request Body:
    {
        "slack": {
            "enabled": true,
            "webhook_url": "https://hooks.slack.com/..."
        },
        "email": {
            "enabled": true,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "username": "user@gmail.com",
            "password": "app-password",
            "from_email": "alerts@example.com",
            "recipients": ["recipient@example.com"],
            "use_tls": true
        },
        "webhook": {
            "enabled": true,
            "url": "https://webhook.site/...",
            "headers": {}
        }
    }
    
    Returns:
    {
        "success": true,
        "message": "Alert configuration updated"
    }
    """
    try:
        data = request.get_json()
        
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            # Update alert config
            testbed.alert_config = data
            session.commit()
            
            logger.info(f"✅ Alert config updated for testbed {testbed_id}")
            
            return jsonify({
                'success': True,
                'message': 'Alert configuration updated successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error updating alert config for testbed {testbed_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@alert_bp.route('/api/alerts/test', methods=['POST'])
def test_alerts():
    """
    Test alert configuration by sending test alerts
    
    Request Body:
    {
        "testbed_id": "test-123",
        "channels": ["slack", "email", "webhook"]  // Optional, tests all if not specified
    }
    
    Returns:
    {
        "success": true,
        "results": {
            "slack": true,
            "email": false,
            "webhook": true
        },
        "message": "2/3 channels successful"
    }
    """
    try:
        data = request.get_json()
        testbed_id = data.get('testbed_id')
        channels_to_test = data.get('channels', ['slack', 'email', 'webhook'])
        
        if not testbed_id:
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        from database import SessionLocal
        from models.testbed import Testbed
        from services.alert_service import get_alert_service
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            # Get alert config
            alert_config = testbed.alert_config if hasattr(testbed, 'alert_config') else {}
            
            if not alert_config:
                return jsonify({
                    'success': False,
                    'error': 'No alert configuration found. Please configure alerts first.'
                }), 400
            
            # Filter channels to test
            filtered_config = {}
            for channel in channels_to_test:
                if channel in alert_config:
                    filtered_config[channel] = alert_config[channel]
            
            # Send test alerts
            alert_service = get_alert_service()
            results = alert_service.send_test_alert(filtered_config)
            
            # Summary
            total = len(results)
            successful = sum(1 for v in results.values() if v)
            
            return jsonify({
                'success': True,
                'results': results,
                'message': f'{successful}/{total} channel(s) successful'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error testing alerts")
        return jsonify({'success': False, 'error': str(e)}), 500


@alert_bp.route('/api/alerts/send-execution-alert', methods=['POST'])
def send_execution_alert():
    """
    Manually trigger execution alert (for testing)
    
    Request Body:
    {
        "testbed_id": "test-123",
        "alert_type": "execution.complete" | "execution.failed",
        "execution_data": {...}
    }
    
    Returns:
    {
        "success": true,
        "results": {...}
    }
    """
    try:
        data = request.get_json()
        testbed_id = data.get('testbed_id')
        alert_type = data.get('alert_type')
        execution_data = data.get('execution_data', {})
        
        if not testbed_id or not alert_type:
            return jsonify({'success': False, 'error': 'testbed_id and alert_type required'}), 400
        
        from database import SessionLocal
        from models.testbed import Testbed
        from services.alert_service import get_alert_service
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            alert_config = testbed.alert_config if hasattr(testbed, 'alert_config') else {}
            
            if not alert_config:
                return jsonify({'success': False, 'error': 'No alert configuration'}), 400
            
            # Send alert
            alert_service = get_alert_service()
            
            if alert_type == 'execution.complete':
                results = alert_service.send_execution_complete_alert(execution_data, alert_config)
            elif alert_type == 'execution.failed':
                error_msg = execution_data.get('error_message', 'Test error')
                results = alert_service.send_execution_failed_alert(
                    execution_data, error_msg, alert_config
                )
            else:
                return jsonify({'success': False, 'error': 'Invalid alert_type'}), 400
            
            return jsonify({
                'success': True,
                'results': results
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error sending execution alert")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("✅ Alert routes loaded")
