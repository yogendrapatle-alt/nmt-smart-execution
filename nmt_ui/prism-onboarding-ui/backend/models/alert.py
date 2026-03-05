from sqlalchemy import Column, Integer, String, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
import datetime


# Include node, pod, and testbed labels.
Base = declarative_base()

class Alert(Base):
    __tablename__ = 'alerts'

    id = Column(Integer, primary_key=True)
    alertname = Column(String, nullable=False)
    severity = Column(String)
    rule_name = Column(String)
    summary = Column(String)
    description = Column(String)
    pod_name = Column(String)
    node_name = Column(String)  # New: node label
    testbed = Column(String)    # New: testbed label
    namespace = Column(String)
    query = Column(String)
    value = Column(Float)
    threshold = Column(Float)
    operator = Column(String)
    status = Column(String)
    starts_at = Column(DateTime)  # When alert started firing
    received_at = Column(DateTime)  # When alert was received
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
