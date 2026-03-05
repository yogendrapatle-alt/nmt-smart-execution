"""
Email Schedule Model - PostgreSQL Implementation
Database model for email scheduling configuration using existing PostgreSQL database
"""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean, Text, TIMESTAMP
from datetime import datetime

# Use the same Base as other models
from .alert import Base

class EmailSchedule(Base):
    __tablename__ = 'email_schedules'

    id = Column(Integer, primary_key=True)
    
    # User identification - supports multiple users and multiple schedules per user
    user_email = Column(String(255), nullable=False, index=True)
    schedule_name = Column(String(255), nullable=False)
    
    # Schedule configuration  
    schedule_time = Column(String(50), nullable=False)  # Cron format or HH:MM
    timezone = Column(String(50), default='UTC')
    
    # Email configuration
    email_addresses = Column(Text, nullable=False)  # Comma-separated string
    subject = Column(String(255))
    
    # Filter configuration (stored as JSONB)
    filters = Column(JSON)
    
    # Status and control
    enabled = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow)
    last_executed_at = Column(TIMESTAMP)
    last_execution_status = Column(String(20))
    execution_error = Column(Text)

    def to_dict(self):
        """Convert EmailSchedule instance to dictionary"""
        return {
            'id': self.id,
            'userEmail': self.user_email,
            'scheduleName': self.schedule_name,
            'emailAddresses': self.email_addresses.split(',') if self.email_addresses else [],
            'enabled': self.enabled,
            'scheduleTime': self.schedule_time,
            'timezone': self.timezone,
            'subject': self.subject,
            'filters': self.filters or {},
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'updatedAt': self.updated_at.isoformat() if self.updated_at else None,
            'lastExecutedAt': self.last_executed_at.isoformat() if self.last_executed_at else None,
            'lastExecutionStatus': self.last_execution_status,
            'executionError': self.execution_error
        }
    
    @classmethod
    def from_dict(cls, data):
        """Create EmailSchedule instance from dictionary"""
        # Handle email addresses - convert array to comma-separated string
        email_addresses = data.get('emailAddresses', [])
        if isinstance(email_addresses, list):
            email_addresses = ','.join(email_addresses)
        
        return cls(
            user_email=data.get('userEmail'),
            schedule_name=data.get('scheduleName'),
            email_addresses=email_addresses,
            enabled=data.get('enabled', True),
            schedule_time=data.get('scheduleTime'),
            timezone=data.get('timezone', 'UTC'),
            subject=data.get('subject'),
            filters=data.get('filters', {})
        )
    
    def update_from_dict(self, data):
        """Update EmailSchedule instance from dictionary"""
        # Handle email addresses
        if 'emailAddresses' in data:
            email_addresses = data['emailAddresses']
            if isinstance(email_addresses, list):
                self.email_addresses = ','.join(email_addresses)
            else:
                self.email_addresses = email_addresses
        
        # Update other fields
        if 'scheduleName' in data:
            self.schedule_name = data['scheduleName']
        if 'enabled' in data:
            self.enabled = data['enabled']
        if 'scheduleTime' in data:
            self.schedule_time = data['scheduleTime']
        if 'timezone' in data:
            self.timezone = data['timezone']
        if 'subject' in data:
            self.subject = data['subject']
        if 'filters' in data:
            self.filters = data['filters']
        
        # Update timestamp
        self.updated_at = datetime.utcnow()
    
    def update_execution_status(self, status, error=None):
        """Update execution status after running a scheduled job"""
        self.last_executed_at = datetime.utcnow()
        self.last_execution_status = status
        self.execution_error = error if status == 'failed' else None
        self.updated_at = datetime.utcnow()

    def __repr__(self):
        return f"<EmailSchedule(id={self.id}, user={self.user_email}, name={self.schedule_name}, enabled={self.enabled})>"
