"""
Scheduler Service

Manages scheduled AI executions using APScheduler.
Supports cron-like scheduling, one-time executions, and recurring patterns.
"""

import logging
import sys
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# APScheduler imports
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.date import DateTrigger
    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
    from apscheduler.executors.pool import ThreadPoolExecutor
    APSCHEDULER_AVAILABLE = True
except ImportError:
    APSCHEDULER_AVAILABLE = False
    logging.warning("APScheduler not installed. Scheduled executions will not work.")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SchedulerService:
    """
    Service for managing scheduled AI executions
    
    Features:
    - Cron-like scheduling
    - One-time executions
    - Recurring intervals
    - Execution window enforcement
    - Concurrent execution limits
    - Automatic retry on failure
    """
    
    def __init__(self, database_url: str = None):
        """Initialize scheduler service"""
        
        if not APSCHEDULER_AVAILABLE:
            logger.error("❌ APScheduler not available. Install with: pip install APScheduler")
            self.scheduler = None
            return
        
        # Configure job stores
        jobstores = {}
        if database_url:
            jobstores['default'] = SQLAlchemyJobStore(url=database_url)
        
        # Configure executors
        executors = {
            'default': ThreadPoolExecutor(max_workers=10)
        }
        
        # Job defaults
        job_defaults = {
            'coalesce': True,  # Combine missed runs
            'max_instances': 3,  # Max concurrent instances of same job
            'misfire_grace_time': 300  # 5 minutes grace period
        }
        
        # Create scheduler
        self.scheduler = BackgroundScheduler(
            jobstores=jobstores,
            executors=executors,
            job_defaults=job_defaults,
            timezone='UTC'
        )
        
        logger.info("✅ Scheduler service initialized")
    
    def start(self):
        """Start the scheduler"""
        if not self.scheduler:
            logger.error("❌ Cannot start scheduler - not initialized")
            return False
        
        try:
            self.scheduler.start()
            logger.info("✅ Scheduler started")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to start scheduler: {e}")
            return False
    
    def shutdown(self):
        """Shutdown the scheduler"""
        if self.scheduler and self.scheduler.running:
            self.scheduler.shutdown(wait=True)
            logger.info("✅ Scheduler shutdown complete")
    
    def add_schedule(self, schedule: Dict) -> bool:
        """
        Add a new scheduled execution
        
        Args:
            schedule: Dictionary with schedule configuration
                - schedule_id: Unique ID
                - schedule_type: 'once', 'interval', 'cron'
                - schedule_config: Schedule details
                - execution_func: Function to call
                - args: Function arguments
        
        Returns:
            bool: Success status
        """
        if not self.scheduler:
            logger.error("❌ Scheduler not available")
            return False
        
        try:
            schedule_id = schedule['schedule_id']
            schedule_type = schedule['schedule_type']
            schedule_config = schedule['schedule_config']
            
            # Determine trigger based on schedule type
            trigger = self._create_trigger(schedule_type, schedule_config)
            
            if not trigger:
                logger.error(f"❌ Failed to create trigger for {schedule_id}")
                return False
            
            # Add job
            self.scheduler.add_job(
                func=schedule.get('execution_func', self._execute_scheduled_job),
                trigger=trigger,
                id=schedule_id,
                name=schedule.get('name', schedule_id),
                args=schedule.get('args', []),
                kwargs=schedule.get('kwargs', {}),
                replace_existing=True
            )
            
            logger.info(f"✅ Added schedule: {schedule_id} ({schedule_type})")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to add schedule: {e}")
            logger.exception(e)
            return False
    
    def remove_schedule(self, schedule_id: str) -> bool:
        """Remove a scheduled execution"""
        if not self.scheduler:
            return False
        
        try:
            self.scheduler.remove_job(schedule_id)
            logger.info(f"✅ Removed schedule: {schedule_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to remove schedule {schedule_id}: {e}")
            return False
    
    def pause_schedule(self, schedule_id: str) -> bool:
        """Pause a scheduled execution"""
        if not self.scheduler:
            return False
        
        try:
            self.scheduler.pause_job(schedule_id)
            logger.info(f"⏸️  Paused schedule: {schedule_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to pause schedule {schedule_id}: {e}")
            return False
    
    def resume_schedule(self, schedule_id: str) -> bool:
        """Resume a paused schedule"""
        if not self.scheduler:
            return False
        
        try:
            self.scheduler.resume_job(schedule_id)
            logger.info(f"▶️  Resumed schedule: {schedule_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to resume schedule {schedule_id}: {e}")
            return False
    
    def get_schedule_info(self, schedule_id: str) -> Optional[Dict]:
        """Get information about a schedule"""
        if not self.scheduler:
            return None
        
        try:
            job = self.scheduler.get_job(schedule_id)
            if not job:
                return None
            
            return {
                'schedule_id': job.id,
                'name': job.name,
                'next_run_time': job.next_run_time.isoformat() if job.next_run_time else None,
                'trigger': str(job.trigger),
                'pending': job.pending
            }
        except Exception as e:
            logger.error(f"❌ Failed to get schedule info for {schedule_id}: {e}")
            return None
    
    def list_schedules(self) -> List[Dict]:
        """List all active schedules"""
        if not self.scheduler:
            return []
        
        try:
            jobs = self.scheduler.get_jobs()
            return [
                {
                    'schedule_id': job.id,
                    'name': job.name,
                    'next_run_time': job.next_run_time.isoformat() if job.next_run_time else None,
                    'trigger': str(job.trigger)
                }
                for job in jobs
            ]
        except Exception as e:
            logger.error(f"❌ Failed to list schedules: {e}")
            return []
    
    def _create_trigger(self, schedule_type: str, config: Dict):
        """Create APScheduler trigger from schedule configuration"""
        
        try:
            if schedule_type == 'once':
                # One-time execution
                run_date = datetime.fromisoformat(config['run_date'])
                return DateTrigger(run_date=run_date)
            
            elif schedule_type == 'interval':
                # Recurring interval
                interval_type = config.get('interval_type', 'minutes')
                interval_value = config.get('interval_value', 60)
                
                kwargs = {interval_type: interval_value}
                
                if 'start_date' in config:
                    kwargs['start_date'] = datetime.fromisoformat(config['start_date'])
                if 'end_date' in config:
                    kwargs['end_date'] = datetime.fromisoformat(config['end_date'])
                
                return IntervalTrigger(**kwargs)
            
            elif schedule_type == 'cron':
                # Cron-like expression
                return CronTrigger(
                    year=config.get('year'),
                    month=config.get('month'),
                    day=config.get('day'),
                    week=config.get('week'),
                    day_of_week=config.get('day_of_week'),
                    hour=config.get('hour'),
                    minute=config.get('minute'),
                    second=config.get('second', 0),
                    start_date=config.get('start_date'),
                    end_date=config.get('end_date')
                )
            
            else:
                logger.error(f"❌ Unknown schedule type: {schedule_type}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Failed to create trigger: {e}")
            logger.exception(e)
            return None
    
    def _execute_scheduled_job(self, schedule_id: str):
        """
        Execute a scheduled job
        
        This is the default execution function called by the scheduler.
        It loads the schedule configuration and triggers the AI execution.
        """
        logger.info(f"🚀 Executing scheduled job: {schedule_id}")
        
        try:
            # Import here to avoid circular imports
            from database import SessionLocal
            from models.scheduled_execution import ScheduledExecution, ScheduleExecutionHistory
            
            # Load schedule from database
            session = SessionLocal()
            try:
                schedule = session.query(ScheduledExecution).filter_by(
                    schedule_id=schedule_id
                ).first()
                
                if not schedule:
                    logger.error(f"❌ Schedule not found: {schedule_id}")
                    return
                
                if not schedule.is_active or schedule.is_paused:
                    logger.info(f"⏭️  Skipping inactive/paused schedule: {schedule_id}")
                    return
                
                # Check execution limits
                if schedule.max_executions and schedule.total_executions >= schedule.max_executions:
                    logger.info(f"🛑 Max executions reached for {schedule_id}")
                    schedule.is_active = False
                    session.commit()
                    return
                
                # Create history entry
                history_id = f"SCHED-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{schedule_id[:8]}"
                history = ScheduleExecutionHistory(
                    history_id=history_id,
                    schedule_id=schedule_id,
                    scheduled_time=datetime.utcnow(),
                    status='pending'
                )
                session.add(history)
                session.commit()
                
                # Trigger AI execution
                execution_id = self._trigger_ai_execution(schedule, history)
                
                if execution_id:
                    # Update history
                    history.execution_id = execution_id
                    history.status = 'running'
                    history.actual_start_time = datetime.utcnow()
                    
                    # Update schedule stats
                    schedule.total_executions += 1
                    schedule.last_run_time = datetime.utcnow()
                    schedule.last_execution_id = execution_id
                    
                    session.commit()
                    
                    logger.info(f"✅ Scheduled execution started: {execution_id}")
                else:
                    history.status = 'failed'
                    history.error_message = 'Failed to trigger AI execution'
                    schedule.failed_executions += 1
                    session.commit()
                    
                    logger.error(f"❌ Failed to start scheduled execution for {schedule_id}")
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"❌ Error executing scheduled job {schedule_id}: {e}")
            logger.exception(e)
    
    def _trigger_ai_execution(self, schedule, history) -> Optional[str]:
        """
        Trigger an AI execution based on schedule configuration
        
        Returns:
            str: Execution ID if successful, None otherwise
        """
        try:
            # Import AI execution service
            from routes.smart_execution_ai_routes import active_ai_executions
            from services.smart_execution_engine_ai import SmartExecutionEngineAI
            from database import SessionLocal
            from models.testbed import Testbed
            
            # Get testbed info
            session = SessionLocal()
            try:
                testbed = session.query(Testbed).filter_by(
                    unique_testbed_id=schedule.testbed_id
                ).first()
                
                if not testbed:
                    logger.error(f"❌ Testbed not found: {schedule.testbed_id}")
                    return None
                
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
            execution_id = f"SCHED-AI-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{schedule.testbed_id[:8]}"
            
            # Create AI engine
            ai_engine = SmartExecutionEngineAI(
                execution_id=execution_id,
                testbed_info=testbed_info,
                target_config=schedule.target_config,
                entities_config=schedule.entities_config,
                rule_config=schedule.rule_config or {},
                enable_ml=schedule.ai_settings.get('enable_ml', True) if schedule.ai_settings else True,
                data_collection_mode=schedule.ai_settings.get('data_collection', True) if schedule.ai_settings else True
            )
            
            # Store in active executions
            active_ai_executions[execution_id] = {
                'engine': ai_engine,
                'thread': None,
                'start_time': datetime.utcnow().isoformat(),
                'testbed_id': schedule.testbed_id,
                'schedule_id': schedule.schedule_id
            }
            
            # Start execution in background thread
            import threading
            def run_execution():
                try:
                    ai_engine.start_execution()
                except Exception as e:
                    logger.error(f"❌ Error in scheduled execution: {e}")
                    logger.exception(e)
            
            thread = threading.Thread(target=run_execution, daemon=True)
            thread.start()
            
            active_ai_executions[execution_id]['thread'] = thread
            
            logger.info(f"✅ AI execution triggered: {execution_id}")
            return execution_id
            
        except Exception as e:
            logger.error(f"❌ Failed to trigger AI execution: {e}")
            logger.exception(e)
            return None


# Global scheduler instance
_scheduler_instance = None


def get_scheduler() -> Optional[SchedulerService]:
    """Get global scheduler instance"""
    global _scheduler_instance
    
    if _scheduler_instance is None:
        try:
            from database import DATABASE_URL
            _scheduler_instance = SchedulerService(database_url=DATABASE_URL)
            _scheduler_instance.start()
        except Exception as e:
            logger.error(f"❌ Failed to initialize scheduler: {e}")
            return None
    
    return _scheduler_instance


def load_schedules_from_db():
    """Load all active schedules from database and register with scheduler"""
    logger.info("📂 Loading schedules from database...")
    
    try:
        from database import SessionLocal
        from models.scheduled_execution import ScheduledExecution
        
        scheduler = get_scheduler()
        if not scheduler:
            logger.error("❌ Scheduler not available")
            return
        
        session = SessionLocal()
        try:
            # Get all active schedules
            schedules = session.query(ScheduledExecution).filter_by(
                is_active=True,
                is_paused=False
            ).all()
            
            logger.info(f"Found {len(schedules)} active schedules")
            
            for schedule in schedules:
                scheduler.add_schedule({
                    'schedule_id': schedule.schedule_id,
                    'name': schedule.name,
                    'schedule_type': schedule.schedule_type,
                    'schedule_config': schedule.schedule_config,
                    'args': [schedule.schedule_id]
                })
            
            logger.info(f"✅ Loaded {len(schedules)} schedules")
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Failed to load schedules: {e}")
        logger.exception(e)


if __name__ == '__main__':
    """Run scheduler as standalone service"""
    print("\n" + "="*70)
    print("🕐 SMART EXECUTION SCHEDULER SERVICE")
    print("="*70 + "\n")
    
    if not APSCHEDULER_AVAILABLE:
        print("❌ APScheduler not installed!")
        print("Install with: pip3 install APScheduler")
        sys.exit(1)
    
    # Initialize scheduler
    scheduler = get_scheduler()
    
    if not scheduler:
        print("❌ Failed to initialize scheduler")
        sys.exit(1)
    
    # Load schedules from database
    load_schedules_from_db()
    
    print("\n✅ Scheduler running!")
    print("Press Ctrl+C to exit\n")
    
    try:
        # Keep running
        import time
        while True:
            time.sleep(60)
            # Periodically reload schedules to pick up changes
            load_schedules_from_db()
    except (KeyboardInterrupt, SystemExit):
        print("\n\n🛑 Shutting down scheduler...")
        scheduler.shutdown()
        print("✅ Scheduler stopped\n")
