"""
Execution Models

Data models for execution tracking in NMT.
Copied and adapted from loadgen schemas.

NO EXTERNAL DEPENDENCIES - Self-contained for NMT.
Uses plain Python classes (no pydantic dependency).
"""

from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime
from dataclasses import dataclass, field, asdict


class ExecutionStatus(str, Enum):
    """Possible execution status values"""
    PENDING = "PENDING"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPING = "STOPPING"
    STOPPED = "STOPPED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ERROR = "ERROR"
    
    @classmethod
    def is_terminal(cls, status: str) -> bool:
        """Check if status is terminal (execution finished)"""
        return status in [cls.STOPPED, cls.COMPLETED, cls.FAILED, cls.ERROR]
    
    @classmethod
    def is_active(cls, status: str) -> bool:
        """Check if status is active (execution in progress)"""
        return status in [cls.PENDING, cls.STARTING, cls.RUNNING, cls.PAUSED]


@dataclass
class OperationStats:
    """Statistics for operations during execution"""
    total_operations: int = 0
    completed_operations: int = 0
    successful_operations: int = 0
    failed_operations: int = 0
    pending_operations: int = 0
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage"""
        if self.completed_operations == 0:
            return 0.0
        return (self.successful_operations / self.completed_operations) * 100
    
    @property
    def progress_percentage(self) -> float:
        """Calculate progress as percentage"""
        if self.total_operations == 0:
            return 0.0
        return (self.completed_operations / self.total_operations) * 100
    
    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            'total_operations': self.total_operations,
            'completed_operations': self.completed_operations,
            'successful_operations': self.successful_operations,
            'failed_operations': self.failed_operations,
            'pending_operations': self.pending_operations,
            'success_rate': self.success_rate,
            'progress_percentage': self.progress_percentage
        }


@dataclass
class EntityStats:
    """Statistics for a specific entity type"""
    entity_type: str = ""
    create_count: int = 0
    update_count: int = 0
    delete_count: int = 0
    execute_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    avg_latency_ms: Optional[float] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            'entity_type': self.entity_type,
            'create_count': self.create_count,
            'update_count': self.update_count,
            'delete_count': self.delete_count,
            'execute_count': self.execute_count,
            'success_count': self.success_count,
            'failure_count': self.failure_count,
            'avg_latency_ms': self.avg_latency_ms
        }


@dataclass
class ExecutionRecord:
    """
    Complete execution record for database storage
    """
    execution_id: str = ""
    testbed_id: Optional[str] = None
    status: str = ExecutionStatus.PENDING.value
    progress: int = 0
    
    # Operation statistics
    completed_operations: int = 0
    total_operations: int = 0
    successful_operations: int = 0
    failed_operations: int = 0
    
    # Timestamps
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    
    # Error tracking
    last_error: Optional[str] = None
    
    # Configuration
    config: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for database storage"""
        return {
            'execution_id': self.execution_id,
            'testbed_id': self.testbed_id,
            'status': self.status.value if isinstance(self.status, ExecutionStatus) else self.status,
            'progress': self.progress,
            'completed_operations': self.completed_operations,
            'total_operations': self.total_operations,
            'successful_operations': self.successful_operations,
            'failed_operations': self.failed_operations,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_error': self.last_error,
            'config': self.config
        }


@dataclass
class ExecutionStatusResponse:
    """Response model for execution status API"""
    success: bool = True
    execution_id: str = ""
    status: str = ExecutionStatus.PENDING.value
    progress: float = 0.0
    stats: Optional[OperationStats] = None
    duration_minutes: Optional[float] = None
    estimated_end: Optional[datetime] = None
    last_error: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for API response"""
        return {
            'success': self.success,
            'execution_id': self.execution_id,
            'status': self.status.value if isinstance(self.status, ExecutionStatus) else self.status,
            'progress': self.progress,
            'stats': self.stats.to_dict() if self.stats else None,
            'duration_minutes': self.duration_minutes,
            'estimated_end': self.estimated_end.isoformat() if self.estimated_end else None,
            'last_error': self.last_error
        }


@dataclass
class ExecutionRequest:
    """Request model for starting execution"""
    testbed_id: str = ""
    config: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return asdict(self)
