from sqlalchemy import Column, Integer, String, DateTime, JSON, Text
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base

class ExecutionTemplate(Base):
    """
    Phase 3: Table to store smart execution templates/presets
    """
    __tablename__ = 'execution_templates'

    id = Column(Integer, primary_key=True)
    template_id = Column(String(128), unique=True, nullable=False, index=True)
    template_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Template configuration
    target_config = Column(JSON, nullable=False)  # CPU threshold, Memory threshold, stop condition
    entities_config = Column(JSON, nullable=False)  # Which entities and operations
    
    # Optional advanced settings
    advanced_settings = Column(JSON, nullable=True)  # Parallel execution, stress workloads, etc.
    
    # Metadata
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    usage_count = Column(Integer, default=0)  # Track how many times used
    is_default = Column(String(10), nullable=True)  # 'yes' or 'no'
    
    def to_dict(self):
        """Convert ExecutionTemplate instance to dictionary"""
        return {
            'id': self.id,
            'template_id': self.template_id,
            'template_name': self.template_name,
            'description': self.description,
            'target_config': self.target_config,
            'entities_config': self.entities_config,
            'advanced_settings': self.advanced_settings,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'usage_count': self.usage_count,
            'is_default': self.is_default
        }
