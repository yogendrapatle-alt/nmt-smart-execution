from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
import datetime

# Use the same Base as other models
from .alert import Base

class Config(Base):
    __tablename__ = 'configs'

    id = Column(Integer, primary_key=True)
    unique_rule_id = Column(String(36), unique=True, nullable=False)
    unique_testbed_id = Column(String(36), ForeignKey('testbeds.unique_testbed_id'), nullable=True)  # Allow NULL for direct onboarding
    pc_ip = Column(String(64), index=True, nullable=True)  # Allow NULL for testbed-based configs
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    config_json = Column(JSON, nullable=False)
