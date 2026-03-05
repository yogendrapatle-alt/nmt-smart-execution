"""
Scheduled Execution Model

Stores configuration for scheduled/recurring AI executions.
Supports cron-like scheduling with flexible recurrence patterns.
"""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean, Text
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

# Use the same Base as other models
from .alert import Base


class ScheduledExecution(Base):
    """
    Model for scheduled AI executions
    
    Supports:
    - One-time executions (scheduled for specific time)
    - Recurring executions (cron-like patterns)
    - Flexible configuration
    - Execution history tracking
    """
    __tablename__ = 'scheduled_executions'
    
    # Primary key
    id = Column(Integer, primary_key=True)
    schedule_id = Column(String(128), unique=True, nullable=False, index=True)
    
    # Basic info
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(String(128), nullable=True)
    
    # Schedule configuration
    schedule_type = Column(String(50), nullable=False)  # 'once', 'recurring', 'cron'
    schedule_config = Column(JSON, nullable=False)  # Cron expression, interval, etc.
    next_run_time = Column(DateTime, nullable=True, index=True)
    last_run_time = Column(DateTime, nullable=True)
    
    # Execution configuration (what to run)
    testbed_id = Column(String(128), nullable=False, index=True)
    target_config = Column(JSON, nullable=False)  # CPU/Memory thresholds
    entities_config = Column(JSON, nullable=False)  # Entities and operations
    rule_config = Column(JSON, nullable=True)  # Prometheus rules
    ai_settings = Column(JSON, nullable=True)  # AI/ML configuration
    
    # Status
    is_active = Column(Boolean, default=True, index=True)
    is_paused = Column(Boolean, default=False)
    
    # Execution tracking
    total_executions = Column(Integer, default=0)
    successful_executions = Column(Integer, default=0)
    failed_executions = Column(Integer, default=0)
    last_execution_id = Column(String(128), nullable=True)
    last_execution_status = Column(String(50), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_modified_by = Column(String(128), nullable=True)
    
    # Execution window (optional)
    execution_window_start = Column(String(10), nullable=True)  # e.g., "22:00"
    execution_window_end = Column(String(10), nullable=True)    # e.g., "06:00"
    
    # Limits
    max_executions = Column(Integer, nullable=True)  # Max total executions (null = unlimited)
    max_concurrent = Column(Integer, default=1)  # Max concurrent executions
    
    # Notifications
    notify_on_completion = Column(Boolean, default=False)
    notify_on_failure = Column(Boolean, default=True)
    notification_channels = Column(JSON, nullable=True)  # ['slack', 'email']
    
    # Metadata
    tags = Column(JSON, nullable=True)  # For organization/filtering
    priority = Column(Integer, default=5)  # 1-10, higher = more important
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'schedule_id': self.schedule_id,
            'name': self.name,
            'description': self.description,
            'created_by': self.created_by,
            'schedule_type': self.schedule_type,
            'schedule_config': self.schedule_config,
            'next_run_time': self.next_run_time.isoformat() if self.next_run_time else None,
            'last_run_time': self.last_run_time.isoformat() if self.last_run_time else None,
            'testbed_id': self.testbed_id,
            'target_config': self.target_config,
            'entities_config': self.entities_config,
            'rule_config': self.rule_config,
            'ai_settings': self.ai_settings,
            'is_active': self.is_active,
            'is_paused': self.is_paused,
            'total_executions': self.total_executions,
            'successful_executions': self.successful_executions,
            'failed_executions': self.failed_executions,
            'last_execution_id': self.last_execution_id,
            'last_execution_status': self.last_execution_status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_modified_by': self.last_modified_by,
            'execution_window_start': self.execution_window_start,
            'execution_window_end': self.execution_window_end,
            'max_executions': self.max_executions,
            'max_concurrent': self.max_concurrent,
            'notify_on_completion': self.notify_on_completion,
            'notify_on_failure': self.notify_on_failure,
            'notification_channels': self.notification_channels,
            'tags': self.tags,
            'priority': self.priority
        }
    
    def __repr__(self):
        return f"<ScheduledExecution(schedule_id='{self.schedule_id}', name='{self.name}', type='{self.schedule_type}', active={self.is_active})>"


class ScheduleExecutionHistory(Base):
    """
    History of scheduled execution runs
    
    Tracks each individual execution triggered by a schedule.
    """
    __tablename__ = 'schedule_execution_history'
    
    id = Column(Integer, primary_key=True)
    history_id = Column(String(128), unique=True, nullable=False, index=True)
    
    # Links
    schedule_id = Column(String(128), nullable=False, index=True)
    execution_id = Column(String(128), nullable=True, index=True)  # Smart execution ID
    
    # Execution info
    scheduled_time = Column(DateTime, nullable=False)  # When it was supposed to run
    actual_start_time = Column(DateTime, nullable=True)  # When it actually started
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    
    # Status
    status = Column(String(50), nullable=False)  # 'pending', 'running', 'completed', 'failed', 'skipped'
    error_message = Column(Text, nullable=True)
    
    # Results summary
    total_operations = Column(Integer, default=0)
    successful_operations = Column(Integer, default=0)
    failed_operations = Column(Integer, default=0)
    threshold_reached = Column(Boolean, default=False)
    
    # Metadata
    triggered_by = Column(String(128), default='scheduler')  # 'scheduler', 'manual', 'api'
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'history_id': self.history_id,
            'schedule_id': self.schedule_id,
            'execution_id': self.execution_id,
            'scheduled_time': self.scheduled_time.isoformat() if self.scheduled_time else None,
            'actual_start_time': self.actual_start_time.isoformat() if self.actual_start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_minutes': self.duration_minutes,
            'status': self.status,
            'error_message': self.error_message,
            'total_operations': self.total_operations,
            'successful_operations': self.successful_operations,
            'failed_operations': self.failed_operations,
            'threshold_reached': self.threshold_reached,
            'triggered_by': self.triggered_by,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    def __repr__(self):
        return f"<ScheduleExecutionHistory(schedule_id='{self.schedule_id}', status='{self.status}')>"
