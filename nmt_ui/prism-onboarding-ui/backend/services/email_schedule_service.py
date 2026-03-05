"""
Email Schedule Service - PostgreSQL Implementation with Multi-User Support
PostgreSQL operations for email scheduling supporting multiple users and schedules
"""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from models.email_schedule import EmailSchedule
import traceback


def get_email_schedule(db_session: Session, user_email: str = None, schedule_id: int = None) -> Dict:
    """
    Get email schedule configuration for a specific user or schedule
    
    Args:
        db_session: SQLAlchemy session (e.g., g.db)
        user_email: Email of the user (optional - if provided, gets user's schedules)
        schedule_id: Specific schedule ID (optional - if provided, gets specific schedule)
    
    Returns:
        Dict with success status and config data
    """
    try:
        if schedule_id:
            # Get specific schedule by ID
            schedule = db_session.query(EmailSchedule).filter(EmailSchedule.id == schedule_id).first()
        elif user_email:
            # Get user's most recent schedule
            schedule = (
                db_session.query(EmailSchedule)
                .filter(EmailSchedule.user_email == user_email)
                .order_by(EmailSchedule.updated_at.desc())
                .first()
            )
        else:
            # Fallback: Get the most recent schedule from any user (for backward compatibility)
            schedule = (
                db_session.query(EmailSchedule)
                .order_by(EmailSchedule.updated_at.desc())
                .first()
            )
        
        if schedule:
            return {
                'success': True,
                'config': schedule.to_dict()
            }
        else:
            # Return default configuration if no schedule exists
            return {
                'success': True,
                'config': {
                    'userEmail': user_email or '',
                    'scheduleName': 'Default Schedule',
                    'emailAddresses': [''],
                    'enabled': False,
                    'scheduleTime': '09:00',
                    'timezone': 'UTC',
                    'severityFilter': 'All',
                    'statusFilter': 'All',
                    'testbedFilter': 'All'
                }
            }
            
    except Exception as e:
        return {'success': False, 'error': f'Database error: {str(e)}'}


def get_user_schedules(db_session: Session, user_email: str) -> Dict:
    """
    Get all schedules for a specific user
    
    Args:
        db_session: SQLAlchemy session (e.g., g.db)
        user_email: Email of the user
    
    Returns:
        Dict with success status and list of schedules
    """
    try:
        schedules = (
            db_session.query(EmailSchedule)
            .filter(EmailSchedule.user_email == user_email)
            .order_by(EmailSchedule.updated_at.desc())
            .all()
        )
        
        return {
            'success': True,
            'schedules': [schedule.to_dict() for schedule in schedules],
            'count': len(schedules)
        }
        
    except Exception as e:
        return {'success': False, 'error': f'Database error: {str(e)}'}


def save_email_schedule(db_session: Session, config: Dict) -> Dict:
    """
    Save or update email schedule configuration
    
    Args:
        db_session: SQLAlchemy session (e.g., g.db)
        config: Configuration dictionary from frontend
    
    Returns:
        Dict with success status and message
    """
    try:
        user_email = config.get('userEmail', '')
        schedule_name = config.get('scheduleName', 'Default Schedule')
        schedule_id = config.get('id')  # If provided, update existing schedule
        
        if schedule_id:
            # Update existing schedule by ID
            existing_schedule = db_session.query(EmailSchedule).filter(
                EmailSchedule.id == schedule_id,
                EmailSchedule.user_email == user_email  # Ensure user can only update their own schedules
            ).first()
            
            if existing_schedule:
                existing_schedule.update_from_dict(config)
                db_session.commit()
                return {
                    'success': True, 
                    'message': 'Schedule updated successfully',
                    'schedule': existing_schedule.to_dict()
                }
            else:
                return {'success': False, 'error': 'Schedule not found or access denied'}
        
        else:
            # Check if user already has a schedule with the same name
            existing_schedule = (
                db_session.query(EmailSchedule)
                .filter(
                    EmailSchedule.user_email == user_email,
                    EmailSchedule.schedule_name == schedule_name
                )
                .first()
            )
            
            if existing_schedule:
                # Update existing schedule with same name
                existing_schedule.update_from_dict(config)
                db_session.commit()
                return {
                    'success': True, 
                    'message': 'Schedule updated successfully',
                    'schedule': existing_schedule.to_dict()
                }
            else:
                # Create new schedule
                new_schedule = EmailSchedule.from_dict(config)
                db_session.add(new_schedule)
                db_session.commit()
                return {
                    'success': True, 
                    'message': 'Schedule created successfully',
                    'schedule': new_schedule.to_dict()
                }
        
    except Exception as e:
        db_session.rollback()
        return {'success': False, 'error': f'Database error: {str(e)}'}


def get_all_active_schedules(db_session: Session) -> List[EmailSchedule]:
    """
    Get all active email schedules for the scheduler (all users)
    
    Args:
        db_session: SQLAlchemy session
    
    Returns:
        List of active EmailSchedule instances
    """
    try:
        active_schedules = (
            db_session.query(EmailSchedule)
            .filter(EmailSchedule.enabled == True)
            .all()
        )
        
        return active_schedules
        
    except Exception as e:
        print(f"Error getting active schedules: {e}")
        return []


def update_schedule_execution_status(db_session: Session, schedule_id: int, 
                                   status: str, error: str = None) -> bool:
    """
    Update the execution status of a schedule
    
    Args:
        db_session: SQLAlchemy session
        schedule_id: ID of the schedule to update
        status: 'success' or 'failed'
        error: Error message if status is 'failed'
    
    Returns:
        True if successful, False otherwise
    """
    try:
        schedule = db_session.query(EmailSchedule).filter(
            EmailSchedule.id == schedule_id
        ).first()
        
        if schedule:
            schedule.update_execution_status(status, error)
            db_session.commit()
            return True
        else:
            print(f"Schedule with ID {schedule_id} not found")
            return False
            
    except Exception as e:
        print(f"Error updating schedule execution status: {e}")
        db_session.rollback()
        return False


def get_schedule_by_id(db_session: Session, schedule_id: int) -> Optional[EmailSchedule]:
    """
    Get a specific email schedule by ID
    
    Args:
        db_session: SQLAlchemy session
        schedule_id: ID of the schedule
    
    Returns:
        EmailSchedule instance or None
    """
    try:
        return db_session.query(EmailSchedule).filter(
            EmailSchedule.id == schedule_id
        ).first()
        
    except Exception as e:
        print(f"Error getting schedule by ID: {e}")
        return None


def delete_email_schedule(db_session: Session, user_email=None, schedule_id=None):
    """Delete email schedule(s) from database using SQLAlchemy."""
    try:
        if schedule_id:
            # Delete specific schedule by ID
            schedule = db_session.query(EmailSchedule).filter(
                EmailSchedule.id == schedule_id
            ).first()
            
            if not schedule:
                return {
                    'success': False,
                    'error': 'Schedule not found'
                }
            
            db_session.delete(schedule)
            db_session.commit()
            
            message = f"Schedule '{schedule.schedule_name}' (ID: {schedule_id}) deleted successfully"
            return {
                'success': True,
                'message': message,
                'deleted_count': 1
            }
            
        elif user_email:
            # Delete all schedules for user
            schedules = db_session.query(EmailSchedule).filter(
                EmailSchedule.user_email == user_email,
                EmailSchedule.enabled == True
            ).all()
            
            deleted_count = len(schedules)
            for schedule in schedules:
                db_session.delete(schedule)
            
            db_session.commit()
            message = f"Deleted {deleted_count} schedules for user {user_email}"
            
        else:
            # Delete all schedules (admin operation)
            schedules = db_session.query(EmailSchedule).filter(
                EmailSchedule.enabled == True
            ).all()
            
            deleted_count = len(schedules)
            for schedule in schedules:
                db_session.delete(schedule)
            
            db_session.commit()
            message = f"Deleted {deleted_count} schedules"
        
        return {
            'success': True,
            'message': message,
            'deleted_count': deleted_count
        }
        
    except Exception as e:
        db_session.rollback()
        return {
            'success': False,
            'error': f'Failed to delete schedule: {str(e)}'
        }


def update_execution_status(db_session: Session, schedule_id: int, status: str, error: str = None) -> Dict:
    """
    Update the execution status of a schedule after it runs
    
    Args:
        db_session: SQLAlchemy session
        schedule_id: ID of the schedule to update
        status: Execution status ('success' or 'failed')
        error: Error message if status is 'failed'
    
    Returns:
        Dict with success status and message
    """
    try:
        schedule = db_session.query(EmailSchedule).filter(EmailSchedule.id == schedule_id).first()
        
        if not schedule:
            return {
                'success': False,
                'error': f'Schedule with ID {schedule_id} not found'
            }
        
        schedule.update_execution_status(status, error)
        db_session.commit()
        
        return {
            'success': True,
            'message': f'Updated execution status for schedule {schedule_id} to {status}'
        }
        
    except Exception as e:
        db_session.rollback()
        return {
            'success': False,
            'error': f'Failed to update execution status: {str(e)}'
        }
