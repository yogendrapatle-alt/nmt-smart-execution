"""
Monitor Report Snapshot Model
=============================

Layer-2 of the report architecture refactor (2026-06-04).

A *materialised* report. The poller (Layer-1 capture) keeps writing raw
observations into ``monitor_sessions`` JSONB columns. This table holds ONE
row per monitor: a pre-computed, bounded, view-ready report payload that the
read API (Layer-3) serves with a single indexed SELECT — no Prometheus, no
SSH, no kubectl, no heavy JSONB unpacking on the request path.

Why this exists
---------------
Before this table, ``/api/monitor-only/<id>/report`` recomputed the entire
report from raw observations on every page load: ~30 Prometheus queries +
pod-health classification over MB-sized JSONB. That made the report:
  * slow (60-260s cold for long monitors),
  * fragile (any Prometheus / NodePort blip surfaced as a user-facing error),
  * unbounded (older / longer monitors rendered slower than newer ones).

By materialising the report at *capture time* (in the poller, off the request
path) and serving the stored payload, reads become O(1) and never depend on
anything external being reachable.

Payload contract
----------------
``payload`` is the bounded report dict produced by
``services.report_snapshot_builder.build_snapshot``. Its shape is versioned
via ``generator_version`` so readers can tolerate an older snapshot for a
release cycle after the builder changes.
"""

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime

# Reuse the single declarative Base shared by every model so a single
# Base.metadata.create_all() (called by database.init_db) picks this up.
from .alert import Base


class MonitorReportSnapshot(Base):
    """Materialised, view-ready report for a single monitor session.

    One row per ``monitor_id``. Rewritten in place (UPSERT) by the poller
    every N polls, on session stop, and on explicit admin rebuild.
    """

    __tablename__ = 'monitor_report_snapshots'

    # FK-by-convention to monitor_sessions.monitor_id (not a hard FK so a
    # snapshot can outlive a purged session row and so backfill never fails
    # on a missing parent during a race).
    monitor_id = Column(String(128), primary_key=True)

    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Bumped whenever build_snapshot's payload shape changes so readers can
    # detect-and-tolerate (or trigger a rebuild of) stale-shaped snapshots.
    generator_version = Column(Integer, nullable=False, default=1)

    # Single source of truth for the UI banner. See report_snapshot_builder
    # DATA_QUALITY_* constants. One of:
    #   live | live_with_gaps | persisted_only | stale | unconfigured | error
    data_quality = Column(String(32), nullable=False, default='persisted_only')

    # Precomputed, human-readable banner string (or NULL = no banner).
    banner_text = Column(Text, nullable=True)

    # Observability into payload bloat — lets a purge/alert job spot a
    # snapshot that grew past the bounded budget.
    size_bytes = Column(Integer, nullable=False, default=0)

    # Poll counter at generation time so the UI can show "from poll 1,247".
    poll_count_at_gen = Column(Integer, nullable=False, default=0)

    # The entire bounded report payload (see module docstring).
    payload = Column(JSONB, nullable=False)

    def to_dict(self):
        return {
            'monitor_id': self.monitor_id,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'generator_version': self.generator_version,
            'data_quality': self.data_quality,
            'banner_text': self.banner_text,
            'size_bytes': self.size_bytes,
            'poll_count_at_gen': self.poll_count_at_gen,
            'payload': self.payload,
        }
