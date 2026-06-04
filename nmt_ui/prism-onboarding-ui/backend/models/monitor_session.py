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

    # Enhanced-report parity (Phase 1):
    #   baseline_health         — one-shot cluster_health snapshot captured at
    #                             monitor start. Lets the report show
    #                             "Total restarts: 12 → 38 (+26 during window)".
    #   cluster_health_snapshot — periodic (every ~5 min) snapshot of the
    #                             full pod/node/container health structure so
    #                             the report has rich per-pod data even after
    #                             the monitor process is gone.
    #   consecutive_failed_polls — count of consecutive Prometheus probe
    #                             failures. Flips status -> DEGRADED above the
    #                             threshold so the Live view can warn testers.
    #   last_prometheus_error   — most recent Prometheus failure reason (string).
    #   rule_history            — audit trail of rule hot-swaps. Each entry:
    #                             {ts, replaced_count, dropped_cooldowns,
    #                              total_rules, source}
    #   slack_channel_override  — per-monitor Slack channel override (Phase 3).
    #   schedule                — {start_at: iso, repeat: 'once|daily|weekly',
    #                              status: 'pending|materialised'} (Phase 4).
    baseline_health = Column(JSON, nullable=True)
    cluster_health_snapshot = Column(JSON, nullable=True)
    consecutive_failed_polls = Column(Integer, default=0, nullable=False)
    last_prometheus_error = Column(Text, nullable=True)
    rule_history = Column(JSON, nullable=True)
    slack_channel_override = Column(String(128), nullable=True)
    schedule = Column(JSON, nullable=True)

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
            'baseline_health': self.baseline_health,
            'cluster_health_snapshot': self.cluster_health_snapshot,
            'consecutive_failed_polls': self.consecutive_failed_polls or 0,
            'last_prometheus_error': self.last_prometheus_error,
            'rule_history': self.rule_history,
            'slack_channel_override': self.slack_channel_override,
            'schedule': self.schedule,
        }
