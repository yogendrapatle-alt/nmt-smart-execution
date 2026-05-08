"""
AlertLogBundle Model
====================

One row per log-collection attempt triggered by a monitoring-rule violation.

Each bundle has a lifecycle: ``PENDING → COLLECTING → READY|FAILED|MISSING_CREDS|UNAVAILABLE``.

The ``stdout_tail`` field holds the last ~32 KB of output so the user can
preview what was captured without downloading the (potentially huge) bundle.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON, Text, Float

from .alert import Base


class AlertLogBundle(Base):
    __tablename__ = 'alert_log_bundles'

    id = Column(Integer, primary_key=True)

    # Origin of the log-collection request
    monitor_id = Column(String(128), index=True, nullable=True)         # nullable so AI-EXEC can also use it
    execution_id = Column(String(128), index=True, nullable=True)       # cross-link
    testbed_id = Column(String(128), nullable=False, index=True)
    alert_id = Column(Integer, nullable=True, index=True)               # alert_summaries.id
    rule_id = Column(String(128), nullable=True)
    rule_name = Column(String(255), nullable=True)
    severity = Column(String(24), nullable=True)

    # Collection target / config
    pc_ip = Column(String(64), nullable=True)
    ncm_ip = Column(String(64), nullable=True)
    duration_hours = Column(Float, nullable=True, default=1.0)

    # Lifecycle
    status = Column(String(24), nullable=False, default='PENDING', index=True)
    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)

    # Output
    bundle_path = Column(String(512), nullable=True)                    # remote / local path to the bundle
    bundle_size_bytes = Column(Integer, nullable=True)
    stdout_tail = Column(Text, nullable=True)                           # last 32KB of collector output (for in-app preview)
    metadata_json = Column(JSON, nullable=True)                         # extra info (cluster uuid, hosts, etc.)

    def to_dict(self):
        return {
            'id': self.id,
            'monitor_id': self.monitor_id,
            'execution_id': self.execution_id,
            'testbed_id': self.testbed_id,
            'alert_id': self.alert_id,
            'rule_id': self.rule_id,
            'rule_name': self.rule_name,
            'severity': self.severity,
            'pc_ip': self.pc_ip,
            'ncm_ip': self.ncm_ip,
            'duration_hours': self.duration_hours,
            'status': self.status,
            'requested_at': self.requested_at.isoformat() if self.requested_at else None,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'error': self.error,
            'bundle_path': self.bundle_path,
            'bundle_size_bytes': self.bundle_size_bytes,
            'stdout_tail': self.stdout_tail,
            'metadata': self.metadata_json,
        }
