"""
SQLAlchemy model for Slack Alerts table
"""
from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime

Base = declarative_base()

class SlackAlert(Base):
    __tablename__ = 'slack_alerts'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_id = Column(String(128), unique=True, nullable=False)
    testbed_id = Column(String(128), nullable=False, index=True)
    testbed_label = Column(String(255))
    alert_name = Column(String(255), nullable=False)
    alert_type = Column(String(50), nullable=False)  # 'node', 'pod', 'custom'
    severity = Column(String(50), nullable=False, index=True)  # 'critical', 'warning', 'info'
    status = Column(String(50), nullable=False, default='active', index=True)  # 'active', 'resolved', 'acknowledged'
    description = Column(Text)
    rule_id = Column(String(128))
    triggered_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow, index=True)
    resolved_at = Column(TIMESTAMP)
    webhook_url = Column(Text)
    slack_status = Column(String(50), default='pending')  # 'pending', 'sent', 'failed'
    slack_response = Column(Text)
    metadata = Column(JSONB)  # Additional alert data (labels, annotations, etc.)
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """Convert model to dictionary"""
        return {
            'id': self.id,
            'alert_id': self.alert_id,
            'testbed_id': self.testbed_id,
            'testbed_label': self.testbed_label,
            'alert_name': self.alert_name,
            'alert_type': self.alert_type,
            'severity': self.severity,
            'status': self.status,
            'description': self.description,
            'rule_id': self.rule_id,
            'triggered_at': self.triggered_at.isoformat() if self.triggered_at else None,
            'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
            'webhook_url': self.webhook_url,
            'slack_status': self.slack_status,
            'slack_response': self.slack_response,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f"<SlackAlert(alert_id='{self.alert_id}', alert_name='{self.alert_name}', severity='{self.severity}', status='{self.status}')>"
