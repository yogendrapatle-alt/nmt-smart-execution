from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base

class Workload(Base):
    __tablename__ = 'workloads'

    id = Column(Integer, primary_key=True)
    unique_workload_id = Column(String(128), unique=True, nullable=False)  # Unique workload identifier
    unique_rule_id = Column(String(128), ForeignKey('configs.unique_rule_id'), nullable=False)  # Foreign key to configs table
    unique_testbed_id = Column(String(128), ForeignKey('testbeds.unique_testbed_id'), nullable=True)  # Foreign key to testbeds table
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    pc_ip = Column(String(64), index=True, nullable=True)  # Allow NULL since PC IP might not be available
    uuid = Column(String(128), index=True, nullable=False)
    workload_label = Column(String(255), index=True, nullable=False)
    testbed_label = Column(String(255), index=True, nullable=True)  # Link workload to testbed
    workload_json = Column(JSON, nullable=False)

    def to_dict(self):
        """Convert Workload instance to dictionary"""
        return {
            'id': self.id,
            'unique_workload_id': self.unique_workload_id,
            'unique_rule_id': self.unique_rule_id,
            'unique_testbed_id': self.unique_testbed_id,
            'timestamp': self.timestamp,
            'pc_ip': self.pc_ip,
            'uuid': self.uuid,
            'workload_label': self.workload_label,
            'testbed_label': self.testbed_label,
            'workload_json': self.workload_json
        }
