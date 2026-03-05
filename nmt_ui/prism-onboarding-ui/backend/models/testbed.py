from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base

class Testbed(Base):
    __tablename__ = 'testbeds'

    unique_testbed_id = Column(String(128), unique=True, index=True, nullable=True)
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    pc_ip = Column(String(64), index=True, nullable=True)  # Allow NULL since PC IP might not be available
    uuid = Column(String(128), index=True, nullable=True)  # Allow NULL temporarily until ncm_utils.py is implemented
    testbed_label = Column(String(255), index=True, nullable=False)
    testbed_json = Column(JSON, nullable=False)
    testbed_filepath = Column(String(512), nullable=True)  # Path to the stored JSON file
    
    # New fields - Mark as None before deployment, will be updated by jita_main.py after deployment
    status_filepath = Column(String(512), nullable=True)  # Path to status file
    ncm_ip = Column(String(64), nullable=True)  # NCM IP address
    username = Column(String(128), nullable=True)  # Username for deployment
    password = Column(String(256), nullable=True)  # Password for deployment
    pc_deployment = Column(String(64), nullable=True)  # PC deployment status/info
    ncm_deployment = Column(String(64), nullable=True)  # NCM deployment status/info
    remote_pc_deployment = Column(String(64), nullable=True)  # Remote PC deployment status/info
    
    # Alert configuration for notifications (Slack, Email, Webhook)
    alert_config = Column(JSON, nullable=True)  # Alert notification settings

    def to_dict(self):
        """Convert Testbed instance to dictionary"""
        return {
            'unique_testbed_id': self.unique_testbed_id,
            'id': self.id,
            'timestamp': self.timestamp,
            'pc_ip': self.pc_ip,
            'uuid': self.uuid,
            'testbed_label': self.testbed_label,
            'testbed_json': self.testbed_json,
            'testbed_filepath': self.testbed_filepath,
            'status_filepath': self.status_filepath,
            'ncm_ip': self.ncm_ip,
            'username': self.username,
            'password': self.password,
            'pc_deployment': self.pc_deployment,
            'ncm_deployment': self.ncm_deployment,
            'remote_pc_deployment': self.remote_pc_deployment,
            'alert_config': self.alert_config
        }
