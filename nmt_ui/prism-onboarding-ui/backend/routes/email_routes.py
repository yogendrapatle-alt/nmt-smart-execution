"""
Email Schedule API Routes - PostgreSQL Implementation
RESTful endpoints for email scheduling functionality using existing PostgreSQL database
"""

from flask import Blueprint, request, jsonify, g
from services.email_schedule_service import (
    get_email_schedule,
    save_email_schedule,
    delete_email_schedule,
    get_all_active_schedules
)
from services.pdf_service import PDFService
from services.email_service import EmailService, test_smtp_connection, send_email_with_pdf
import traceback
import os
import logging

# Create blueprint
email_routes = Blueprint('email_routes', __name__)
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent logs from bubbling up to root handlers

# Import scheduler service with fallback
try:
    from services.scheduler_service import email_scheduler
    SCHEDULER_AVAILABLE = True
    logger.info("Scheduler service loaded successfully")
except ImportError as e:
    logger.warning(f"Scheduler service not available: {e}")
    SCHEDULER_AVAILABLE = False
    email_scheduler = None

# Initialize services
pdf_service = PDFService()
email_service = EmailService()


@email_routes.route('/api/schedule-email', methods=['GET'])
def get_schedule():
    """Get current email schedule configuration"""
    try:
        # Support both user-specific and general queries
        user_email = request.args.get('userEmail')
        schedule_id = request.args.get('scheduleId')
        
        if schedule_id:
            schedule_id = int(schedule_id)
        
        result = get_email_schedule(g.db, user_email=user_email, schedule_id=schedule_id)
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to get schedule: {str(e)}'
        }), 500


@email_routes.route('/api/user-schedules', methods=['GET'])
def get_user_schedules_endpoint():
    """Get all schedules for a specific user"""
    try:
        user_email = request.args.get('userEmail')
        if not user_email:
            return jsonify({
                'success': False,
                'error': 'userEmail parameter is required'
            }), 400
        
        from services.email_schedule_service import get_user_schedules
        result = get_user_schedules(g.db, user_email)
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to get user schedules: {str(e)}'
        }), 500


# POST handler moved below with scheduler integration

@email_routes.route('/api/schedule-email', methods=['DELETE'])
def delete_schedule():
    """Delete email schedule configuration"""
    try:
        user_email = request.args.get('userEmail')
        schedule_id = request.args.get('scheduleId')
        
        if schedule_id:
            schedule_id = int(schedule_id)
        
        from services.email_schedule_service import delete_email_schedule
        result = delete_email_schedule(g.db, user_email=user_email, schedule_id=schedule_id)
        
        # Update scheduler after deletion
        if result['success'] and SCHEDULER_AVAILABLE:
            if user_email:
                email_scheduler.update_user_schedules(user_email)
            else:
                email_scheduler.update_all_schedules()
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to delete schedule: {str(e)}'
        }), 500


@email_routes.route('/api/test-email', methods=['POST'])
def test_email():
    """Test email configuration by sending a test email"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        email_addresses = data.get('emailAddresses', [])
        if not email_addresses or not any(email.strip() for email in email_addresses):
            return jsonify({
                'success': False,
                'error': 'At least one email address is required'
            }), 400
        
        # Filter out empty emails
        valid_emails = [email.strip() for email in email_addresses if email.strip()]
        
        # Test email configuration first
        config_test = email_service.test_email_config()
        if not config_test['success']:
            return jsonify(config_test), 500
        
        # Create a simple test PDF
        test_alerts = [{
            'timestamp': '2025-08-13T10:00:00Z',
            'severity': 'Low',
            'status': 'Active',
            'ruleName': 'Test Alert',
            'summary': 'This is a test alert for email configuration',
            'description': 'Email configuration test - if you receive this, your email setup is working correctly'
        }]
        
        test_filters = {
            'selectedDate': '2025-08-13',
            'selectedTestbed': 'test',
            'selectedSeverity': 'All',
            'selectedStatus': 'All'
        }
        
        test_metadata = {'generated_at': '2025-08-13T10:00:00Z'}
        
        # Generate test PDF
        pdf_data = pdf_service.generate_alert_pdf(test_alerts, test_filters, test_metadata)
        
        # Prepare summary
        test_summary = {
            'total_alerts': 1,
            'critical_alerts': 0,
            'moderate_alerts': 0,
            'low_alerts': 1,
            'active_alerts': 1,
            'resolved_alerts': 0
        }
        
        # Send test email
        result = email_service.send_alert_report(valid_emails, pdf_data, test_summary, test_filters)
        
        if result['success']:
            result['message'] = f"Test email sent successfully to {', '.join(valid_emails)}"
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error sending test email: {e}")
        print(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to send test email: {str(e)}'
        }), 500


# ============================================================================
# SCHEDULER ENDPOINTS
# ============================================================================

@email_routes.route('/api/scheduler/update', methods=['POST'])
def update_scheduler():
    """Update the email scheduler based on current configuration"""
    try:
        if not SCHEDULER_AVAILABLE:
            return jsonify({
                'success': False,
                'error': 'Scheduler service not available. Please install APScheduler: pip install apscheduler'
            }), 503
        
        # Update the scheduler
        success = email_scheduler.update_schedule()
        
        if success:
            # Get current status
            status = email_scheduler.get_schedule_status()
            return jsonify({
                'success': True,
                'message': 'Scheduler updated successfully',
                'status': status
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to update scheduler'
            }), 500
    
    except Exception as e:
        logger.error(f"Error updating scheduler: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to update scheduler: {str(e)}'
        }), 500


@email_routes.route('/api/scheduler/status', methods=['GET'])
def get_scheduler_status():
    """Get current scheduler status"""
    try:
        if not SCHEDULER_AVAILABLE:
            return jsonify({
                'success': False,
                'scheduled': False,
                'status': 'Scheduler service not available',
                'error': 'APScheduler not installed'
            })
        
        status = email_scheduler.get_schedule_status()
        return jsonify({
            'success': True,
            **status
        })
    
    except Exception as e:
        logger.error(f"Error getting scheduler status: {e}")
        return jsonify({
            'success': False,
            'scheduled': False,
            'status': f'Error: {str(e)}'
        })


@email_routes.route('/api/scheduler/test-email', methods=['POST'])
def send_test_scheduled_email():
    """Send a test email using scheduler service"""
    try:
        if not SCHEDULER_AVAILABLE:
            return jsonify({
                'success': False,
                'error': 'Scheduler service not available'
            }), 503
        
        data = request.get_json()
        email_address = data.get('email')
        
        if not email_address:
            return jsonify({
                'success': False,
                'error': 'Email address is required'
            }), 400
        
        # Send test email
        success = email_scheduler.send_test_email(email_address)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'Test email sent successfully to {email_address}'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to send test email'
            }), 500
    
    except Exception as e:
        logger.error(f"Error sending test email: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to send test email: {str(e)}'
        }), 500


@email_routes.route('/api/smtp/test', methods=['GET'])
def test_smtp():
    """Test SMTP connection"""
    try:
        result = test_smtp_connection()
        status_code = 200 if result.get('success') else 500
        return jsonify(result), status_code
    
    except Exception as e:
        logger.error(f"Error testing SMTP: {e}")
        return jsonify({
            'success': False,
            'message': f'SMTP test failed: {str(e)}'
        }), 500


# ============================================================================
# SCHEDULER INTEGRATION WITH EXISTING ENDPOINTS
# ============================================================================

# Update the POST endpoint to also update the scheduler
@email_routes.route('/api/schedule-email', methods=['POST'])
def save_schedule_with_scheduler():
    """Save email schedule and update scheduler"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        # Validate required fields for multi-user support
        required_fields = ['emailAddresses', 'enabled', 'scheduleTime', 'timezone', 'userEmail']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Validate user email
        user_email = data.get('userEmail', '').strip()
        if not user_email or '@' not in user_email:
            return jsonify({
                'success': False,
                'error': 'Valid userEmail is required'
            }), 400
        
        # Validate email addresses
        email_addresses = data.get('emailAddresses', [])
        if not isinstance(email_addresses, list) or len(email_addresses) == 0:
            return jsonify({
                'success': False,
                'error': 'At least one email address is required'
            }), 400
        
        # Filter out empty email addresses
        email_addresses = [email.strip() for email in email_addresses if email.strip()]
        if len(email_addresses) == 0:
            return jsonify({
                'success': False,
                'error': 'At least one valid email address is required'
            }), 400
        
        data['emailAddresses'] = email_addresses
        
        # Validate schedule time format (HH:MM)
        schedule_time = data.get('scheduleTime', '09:00')
        if not schedule_time or len(schedule_time) != 5 or schedule_time[2] != ':':
            return jsonify({
                'success': False,
                'error': 'Invalid schedule time format. Use HH:MM format'
            }), 400
        
        # Save to database
        result = save_email_schedule(g.db, data)
        
        if result['success']:
            # Update the scheduler if available - always use update_all_schedules for reliability
            if SCHEDULER_AVAILABLE:
                scheduler_success = email_scheduler.update_all_schedules()
                    
                if not scheduler_success:
                    logger.warning("Schedule saved but scheduler update failed")
                    
            return jsonify({
                'success': True,
                'message': 'Schedule saved and scheduler updated successfully',
                'scheduler_updated': SCHEDULER_AVAILABLE,
                'schedule': result.get('schedule', {})
            })
        else:
            return jsonify(result), 500
    
    except Exception as e:
        logger.error(f"Error saving schedule: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to save schedule: {str(e)}'
        }), 500


@email_routes.route('/api/email-config-status', methods=['GET'])
def get_email_config_status():
    """Check if email configuration is properly set up"""
    try:
        result = email_service.test_email_config()
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to check email configuration: {str(e)}'
        }), 500


# SMTP Configuration Management Routes
@email_routes.route('/api/email-config', methods=['GET'])
def get_email_config():
    """Get current email configuration (without passwords)"""
    import os
    config = {
        'smtp_server': os.getenv('SMTP_SERVER', 'Not set'),
        'smtp_port': os.getenv('SMTP_PORT', 'Not set'),
        'smtp_username': os.getenv('SMTP_USERNAME', 'Not set'),
        'smtp_password_set': bool(os.getenv('SMTP_PASSWORD')),
        'sender_email': os.getenv('SENDER_EMAIL', 'Not set'),
        'sender_name': os.getenv('SENDER_NAME', 'Not set'),
        'test_mode': os.getenv('EMAIL_TEST_MODE', 'false').lower() == 'true'
    }
    
    return jsonify({
        'success': True,
        'config': config
    })


@email_routes.route('/api/email-config', methods=['POST'])
def set_email_config():
    """Set email configuration"""
    import os
    
    data = request.get_json()
    if not data:
        return jsonify({
            'success': False,
            'error': 'JSON data required'
        }), 400
    
    # Update environment variables
    config_map = {
        'smtp_server': 'SMTP_SERVER',
        'smtp_port': 'SMTP_PORT',
        'smtp_username': 'SMTP_USERNAME',
        'smtp_password': 'SMTP_PASSWORD',
        'sender_email': 'SENDER_EMAIL',
        'sender_name': 'SENDER_NAME',
        'test_mode': 'EMAIL_TEST_MODE'
    }
    
    updated = []
    for key, env_var in config_map.items():
        if key in data:
            value = str(data[key])
            if key == 'test_mode':
                value = 'true' if value.lower() in ['true', '1', 'yes'] else 'false'
            os.environ[env_var] = value
            updated.append(key)
    
    return jsonify({
        'success': True,
        'message': f'Updated configuration: {", ".join(updated)}'
    })


@email_routes.route('/api/email-config/test-mode', methods=['POST'])
def enable_test_mode():
    """Enable test mode for email service"""
    import os
    
    data = request.get_json() or {}
    enabled = data.get('enabled', True)
    
    os.environ['EMAIL_TEST_MODE'] = 'true' if enabled else 'false'
    os.environ['SMTP_USERNAME'] = 'test@localhost'
    os.environ['SMTP_PASSWORD'] = 'test'
    
    return jsonify({
        'success': True,
        'message': f'Test mode {"enabled" if enabled else "disabled"}',
        'test_mode': enabled
    })


@email_routes.route('/api/scheduler/execute-now', methods=['POST'])
def execute_schedule_now():
    """Manually execute a schedule for testing"""
    try:
        data = request.get_json()
        
        if not data or 'scheduleId' not in data:
            return jsonify({
                'success': False,
                'error': 'scheduleId is required'
            }), 400
        
        schedule_id = int(data['scheduleId'])
        
        if SCHEDULER_AVAILABLE:
            # Import the execution method
            from services.scheduler_service import email_scheduler
            
            # Call the execution method directly
            email_scheduler._execute_schedule(schedule_id)
            
            return jsonify({
                'success': True,
                'message': f'Schedule {schedule_id} executed successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Scheduler service not available'
            }), 500
            
    except Exception as e:
        logger.error(f"Error executing schedule manually: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to execute schedule: {str(e)}'
        }), 500


@email_routes.route('/api/scheduler/debug-jobs', methods=['GET'])
def debug_scheduler_jobs():
    """Debug endpoint to see what jobs are registered in APScheduler"""
    try:
        if SCHEDULER_AVAILABLE:
            from services.scheduler_service import email_scheduler
            
            jobs = email_scheduler.scheduler.get_jobs()
            job_info = []
            
            for job in jobs:
                job_info.append({
                    'id': job.id,
                    'name': job.name,
                    'func': str(job.func),
                    'trigger': str(job.trigger),
                    'next_run_time': str(job.next_run_time) if job.next_run_time else None,
                    'args': job.args,
                    'kwargs': job.kwargs
                })
            
            return jsonify({
                'success': True,
                'scheduler_running': email_scheduler.scheduler.running,
                'total_jobs': len(jobs),
                'jobs': job_info
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Scheduler service not available'
            }), 500
            
    except Exception as e:
        logger.error(f"Error getting scheduler jobs: {e}")
        return jsonify({
            'success': False,
            'error': f'Failed to get scheduler jobs: {str(e)}'
        }), 500


@email_routes.route('/api/scheduled-jobs/execute-due', methods=['GET'])
def execute_due_schedules():
    """Check for schedules due now and execute them (called by cron job)"""
    try:
        from datetime import datetime
        import traceback
        
        # Get current time in HH:MM format
        current_time = datetime.now().strftime("%H:%M")
        
        # Get all active schedules
        try:
            from services.email_schedule_service import get_all_active_schedules
            from database import SessionLocal
            session = SessionLocal()
            all_schedules = get_all_active_schedules(session)
            
            # Filter schedules that are due now (matching current time)
            due_schedules = [s for s in all_schedules if s.schedule_time == current_time and s.enabled]
            
            executed_count = 0
            failed_count = 0
            execution_results = []
            
            # Execute each due schedule
            for schedule in due_schedules:
                try:
                    logger.info(f"Executing due schedule {schedule.id} for user {schedule.user_email}")
                    
                    if SCHEDULER_AVAILABLE:
                        from services.scheduler_service import email_scheduler
                        email_scheduler._execute_schedule(schedule.id)
                        executed_count += 1
                        execution_results.append({
                            'schedule_id': schedule.id,
                            'user_email': schedule.user_email,
                            'schedule_name': schedule.schedule_name,
                            'status': 'success'
                        })
                        logger.info(f"Successfully executed schedule {schedule.id}")
                    else:
                        logger.error("Scheduler service not available")
                        failed_count += 1
                        execution_results.append({
                            'schedule_id': schedule.id,
                            'user_email': schedule.user_email,
                            'schedule_name': schedule.schedule_name,
                            'status': 'failed',
                            'error': 'Scheduler service not available'
                        })
                        
                except Exception as e:
                    failed_count += 1
                    error_msg = str(e)
                    logger.error(f"Failed to execute schedule {schedule.id}: {error_msg}")
                    logger.error(traceback.format_exc())
                    execution_results.append({
                        'schedule_id': schedule.id,
                        'user_email': schedule.user_email,
                        'schedule_name': schedule.schedule_name,
                        'status': 'failed',
                        'error': error_msg
                    })
            
            return jsonify({
                'success': True,
                'current_time': current_time,
                'total_active_schedules': len(all_schedules),
                'due_schedules': len(due_schedules),
                'executed_count': executed_count,
                'failed_count': failed_count,
                'execution_results': execution_results
            })
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Error in execute_due_schedules: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to execute due schedules: {str(e)}',
            'current_time': datetime.now().strftime("%H:%M") if 'datetime' in locals() else 'unknown'
        }), 500
