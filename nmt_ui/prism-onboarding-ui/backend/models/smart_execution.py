from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, Boolean, Text
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base

class SmartExecution(Base):
    """
    Table to store smart execution history and results
    """
    __tablename__ = 'smart_executions'

    id = Column(Integer, primary_key=True)
    execution_id = Column(String(128), unique=True, nullable=False, index=True)
    testbed_id = Column(String(128), nullable=False, index=True)
    testbed_label = Column(String(255), nullable=True)
    
    # Execution status
    status = Column(String(50), nullable=False, default='RUNNING', index=True)  # RUNNING, COMPLETED, STOPPED, FAILED
    is_running = Column(Boolean, default=True)
    
    # Timestamps
    start_time = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Float, nullable=True)
    
    # Configuration
    target_config = Column(JSON, nullable=False)  # CPU threshold, Memory threshold, stop condition
    entities_config = Column(JSON, nullable=False)  # Which entities and operations
    
    # Metrics
    baseline_metrics = Column(JSON, nullable=True)  # CPU, Memory at start
    final_metrics = Column(JSON, nullable=True)  # CPU, Memory at end
    metrics_history = Column(JSON, nullable=True)  # Array of all metric readings
    
    # Operations
    total_operations = Column(Integer, default=0)
    successful_operations = Column(Integer, default=0)
    failed_operations = Column(Integer, default=0)
    success_rate = Column(Float, default=0.0)
    operations_per_minute = Column(Float, default=0.0)
    operations_history = Column(JSON, nullable=True)  # Array of all operations
    
    # Results
    threshold_reached = Column(Boolean, default=False)
    created_entities = Column(JSON, nullable=True)  # Array of created entity details
    entity_breakdown = Column(JSON, nullable=True)  # Stats by entity type
    resource_summary = Column(JSON, nullable=True)  # VMs created, CPU allocated, etc.
    
    # Execution context
    execution_mode = Column(String(50), nullable=True)  # REAL or SIMULATED
    cluster_name = Column(String(255), nullable=True)
    cluster_uuid = Column(String(128), nullable=True)
    
    # Report
    report_generated = Column(Boolean, default=False)
    report_html_path = Column(String(512), nullable=True)  # Path to generated HTML report
    
    # Alert
    alert_generated = Column(Boolean, default=False)
    alert_sent_slack = Column(Boolean, default=False)
    alert_timestamp = Column(DateTime, nullable=True)
    
    # Full execution data (for detailed view)
    full_execution_data = Column(JSON, nullable=True)  # Complete execution snapshot
    
    # AI/ML specific fields
    ai_enabled = Column(Boolean, default=False)  # Whether AI control is enabled
    ai_settings = Column(JSON, nullable=True)  # AI configuration (PID tuning, ML settings)
    ml_stats = Column(JSON, nullable=True)  # ML model statistics (R², MAE, feature importance)
    pid_stats = Column(JSON, nullable=True)  # PID controller performance data
    training_data_collected = Column(Integer, default=0)  # Number of training samples collected
    
    # New unified testbed identifier (for consistency)
    unique_testbed_id = Column(String(128), nullable=True, index=True)
    
    # Rule configuration (for pod filtering and monitoring)
    rule_config = Column(JSON, nullable=True)  # Prometheus rules, namespaces, pod filters
    
    # Tags/labels for filtering and comparison
    tags = Column(JSON, nullable=True)  # ["pre-upgrade", "nightly-soak", ...]
    
    # Anomaly/alert summary persisted at end of execution
    anomaly_count = Column(Integer, default=0)
    anomaly_high_count = Column(Integer, default=0)
    anomaly_data = Column(JSON, nullable=True)  # Full anomaly list
    
    # Plain-English learning summary generated at end
    learning_summary = Column(Text, nullable=True)
    
    # Latency summary persisted at end
    latency_summary = Column(JSON, nullable=True)
    
    # Alert thresholds used for this execution
    alert_thresholds = Column(JSON, nullable=True)
    
    def to_dict(self):
        """Convert SmartExecution instance to dictionary"""
        return {
            'id': self.id,
            'execution_id': self.execution_id,
            'testbed_id': self.testbed_id,
            'testbed_label': self.testbed_label,
            'status': self.status,
            'is_running': self.is_running,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_minutes': self.duration_minutes,
            'target_config': self.target_config,
            'entities_config': self.entities_config,
            'baseline_metrics': self.baseline_metrics,
            'final_metrics': self.final_metrics,
            'metrics_history': self.metrics_history,
            'total_operations': self.total_operations,
            'successful_operations': self.successful_operations,
            'failed_operations': self.failed_operations,
            'success_rate': self.success_rate,
            'operations_per_minute': self.operations_per_minute,
            'operations_history': self.operations_history,
            'threshold_reached': self.threshold_reached,
            'created_entities': self.created_entities,
            'entity_breakdown': self.entity_breakdown,
            'resource_summary': self.resource_summary,
            'execution_mode': self.execution_mode,
            'cluster_name': self.cluster_name,
            'cluster_uuid': self.cluster_uuid,
            'report_generated': self.report_generated,
            'report_html_path': self.report_html_path,
            'alert_generated': self.alert_generated,
            'alert_sent_slack': self.alert_sent_slack,
            'alert_timestamp': self.alert_timestamp.isoformat() if self.alert_timestamp else None,
            'full_execution_data': self.full_execution_data,
            'ai_enabled': self.ai_enabled,
            'ai_settings': self.ai_settings,
            'ml_stats': self.ml_stats,
            'pid_stats': self.pid_stats,
            'training_data_collected': self.training_data_collected,
            'unique_testbed_id': self.unique_testbed_id,
            'rule_config': self.rule_config,
            'tags': self.tags,
            'anomaly_count': self.anomaly_count,
            'anomaly_high_count': self.anomaly_high_count,
            'anomaly_data': self.anomaly_data,
            'learning_summary': self.learning_summary,
            'latency_summary': self.latency_summary,
            'alert_thresholds': self.alert_thresholds,
        }
