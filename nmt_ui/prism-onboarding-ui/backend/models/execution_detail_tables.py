"""
Normalized tables for execution drill-down data.

These tables break out the large JSON blobs from smart_executions.operations_history
and smart_executions.metrics_history into queryable rows so Phase-3 APIs can
serve filtered / paginated data for the enhanced report UI.

Tables:
  execution_api_logs        — one row per API call (create/list/delete)
  execution_pod_events      — one row per pod restart / OOM / termination event
  execution_metrics_timeline — one row per metrics sample, optionally per-node
"""

from sqlalchemy import (
    Column, Integer, String, DateTime, JSON, Float, Boolean, Text, Index, UniqueConstraint,
)
import datetime

from .alert import Base


class ExecutionApiLog(Base):
    """Individual API call record for an execution operation."""

    __tablename__ = 'execution_api_logs'

    id = Column(Integer, primary_key=True)
    execution_id = Column(String(128), nullable=False, index=True)
    iteration = Column(Integer, nullable=True)
    operation_id = Column(String(32), nullable=True)
    sequence_number = Column(Integer, nullable=True)

    entity_type = Column(String(64), nullable=True)
    operation = Column(String(32), nullable=True)
    entity_name = Column(String(255), nullable=True)

    api_url = Column(Text, nullable=True)
    http_method = Column(String(10), nullable=True)
    http_status_code = Column(Integer, nullable=True)
    status = Column(String(20), nullable=True)

    request_payload = Column(JSON, nullable=True)
    response_body = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)

    duration_seconds = Column(Float, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        Index('ix_api_logs_exec_status', 'execution_id', 'status'),
        Index('ix_api_logs_exec_iter', 'execution_id', 'iteration'),
        UniqueConstraint('execution_id', 'operation_id', name='uq_api_logs_exec_op'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'execution_id': self.execution_id,
            'iteration': self.iteration,
            'operation_id': self.operation_id,
            'sequence_number': self.sequence_number,
            'entity_type': self.entity_type,
            'operation': self.operation,
            'entity_name': self.entity_name,
            'api_url': self.api_url,
            'http_method': self.http_method,
            'http_status_code': self.http_status_code,
            'status': self.status,
            'request_payload': self.request_payload,
            'response_body': self.response_body,
            'error_message': self.error_message,
            'duration_seconds': self.duration_seconds,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }


class ExecutionPodEvent(Base):
    """Pod restart / termination event detected during execution."""

    __tablename__ = 'execution_pod_events'

    id = Column(Integer, primary_key=True)
    execution_id = Column(String(128), nullable=False, index=True)

    pod_name = Column(String(255), nullable=False)
    namespace = Column(String(128), nullable=True)
    container = Column(String(128), nullable=True)

    event_type = Column(String(32), nullable=False, default='restart')
    restart_reason = Column(String(64), nullable=True)
    exit_code = Column(Integer, nullable=True)
    new_restarts = Column(Integer, default=0)
    total_since_start = Column(Integer, default=0)
    cumulative_total = Column(Integer, default=0)
    log_snippet = Column(Text, nullable=True)

    execution_elapsed_min = Column(Float, nullable=True)
    detected_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        Index('ix_pod_events_exec', 'execution_id', 'detected_at'),
        UniqueConstraint('execution_id', 'pod_name', 'container', 'detected_at',
                         name='uq_pod_events_natural'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'execution_id': self.execution_id,
            'pod_name': self.pod_name,
            'namespace': self.namespace,
            'container': self.container,
            'event_type': self.event_type,
            'restart_reason': self.restart_reason,
            'exit_code': self.exit_code,
            'new_restarts': self.new_restarts,
            'total_since_start': self.total_since_start,
            'cumulative_total': self.cumulative_total,
            'log_snippet': self.log_snippet,
            'execution_elapsed_min': self.execution_elapsed_min,
            'detected_at': self.detected_at.isoformat() if self.detected_at else None,
        }


class ExecutionMetricsTimeline(Base):
    """Per-iteration cluster + per-node metrics sample."""

    __tablename__ = 'execution_metrics_timeline'

    id = Column(Integer, primary_key=True)
    execution_id = Column(String(128), nullable=False, index=True)
    iteration = Column(Integer, nullable=True)

    cluster_cpu_percent = Column(Float, nullable=True)
    cluster_memory_percent = Column(Float, nullable=True)

    node_id = Column(String(128), nullable=True)
    node_name = Column(String(255), nullable=True)
    node_cpu_percent = Column(Float, nullable=True)
    node_memory_percent = Column(Float, nullable=True)

    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        Index('ix_metrics_tl_exec_iter', 'execution_id', 'iteration'),
        UniqueConstraint('execution_id', 'iteration', 'node_id', 'timestamp',
                         name='uq_metrics_tl_natural'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'execution_id': self.execution_id,
            'iteration': self.iteration,
            'cluster_cpu_percent': self.cluster_cpu_percent,
            'cluster_memory_percent': self.cluster_memory_percent,
            'node_id': self.node_id,
            'node_name': self.node_name,
            'node_cpu_percent': self.node_cpu_percent,
            'node_memory_percent': self.node_memory_percent,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }
