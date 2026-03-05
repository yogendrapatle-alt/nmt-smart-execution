"""
Multi-Testbed Execution Model

Stores information about executions that run across multiple testbeds simultaneously.
"""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Text
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base


class MultiTestbedExecution(Base):
    """
    Model for multi-testbed executions (orchestrated execution across multiple testbeds)
    """
    __tablename__ = 'multi_testbed_executions'
    
    id = Column(Integer, primary_key=True)
    multi_execution_id = Column(String(128), unique=True, nullable=False, index=True)
    execution_name = Column(String(255), nullable=True)
    
    # Configuration
    testbed_ids = Column(JSON, nullable=False)  # List of testbed IDs
    target_config = Column(JSON, nullable=False)  # Shared target configuration
    entities_config = Column(JSON, nullable=False)  # Shared entity configuration
    ai_settings = Column(JSON, nullable=True)  # AI/ML settings
    
    # Execution status
    status = Column(String(50), nullable=False, default='initializing')  # initializing, running, completed, failed, partial
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Individual execution tracking
    child_executions = Column(JSON, nullable=True)  # List of individual execution IDs per testbed
    
    # Aggregate metrics
    total_testbeds = Column(Integer, default=0)
    completed_testbeds = Column(Integer, default=0)
    failed_testbeds = Column(Integer, default=0)
    
    aggregate_metrics = Column(JSON, nullable=True)  # Combined metrics across all testbeds
    
    # Progress tracking
    progress_data = Column(JSON, nullable=True)  # Real-time progress per testbed
    
    # Metadata
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    notes = Column(Text, nullable=True)
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'multi_execution_id': self.multi_execution_id,
            'execution_name': self.execution_name,
            'testbed_ids': self.testbed_ids,
            'target_config': self.target_config,
            'entities_config': self.entities_config,
            'ai_settings': self.ai_settings,
            'status': self.status,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'child_executions': self.child_executions,
            'total_testbeds': self.total_testbeds,
            'completed_testbeds': self.completed_testbeds,
            'failed_testbeds': self.failed_testbeds,
            'aggregate_metrics': self.aggregate_metrics,
            'progress_data': self.progress_data,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'notes': self.notes
        }


class TestbedGroup(Base):
    """
    Model for testbed groups (named collections of testbeds for quick selection)
    """
    __tablename__ = 'testbed_groups'
    
    id = Column(Integer, primary_key=True)
    group_id = Column(String(128), unique=True, nullable=False, index=True)
    group_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Group members
    testbed_ids = Column(JSON, nullable=False)  # List of testbed IDs in this group
    
    # Metadata
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    usage_count = Column(Integer, default=0)  # Track how many times used
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'group_id': self.group_id,
            'group_name': self.group_name,
            'description': self.description,
            'testbed_ids': self.testbed_ids,
            'testbed_count': len(self.testbed_ids) if self.testbed_ids else 0,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'usage_count': self.usage_count
        }
