"""
Monitor Session Model

Stores configuration + state for standalone testbed monitoring sessions
(Monitor-Only mode — no smart workload execution, just rule evaluation).
"""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, Text
from datetime import datetime

# Reuse the same declarative Base used by other models so they all live
# in the same metadata and a single create_all() picks them up.
from .alert import Base


class MonitorSession(Base):
    """A standalone Prometheus rule-watcher session for a single testbed.

    Lifecycle: ``STARTING → RUNNING → STOPPED|FAILED``. Rows persist after
    stop so the user can see the run history.
    """

    __tablename__ = 'monitor_sessions'

    id = Column(Integer, primary_key=True)
    monitor_id = Column(String(128), unique=True, nullable=False, index=True)

    # What we're watching
    testbed_id = Column(String(128), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)

    # Status
    status = Column(String(24), nullable=False, default='STARTING', index=True)
    last_error = Column(Text, nullable=True)

    # Timing
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    stopped_at = Column(DateTime, nullable=True)
    last_poll_at = Column(DateTime, nullable=True)

    # Configuration
    poll_interval_s = Column(Integer, nullable=False, default=30)
    duration_hours = Column(Float, nullable=True)  # NULL = run until manually stopped
    rule_config = Column(JSON, nullable=False)     # { monitoring_rules: [...] }
    settings = Column(JSON, nullable=True)         # slack/email/persist toggles

    # Counters
    total_polls = Column(Integer, default=0, nullable=False)
    total_violations = Column(Integer, default=0, nullable=False)

    # Phase-2: timeseries snapshots captured on every poll. Shape:
    #   {
    #     "cluster_cpu":   [[ts_iso, value], …],
    #     "cluster_mem":   [[ts_iso, value], …],
    #     "cluster_max_cpu": [[ts_iso, value], …],
    #     "cluster_max_mem": [[ts_iso, value], …],
    #     "rule_health":   { "<rule_id>": { "polls": N, "fired": M, "last_value": v } }
    #   }
    # We cap each list at MAX_SAMPLES (~720 = 6h at 30s polling) by downsampling.
    metric_samples = Column(JSON, nullable=True)

    def to_dict(self):
        return {
            'monitor_id': self.monitor_id,
            'testbed_id': self.testbed_id,
            'name': self.name,
            'description': self.description,
            'status': self.status,
            'last_error': self.last_error,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'stopped_at': self.stopped_at.isoformat() if self.stopped_at else None,
            'last_poll_at': self.last_poll_at.isoformat() if self.last_poll_at else None,
            'poll_interval_s': self.poll_interval_s,
            'duration_hours': self.duration_hours,
            'rule_config': self.rule_config,
            'settings': self.settings,
            'total_polls': self.total_polls,
            'total_violations': self.total_violations,
            'metric_samples': self.metric_samples,
        }
