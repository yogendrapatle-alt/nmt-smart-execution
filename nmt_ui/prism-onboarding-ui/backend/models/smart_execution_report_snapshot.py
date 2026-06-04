"""
Smart-Execution Report Snapshot Model (Layer-2, Phase D)
========================================================

Materialised, view-ready report for a single smart-execution — the same
architecture as ``monitor_report_snapshots`` (see
models/monitor_report_snapshot.py) applied to the heavier, more failure-prone
smart-execution enhanced report.

Unlike the monitor report (which has a clean ``build_report``), the
smart-execution enhanced report is assembled inline in the route from three
sources (active AI engine / in-memory controller / DB) and rendered with a
large kwargs set. Rather than re-derive that fragile assembly, we capture the
EXACT ``render_kwargs`` the template was rendered with ("capture at render")
and store them here. Serving = re-render the same template from the stored
kwargs → byte-for-byte the same HTML, with zero new build-path divergence and
no dependency on Prometheus / the in-memory engine being alive.

``payload`` therefore contains:
  * ``render_kwargs`` — everything passed to ``template.render(**kwargs)``
    (bounded: cluster_health / pod_health arrays capped, ops list route-capped)
  * ``enhanced_data``  — the raw enhanced-report dict (for ``?format=json``)
  * ``meta``           — execution_id / testbed_label / status echo
"""

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime

from .alert import Base


class SmartExecutionReportSnapshot(Base):
    """Materialised enhanced report for one smart-execution (one row per exec)."""

    __tablename__ = 'smart_execution_report_snapshots'

    execution_id = Column(String(128), primary_key=True)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    generator_version = Column(Integer, nullable=False, default=1)
    data_quality = Column(String(32), nullable=False, default='persisted_only')
    banner_text = Column(Text, nullable=True)
    size_bytes = Column(Integer, nullable=False, default=0)
    poll_count_at_gen = Column(Integer, nullable=False, default=0)
    payload = Column(JSONB, nullable=False)

    def to_dict(self):
        return {
            'execution_id': self.execution_id,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'generator_version': self.generator_version,
            'data_quality': self.data_quality,
            'banner_text': self.banner_text,
            'size_bytes': self.size_bytes,
            'poll_count_at_gen': self.poll_count_at_gen,
            'payload': self.payload,
        }
