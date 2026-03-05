-- Migration to add Slack alerts history table
-- Run this to track all alert notifications sent to Slack

CREATE TABLE IF NOT EXISTS slack_alerts (
    id SERIAL PRIMARY KEY,
    alert_id VARCHAR(128) UNIQUE NOT NULL,
    testbed_id VARCHAR(128) NOT NULL,
    testbed_label VARCHAR(255),
    alert_name VARCHAR(255) NOT NULL,
    alert_type VARCHAR(50) NOT NULL, -- 'node', 'pod', 'custom'
    severity VARCHAR(50) NOT NULL, -- 'critical', 'warning', 'info'
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'resolved', 'acknowledged'
    description TEXT,
    rule_id VARCHAR(128),
    triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP,
    webhook_url TEXT,
    slack_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    slack_response TEXT,
    metadata JSONB, -- Additional alert data (labels, annotations, etc.)
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_slack_alerts_testbed_id ON slack_alerts(testbed_id);
CREATE INDEX IF NOT EXISTS idx_slack_alerts_triggered_at ON slack_alerts(triggered_at);
CREATE INDEX IF NOT EXISTS idx_slack_alerts_status ON slack_alerts(status);
CREATE INDEX IF NOT EXISTS idx_slack_alerts_severity ON slack_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_slack_alerts_testbed_time ON slack_alerts(testbed_id, triggered_at DESC);

-- Add foreign key constraint (optional, if testbeds table exists)
-- ALTER TABLE slack_alerts 
-- ADD CONSTRAINT fk_slack_alerts_testbed 
-- FOREIGN KEY (testbed_id) REFERENCES testbeds(unique_testbed_id) 
-- ON DELETE CASCADE;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_slack_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slack_alerts_updated_at_trigger
BEFORE UPDATE ON slack_alerts
FOR EACH ROW
EXECUTE FUNCTION update_slack_alerts_updated_at();

COMMENT ON TABLE slack_alerts IS 'History of all alert notifications sent to Slack';
COMMENT ON COLUMN slack_alerts.alert_id IS 'Unique identifier for the alert';
COMMENT ON COLUMN slack_alerts.testbed_id IS 'Reference to the testbed that triggered the alert';
COMMENT ON COLUMN slack_alerts.alert_name IS 'Name of the triggered alert rule';
COMMENT ON COLUMN slack_alerts.severity IS 'Alert severity level';
COMMENT ON COLUMN slack_alerts.status IS 'Current status of the alert';
COMMENT ON COLUMN slack_alerts.slack_status IS 'Status of Slack notification delivery';
COMMENT ON COLUMN slack_alerts.metadata IS 'Additional alert data in JSON format';
