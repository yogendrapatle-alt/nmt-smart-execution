"""
Cost Tracking Models

Track costs and budgets for Smart Executions.
"""

from sqlalchemy import Column, Integer, String, DateTime, Float, JSON, Boolean
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base


class CostTracker(Base):
    """
    Model for tracking costs of executions
    """
    __tablename__ = 'cost_tracker'
    
    id = Column(Integer, primary_key=True)
    cost_id = Column(String(128), unique=True, nullable=False, index=True)
    
    # Execution references
    execution_id = Column(String(128), nullable=False, index=True)
    execution_type = Column(String(50), nullable=False)  # 'smart_execution', 'multi_testbed', 'scheduled'
    testbed_id = Column(String(128), nullable=False, index=True)
    
    # Resource consumption
    cpu_hours = Column(Float, default=0.0)
    memory_gb_hours = Column(Float, default=0.0)
    storage_gb_hours = Column(Float, default=0.0)
    network_gb = Column(Float, default=0.0)
    operation_count = Column(Integer, default=0)
    duration_minutes = Column(Float, default=0.0)
    
    # Cost rates ($ per unit)
    cpu_rate = Column(Float, default=0.10)  # $ per CPU hour
    memory_rate = Column(Float, default=0.01)  # $ per GB-hour
    storage_rate = Column(Float, default=0.001)  # $ per GB-hour
    network_rate = Column(Float, default=0.05)  # $ per GB
    operation_rate = Column(Float, default=0.0001)  # $ per operation
    
    # Calculated costs
    cpu_cost = Column(Float, default=0.0)
    memory_cost = Column(Float, default=0.0)
    storage_cost = Column(Float, default=0.0)
    network_cost = Column(Float, default=0.0)
    operation_cost = Column(Float, default=0.0)
    total_cost = Column(Float, default=0.0)
    
    # Additional metadata
    cost_breakdown = Column(JSON, nullable=True)  # Detailed breakdown
    optimization_potential = Column(Float, default=0.0)  # Potential savings
    cost_efficiency_score = Column(Float, default=0.0)  # 0-100 score
    
    # Timestamps
    execution_date = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    
    def calculate_costs(self):
        """Calculate all costs based on consumption and rates"""
        self.cpu_cost = self.cpu_hours * self.cpu_rate
        self.memory_cost = self.memory_gb_hours * self.memory_rate
        self.storage_cost = self.storage_gb_hours * self.storage_rate
        self.network_cost = self.network_gb * self.network_rate
        self.operation_cost = self.operation_count * self.operation_rate
        self.total_cost = (self.cpu_cost + self.memory_cost + 
                          self.storage_cost + self.network_cost + 
                          self.operation_cost)
        
        return self.total_cost
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'cost_id': self.cost_id,
            'execution_id': self.execution_id,
            'execution_type': self.execution_type,
            'testbed_id': self.testbed_id,
            'resource_consumption': {
                'cpu_hours': self.cpu_hours,
                'memory_gb_hours': self.memory_gb_hours,
                'storage_gb_hours': self.storage_gb_hours,
                'network_gb': self.network_gb,
                'operation_count': self.operation_count,
                'duration_minutes': self.duration_minutes
            },
            'costs': {
                'cpu_cost': round(self.cpu_cost, 4),
                'memory_cost': round(self.memory_cost, 4),
                'storage_cost': round(self.storage_cost, 4),
                'network_cost': round(self.network_cost, 4),
                'operation_cost': round(self.operation_cost, 4),
                'total_cost': round(self.total_cost, 4)
            },
            'optimization_potential': self.optimization_potential,
            'cost_efficiency_score': self.cost_efficiency_score,
            'execution_date': self.execution_date.isoformat() if self.execution_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class BudgetLimit(Base):
    """
    Model for budget limits and alerts
    """
    __tablename__ = 'budget_limits'
    
    id = Column(Integer, primary_key=True)
    budget_id = Column(String(128), unique=True, nullable=False, index=True)
    
    # Budget scope
    scope_type = Column(String(50), nullable=False)  # 'testbed', 'global', 'project'
    scope_id = Column(String(128), nullable=True, index=True)  # testbed_id or project_id
    scope_name = Column(String(255), nullable=False)
    
    # Budget limits
    daily_limit = Column(Float, nullable=True)
    weekly_limit = Column(Float, nullable=True)
    monthly_limit = Column(Float, nullable=True)
    
    # Current spending
    daily_spent = Column(Float, default=0.0)
    weekly_spent = Column(Float, default=0.0)
    monthly_spent = Column(Float, default=0.0)
    
    # Alert thresholds (percentage)
    alert_threshold = Column(Float, default=80.0)  # Alert at 80%
    block_threshold = Column(Float, default=100.0)  # Block at 100%
    
    # Status
    is_active = Column(Boolean, default=True)
    is_blocking = Column(Boolean, default=False)  # True if over budget
    
    # Metadata
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    last_reset_at = Column(DateTime, nullable=True)
    
    def check_budget_status(self, period='monthly'):
        """
        Check if budget is exceeded
        
        Args:
            period: 'daily', 'weekly', or 'monthly'
        
        Returns:
            dict with status info
        """
        if period == 'daily' and self.daily_limit:
            spent = self.daily_spent
            limit = self.daily_limit
        elif period == 'weekly' and self.weekly_limit:
            spent = self.weekly_spent
            limit = self.weekly_limit
        elif period == 'monthly' and self.monthly_limit:
            spent = self.monthly_spent
            limit = self.monthly_limit
        else:
            return {'status': 'no_limit', 'percentage': 0}
        
        percentage = (spent / limit * 100) if limit > 0 else 0
        
        if percentage >= self.block_threshold:
            status = 'blocked'
        elif percentage >= self.alert_threshold:
            status = 'warning'
        else:
            status = 'ok'
        
        return {
            'status': status,
            'spent': spent,
            'limit': limit,
            'percentage': round(percentage, 2),
            'remaining': limit - spent
        }
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'budget_id': self.budget_id,
            'scope_type': self.scope_type,
            'scope_id': self.scope_id,
            'scope_name': self.scope_name,
            'limits': {
                'daily_limit': self.daily_limit,
                'weekly_limit': self.weekly_limit,
                'monthly_limit': self.monthly_limit
            },
            'spending': {
                'daily_spent': round(self.daily_spent, 2),
                'weekly_spent': round(self.weekly_spent, 2),
                'monthly_spent': round(self.monthly_spent, 2)
            },
            'thresholds': {
                'alert_threshold': self.alert_threshold,
                'block_threshold': self.block_threshold
            },
            'status': {
                'is_active': self.is_active,
                'is_blocking': self.is_blocking
            },
            'budget_status': {
                'daily': self.check_budget_status('daily'),
                'weekly': self.check_budget_status('weekly'),
                'monthly': self.check_budget_status('monthly')
            },
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
